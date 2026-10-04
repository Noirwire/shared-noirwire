import "./buffer-polyfill.js";

import { Buffer } from "buffer";
import { createTransferCheckedInstruction } from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { bytesEqual } from "./bytes.js";
import { connection } from "./client.js";
import { apiUrl } from "../api.js";
import { apiErrorOf, authorizedFetch } from "../apiSession.js";
import { readFetch } from "../readFetch.js";
import { usdcMint, usdcMintKey } from "./config.js";
import { type BalanceLimits, verifyBalancesBeforeSigning } from "./presign-guard.js";
import {
  readRelayed,
  relayerFeeCap,
  type OpenedAccount,
  type RelayedRefusal,
  type RelayerPins,
} from "./relayed.js";
import { recordForSending, signForSending, type StillUnlocked } from "./signerAccounts.js";
import { sendAndSettle, signatureOf } from "./settlement.js";
import type { RelayerQuote } from "../../application/ports.js";
import { ChainError, isChainError } from "../../domain/chainError.js";
import { UnknownOutcomeError } from "./swap/types.js";
import { ataFor } from "./tokens.js";

/**
 * A network cost paid in USDC. NoirWire's relayer is the fee payer of the
 * transaction and the portfolio pays it back, in the same transaction, with
 * one USDC transfer into the relayer's payment account. The portfolio needs
 * no SOL, and nothing is converted first.
 *
 * The app builds the whole transaction. The relayer never alters it:
 * NoirWire's server prices it, and then the relayer adds the fee payer's
 * signature to exactly the bytes the portfolio signed. Both go through the
 * server's relayer route, which holds the relayer's credentials and pins its
 * keys.
 *
 * The portfolio signs a transaction whose fee payer it does not control, so
 * before it does, the transaction is read back from its bytes
 * (src/infrastructure/solana/relayed.ts, the same reading the relay route makes), held
 * to what was reviewed (`checkRelayedIntent`), and then simulated. The app
 * wrote it, which makes these checks a second line against this code, a
 * library or the relay being wrong, not a first line against a stranger.
 * They fail closed all the same.
 *
 * What it costs in privacy: every relayer-paid transaction names the same
 * fee payer and pays into the same account, so anyone can list the
 * portfolios that use it. It marks a portfolio as NoirWire's. It never names
 * the funding wallet or another portfolio, which `keepOut` enforces.
 */

/** The one relayer call that hands over a signed transaction, and so is never made a second time. */
const SIGN_METHOD = "signTransaction";

const USDC_DECIMALS = 6;

/**
 * The payment a draft carries while the fee is still unknown. It gives the
 * draft the signers and accounts of the final transaction, which is what
 * gets priced.
 */
const PLACEHOLDER_FEE_RAW = 1n;

const REQUIRED_SIGNATURES = 2;

/**
 * The relayer could not be used and nothing was sent. The action can still
 * go ahead with its network cost met another way, once that is reviewed.
 */
export class RelayerUnavailableError extends ChainError {
  constructor() {
    super("relayerUnavailable");
    this.name = "RelayerUnavailableError";
  }
}

/** The fee rose past what was reviewed before the relayer signed. Nothing was sent. */
export class RelayerFeeRoseError extends ChainError {
  constructor(readonly feeRaw: bigint) {
    super("networkCostRose");
    this.name = "RelayerFeeRoseError";
  }
}

/**
 * A relayer-paid transaction was sent and the chain shows it did not land:
 * it failed there, or its time ran out, which is how one sent without a
 * priority fee ends when the network is busy. Nothing moved.
 */
export class RelayedNotLandedError extends ChainError {
  constructor() {
    super("relayedNotLanded");
    this.name = "RelayedNotLandedError";
  }
}

const PINS_TTL_MS = 60_000;
let pinsCache: { at: number; pins: Promise<RelayerPins | null> } | null = null;

async function fetchPins(): Promise<RelayerPins | null> {
  const response = await readFetch(apiUrl("relayer"));
  const payload = (await response.json()) as {
    available?: boolean;
    feePayers?: string[];
    paymentWallet?: string;
    accountCreation?: boolean;
  };
  if (!response.ok || !payload.available || !payload.feePayers?.length || !payload.paymentWallet) {
    return null;
  }
  return {
    feePayers: payload.feePayers.map((key) => new PublicKey(key)),
    paymentWallet: new PublicKey(payload.paymentWallet),
    accountCreation: payload.accountCreation === true,
  };
}

/**
 * The relayer's pinned keys, or null when this site runs none. Asked of this
 * site's server, never of the relayer, and kept for a minute. A failed read
 * is not kept, and counts as no relayer.
 */
export function relayerPins(): Promise<RelayerPins | null> {
  if (pinsCache && Date.now() - pinsCache.at < PINS_TTL_MS) return pinsCache.pins;
  const pins = fetchPins().catch(() => null);
  pinsCache = { at: Date.now(), pins };
  void pins.then((value) => {
    if (!value && pinsCache?.pins === pins) pinsCache = null;
  });
  return pins;
}

/** Forgets the pins that were read. For tests. */
export function resetRelayerPins() {
  pinsCache = null;
}

/** A refusal, by the server's code: the request was turned down, so the relayer signed nothing. */
class RelayerRefusal extends Error {
  constructor(readonly reason: string) {
    super("The relayer refused the request.");
  }
}

/** No usable answer came back, so what the relayer did with the request is not known. */
class RelayerSilence extends Error {}

/**
 * The server's codes for a request it did not act on: the relayer was not
 * asked to sign, or never received what it was sent. Any other answer short
 * of a result, a 401 included, leaves what the relayer did unknown.
 */
const NOT_ACTED_ON = [
  "invalid_request",
  "origin_not_allowed",
  "method_not_allowed",
  "request_timeout",
  "request_too_large",
  "refused",
  "insufficient_payment",
  "rate_limited",
  "unavailable",
  "relayer_unavailable",
  "upstream_not_reached",
];

/** The codes that say the relayer never had the request: the action may be built again for another replica. */
const NEVER_RECEIVED = ["relayer_unavailable", "unavailable"];

async function call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
  let response: Response;
  try {
    response = await authorizedFetch(apiUrl("relayer"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, params }),
      asksAgain: method !== SIGN_METHOD,
    });
  } catch (error) {
    // No session could be had, so the request was never made: nothing left the device.
    if (isChainError(error, "notAvailableNow")) throw error;
    throw new RelayerSilence();
  }
  const payload = (await response
    .clone()
    .json()
    .catch(() => null)) as { result?: T } | null;
  if (response.ok && payload?.result) return payload.result;
  // A signature is answered with the signed transaction itself, and its id beside it.
  if (response.ok && method === SIGN_METHOD && "transaction" in (payload ?? {}))
    return payload as T;
  const refusal = await apiErrorOf(response);
  if (refusal && NOT_ACTED_ON.includes(refusal.code)) throw new RelayerRefusal(refusal.code);
  throw new RelayerSilence();
}

/** What a draft is built against: the fee payer the relayer named, and the fee it will carry. */
export type RelayerTerms = {
  feePayer: PublicKey;
  feeRaw: bigint;
  /** True while pricing. An amount that leaves no room for the fee is then reduced to fit, not refused. */
  pricing: boolean;
};

/** What the user reviewed, which the transaction has to be and nothing more. */
export type RelayedIntent =
  | {
      kind: "send";
      mint: PublicKey;
      programId: PublicKey;
      to: PublicKey;
      amountRaw: bigint;
    }
  | { kind: "deposit" | "withdraw"; amountRaw: bigint }
  /** The whole Earn position taken back: `amountRaw` is the receipt shares redeemed. */
  | { kind: "redeem"; amountRaw: bigint }
  /** Opening this portfolio's own account for a tracker, ahead of a first buy. */
  | { kind: "open" };

/** An action as the app built it: its instructions without the payment, and what they must amount to. */
export type RelayedDraft = {
  instructions: TransactionInstruction[];
  intent: RelayedIntent;
  /** The token account the fee payer opens for it, when it has to open one. */
  opens: OpenedAccount | null;
  /** Every mint the action touches, for finding the token accounts of addresses that must stay out. */
  mints: { mint: PublicKey; programId: PublicKey }[];
  /** What the simulation must show once the payment is `feeRaw`. */
  limits: (feeRaw: bigint) => BalanceLimits;
};

export type RelayedBuild = (terms: RelayerTerms) => Promise<RelayedDraft>;

function paymentInstruction(portfolio: PublicKey, paymentWallet: PublicKey, feeRaw: bigint) {
  return createTransferCheckedInstruction(
    ataFor(usdcMintKey(), portfolio),
    usdcMintKey(),
    ataFor(usdcMintKey(), paymentWallet),
    portfolio,
    feeRaw,
    USDC_DECIMALS,
  );
}

/**
 * The transaction for `draft`: the action, then the payment, with the
 * relayer as fee payer. A legacy message, so there is no lookup table to
 * hide an account in, and no ComputeBudget instruction, which the relayer
 * refuses: a priority fee would be the relayer's to pay.
 *
 * The payment comes last so that an action which brings USDC in, a
 * withdrawal, can pay out of what it brought.
 */
export function compileRelayed(
  draft: RelayedDraft,
  portfolio: PublicKey,
  feePayer: PublicKey,
  paymentWallet: PublicKey,
  feeRaw: bigint,
  recentBlockhash: string,
): VersionedTransaction {
  return new VersionedTransaction(
    new TransactionMessage({
      payerKey: feePayer,
      recentBlockhash,
      instructions: [...draft.instructions, paymentInstruction(portfolio, paymentWallet, feeRaw)],
    }).compileToLegacyMessage(),
  );
}

export type RelayedExpectation = {
  pins: RelayerPins;
  portfolio: PublicKey;
  /** The fee the payment must carry, and the most it may be: what was reviewed, and never above the cap. */
  feeRaw: bigint;
  maxFeeRaw: bigint;
  intent: RelayedIntent;
  opens: OpenedAccount | null;
  mints: { mint: PublicKey; programId: PublicKey }[];
  /**
   * This wallet's other addresses: the funding wallet and every other
   * portfolio. Neither they nor their token accounts may appear.
   */
  keepOut: PublicKey[];
};

type Verdict = { ok: true } | { ok: false; reason: string };

/** Each way a transaction fails to be a relayer-paid one, as the user is told it. */
const REFUSALS: Record<RelayedRefusal, string> = {
  lookup_table: "This transaction reaches accounts through a lookup table.",
  fee_payer_not_pinned:
    "This transaction would be paid for by a key that is not NoirWire's relayer.",
  signers: "This transaction asks for more than the relayer's and this portfolio's signatures.",
  compute_budget: "This transaction sets a priority fee, which a relayer-paid one never does.",
  system_instruction: "This transaction moves funds in a way a relayer-paid one has no reason to.",
  instruction_count: "This transaction does something other than the action and its network cost.",
  fee_payer_named: "This transaction uses the relayer for more than paying the network.",
  payment: "This transaction pays its network cost in a way this app does not recognise.",
  payment_above_cap: "This transaction's network cost is above what this app accepts.",
  account_creation: "This transaction opens an account it has no reason to.",
  action: "This transaction does something this app did not ask for.",
};

function sameAccount(a: OpenedAccount | null, b: OpenedAccount | null): boolean {
  if (!a || !b) return a === b;
  return a.owner.equals(b.owner) && a.mint.equals(b.mint) && a.programId.equals(b.programId);
}

/**
 * Holds a relayer-paid transaction to what was reviewed, before the
 * portfolio signs it. It is first read back from its own bytes, by the same
 * reading the relay route makes, which settles its shape: a pinned fee
 * payer, this one portfolio beside it, one action, one bounded payment, no
 * priority fee, and nothing else. Then what it does is compared with the
 * review:
 *
 * - the payment is exactly the fee that will be charged, and that is no
 *   more than was reviewed;
 * - a send moves exactly the reviewed amount of the reviewed token, out of
 *   this portfolio's account for it and into the reviewed recipient's
 *   account for it, which is derived from the recipient's address and not
 *   taken from the transaction;
 * - a deposit or withdrawal is for exactly the reviewed amount;
 * - the account opened, if any, is the one the review counted on;
 * - the funding wallet, the other portfolios and their token accounts are
 *   nowhere in it.
 */
export function checkRelayedIntent(
  transaction: VersionedTransaction,
  expected: RelayedExpectation,
): Verdict {
  const refuse = (reason: string): Verdict => ({ ok: false, reason: `${reason} Not signed.` });
  const reading = readRelayed(transaction, expected.pins);
  if (!reading.ok) return refuse(REFUSALS[reading.reason]);
  const { relayed } = reading;
  const { portfolio, intent } = expected;

  if (!relayed.portfolio.equals(portfolio)) return refuse(REFUSALS.signers);
  if (relayed.feeRaw !== expected.feeRaw || relayed.feeRaw > expected.maxFeeRaw) {
    return refuse("This transaction's network cost is not the one that was reviewed.");
  }

  const { action } = relayed;
  const asReviewed =
    action.kind === intent.kind &&
    (action.kind === "open" || (intent.kind !== "open" && action.amountRaw === intent.amountRaw)) &&
    (action.kind !== "send" ||
      (intent.kind === "send" &&
        action.mint.equals(intent.mint) &&
        action.programId.equals(intent.programId) &&
        action.source.equals(ataFor(intent.mint, portfolio, intent.programId)) &&
        action.destination.equals(ataFor(intent.mint, intent.to, intent.programId))));
  if (!asReviewed) return refuse("This transaction does not do what was reviewed.");
  if (!sameAccount(relayed.opens, expected.opens)) return refuse(REFUSALS.account_creation);

  const kept = new Set<string>();
  for (const owner of expected.keepOut) {
    kept.add(owner.toBase58());
    for (const { mint, programId } of expected.mints) {
      kept.add(ataFor(mint, owner, programId).toBase58());
    }
  }
  if (transaction.message.staticAccountKeys.some((key) => kept.has(key.toBase58()))) {
    return refuse("This transaction names another of your addresses, which would link them.");
  }
  return { ok: true };
}

/**
 * The transaction as the relayer returned it, accepted only when it is the
 * one this portfolio signed with the fee payer's signature added: the same
 * message, byte for byte, and this portfolio's signature untouched.
 */
export function checkCoSigned(
  encoded: string,
  signed: VersionedTransaction,
): VersionedTransaction | null {
  let returned: VersionedTransaction;
  try {
    returned = VersionedTransaction.deserialize(Buffer.from(encoded, "base64"));
  } catch {
    return null;
  }
  const same =
    bytesEqual(returned.message.serialize(), signed.message.serialize()) &&
    returned.signatures.length === REQUIRED_SIGNATURES &&
    bytesEqual(returned.signatures[1], signed.signatures[1]) &&
    signatureOf(returned) !== null;
  return same ? returned : null;
}

function encoded(transaction: VersionedTransaction): string {
  return Buffer.from(transaction.serialize()).toString("base64");
}

/**
 * The fee payer for one transaction, which must be one this site pins. The
 * relayer runs as several replicas, each with a key of its own; `not` names
 * the ones just seen to fail, so that another is chosen.
 */
async function payerSigner(pins: RelayerPins, not: PublicKey[]): Promise<PublicKey> {
  const answer = await call<{ signer_address: string; payment_address: string }>(
    "getPayerSigner",
    not.length > 0 ? { not: not.map((key) => key.toBase58()) } : undefined,
  );
  const signer = pins.feePayers.find((key) => key.toBase58() === answer.signer_address);
  if (!signer || answer.payment_address !== pins.paymentWallet.toBase58()) {
    throw new RelayerRefusal("refused");
  }
  return signer;
}

/** The pinned keys and the fee payer the relayer names for one transaction. */
async function relayerFor(
  not: PublicKey[] = [],
): Promise<{ pins: RelayerPins; feePayer: PublicKey }> {
  const pins = await relayerPins();
  if (!pins) throw new RelayerUnavailableError();
  return { pins, feePayer: await payerSigner(pins, not) };
}

/**
 * Whether a replica is certain not to have received what it was sent: the
 * relay says it could not be reached at all, or it turned the request away.
 * Silence is not that. A request that timed out or lost its connection may
 * have arrived all the same.
 */
function neverReceived(error: unknown): boolean {
  return error instanceof RelayerRefusal && NEVER_RECEIVED.includes(error.reason);
}

async function estimate(transaction: VersionedTransaction, feePayer: PublicKey): Promise<bigint> {
  const answer = await call<{ fee_in_token: number }>("estimateTransactionFee", {
    transaction: encoded(transaction),
    fee_token: usdcMint(),
    signer_key: feePayer.toBase58(),
  });
  if (!Number.isSafeInteger(answer.fee_in_token) || answer.fee_in_token <= 0) {
    throw new RelayerRefusal("refused");
  }
  return BigInt(answer.fee_in_token);
}

/**
 * Prices an action with the relayer, signing nothing. Throws when there is
 * no relayer, when it does not answer, when the action has to open an
 * account and the relayer opens none, or when the price is above the cap:
 * in every one of those cases the action's cost is met another way.
 */
export async function quoteRelayed(
  portfolio: PublicKey,
  build: RelayedBuild,
): Promise<RelayerQuote> {
  const failed: PublicKey[] = [];
  for (;;) {
    const { pins, feePayer } = await relayerFor(failed);
    const draft = await build({ feePayer, feeRaw: PLACEHOLDER_FEE_RAW, pricing: true });
    if (draft.opens && !pins.accountCreation) throw new RelayerUnavailableError();
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const transaction = compileRelayed(
      draft,
      portfolio,
      feePayer,
      pins.paymentWallet,
      PLACEHOLDER_FEE_RAW,
      blockhash,
    );
    let feeRaw: bigint;
    try {
      feeRaw = await estimate(transaction, feePayer);
    } catch (error) {
      // Nothing is signed for a price, so any replica that does not answer is
      // simply passed over. The draft names its key, so another replica
      // means another draft.
      if (!neverReceived(error) && !(error instanceof RelayerSilence)) throw error;
      failed.push(feePayer);
      continue;
    }
    const opensAccount = draft.opens !== null;
    if (feeRaw > relayerFeeCap(opensAccount)) throw new RelayerUnavailableError();
    return { feeRaw, opensAccount };
  }
}

/**
 * Runs an action whose review showed `reviewedFeeRaw` as its network cost:
 * builds it, checks it, has the portfolio sign, has the relayer add the fee
 * payer's signature (the relayer signs and broadcasts nothing), checks that
 * what came back is the same message with the portfolio's own signature
 * intact, writes its id into the reservation, and only then sends it through the server's RPC route and watches
 * for it. Returns the transaction's signature, which is the fee payer's.
 *
 * Until the relayer has signed, nothing can land, so a failure up to there
 * is `RelayerUnavailableError`: nothing was sent, and the caller may offer
 * another way to pay. A relay that answers that the payment is too small
 * (the price moved) is asked for the fee once more. If that is no more than
 * was reviewed, the same payment is signed again with a fresh blockhash; if
 * it is more, nothing further is signed and `RelayerFeeRoseError` carries
 * the new fee back for a fresh review. Nobody pays more than they were shown.
 *
 * A transaction names its fee payer, so it can only be signed by the one
 * replica whose key that is. When that replica is certain never to have
 * received it (it could not be reached, or it turned the request away), the
 * action is built again against another, checked again from the start, and
 * signed again by the portfolio, inside the same confirmation and for the
 * fee that was reviewed.
 *
 * Anything short of that certainty is not a reason to sign again. A replica
 * that was sent a signed transaction and did not answer may hold a complete
 * one, and a second transaction signed for another replica could land beside
 * it: the same action twice. So silence at that point is
 * `UnknownOutcomeError`, exactly as it is once a transaction has been sent:
 * never a failure, never retried here, and carrying what is needed to settle
 * it against the chain later, which is the earliest anything is signed again. One that the chain shows did not land is
 * `RelayedNotLandedError`.
 */
export async function runRelayed(run: {
  owner: Keypair;
  build: RelayedBuild;
  reviewedFeeRaw: bigint;
  /** The funding wallet and every other portfolio of this wallet, less a recipient the user chose among them. */
  keepOut: PublicKey[];
  stillUnlocked: StillUnlocked;
}): Promise<string> {
  const { owner, reviewedFeeRaw, stillUnlocked } = run;
  const portfolio = owner.publicKey;

  const failed: PublicKey[] = [];
  let repriced = false;
  for (;;) {
    const { pins, feePayer } = await relayerFor(failed).catch(() => {
      throw new RelayerUnavailableError();
    });
    const draft = await run.build({ feePayer, feeRaw: reviewedFeeRaw, pricing: false });
    if (draft.opens && !pins.accountCreation) throw new RelayerUnavailableError();
    const cap = relayerFeeCap(draft.opens !== null);
    const latest = await connection.getLatestBlockhash("confirmed");
    const transaction = compileRelayed(
      draft,
      portfolio,
      feePayer,
      pins.paymentWallet,
      reviewedFeeRaw,
      latest.blockhash,
    );

    const intent = checkRelayedIntent(transaction, {
      pins,
      portfolio,
      feeRaw: reviewedFeeRaw,
      maxFeeRaw: reviewedFeeRaw < cap ? reviewedFeeRaw : cap,
      intent: draft.intent,
      opens: draft.opens,
      mints: draft.mints,
      keepOut: run.keepOut,
    });
    if (!intent.ok) throw new Error(intent.reason);
    const balances = await verifyBalancesBeforeSigning(
      transaction,
      portfolio,
      draft.limits(reviewedFeeRaw),
    );
    // The relayer is the fee payer: one that cannot pay cannot be used, and
    // the cost is met another way. Nothing is signed either way.
    if (!balances.ok && balances.feePayerShort) throw new RelayerUnavailableError();
    if (!balances.ok) throw new Error(balances.reason);

    await signForSending(transaction, owner, stillUnlocked, latest.lastValidBlockHeight);

    let answer: { transaction?: string; signed_transaction?: string; signature?: string };
    try {
      answer = await call(SIGN_METHOD, {
        transaction: encoded(transaction),
        signer_key: feePayer.toBase58(),
      });
    } catch (error) {
      // The request was never made, for want of a session. Nothing left
      // the device, and nothing is asked of the relayer again here.
      if (isChainError(error, "notAvailableNow")) throw error;
      // This replica never had the transaction. Another is asked for, and
      // when none is left that ends it (`relayerFor` above).
      if (neverReceived(error)) {
        failed.push(feePayer);
        continue;
      }
      // It may have it, signed by both. Nothing more is signed until the
      // chain has settled this one.
      if (error instanceof RelayerSilence) {
        throw new UnknownOutcomeError(undefined, latest.lastValidBlockHeight);
      }
      const tooSmall = error instanceof RelayerRefusal && error.reason === "insufficient_payment";
      if (!tooSmall || repriced) throw new RelayerUnavailableError();
      // The price moved. What was just signed lacks the fee payer's signature
      // and can never land; it is dropped, and the fee is asked for once more.
      repriced = true;
      const fee = await estimate(transaction, feePayer).catch(() => null);
      if (fee === null) throw new RelayerUnavailableError();
      if (fee > reviewedFeeRaw) throw new RelayerFeeRoseError(fee);
      continue;
    }

    // The relayer only signs. Nothing has been broadcast, by it or by anyone.
    const complete = checkCoSigned(
      answer.transaction ?? answer.signed_transaction ?? "",
      transaction,
    );
    if (!complete) {
      throw new Error("The relayer returned a different transaction than was signed. Not sent.");
    }
    // The fee payer signs first, so the transaction's id is its signature, not the portfolio's.
    const signature = signatureOf(complete)!;
    if (answer.signature !== undefined && answer.signature !== signature) {
      throw new Error("The relayer named a different transaction than it signed. Not sent.");
    }
    // Its id is written into the reservation before it is sent. An app closed
    // a moment after the broadcast then finds, on reopening, exactly which
    // transaction to ask the chain about. One that cannot be written is not sent.
    await recordForSending(complete, portfolio, latest.lastValidBlockHeight);
    return sendAndSettle(
      complete,
      signature,
      latest.lastValidBlockHeight,
      () => new RelayedNotLandedError(),
    );
  }
}
