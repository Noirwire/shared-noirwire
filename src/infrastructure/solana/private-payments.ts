import "./buffer-polyfill.js";

import { Buffer } from "buffer";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { readU64LE } from "./bytes.js";
import {
  type BalanceLimits,
  COMPUTE_BUDGET_RULE,
  CREATE_ATA_RULE,
  type ProgramRule,
  verifyBalancesBeforeSigning,
} from "./presign-guard.js";
import { resolveAccountKeys, signForSending, type StillUnlocked } from "./signerAccounts.js";
import { connection } from "./client.js";
import { outcomeWithin, signatureOf } from "./settlement.js";
import { UnknownOutcomeError } from "./swap/types.js";
import { ataFor } from "./tokens.js";
import { apiUrl } from "../api.js";
import { apiErrorOf, authorizedFetch } from "../apiSession.js";
import { apiErrorIn } from "../../domain/apiError.js";
import { isChainError } from "../../domain/chainError.js";
import { privatePaymentCluster } from "./config.js";
import {
  MIN_TRANSFER_RAW,
  privacyFeeFor,
  RELAY_FEE_RAW,
  SETTLEMENT_DELAY_MS,
} from "../../domain/privateTransfer.js";

/**
 * Client for MagicBlock's hosted Ephemeral SPL Token API, used for one thing:
 * moving USDC from the wallet's funding account into a private account
 * without publishing a direct funding-wallet -> private-account transfer.
 *
 * Called through NoirWire's server, not straight from the app, so
 * MagicBlock never sees the visitor's IP next to the two addresses. The
 * server passes the request on and keeps nothing:
 * no storage, and no log of a body or an address. That is a promise about
 * this server rather than something a visitor can check, and the interface
 * says so. MagicBlock itself still sees both addresses, because a transfer
 * cannot be built without naming them.
 *
 * What this does and does not buy, in MagicBlock's own words: "Privacy here
 * reduces linkability, not total observability. Amounts and timing may still
 * be inferable at the network level."
 */

/** Queue entries one transfer is broken into, so a single distinctive amount is not what lands. */
const SPLIT = 3;

/** MagicBlock's Ephemeral SPL Token program, the only place a private transfer's tokens may move. */
const EPHEMERAL_SPL_PROGRAM = new PublicKey("SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2");

/** The instruction that queues the transfer, and where it states the amount. */
const QUEUE_TRANSFER = 25;
const QUEUE_TRANSFER_LEN = 196;
const QUEUE_TRANSFER_AMOUNT_OFFSET = 5;

/** The Token program's plain Transfer, which is how the relay fee is paid. */
const TOKEN_TRANSFER = 3;
const TOKEN_TRANSFER_LEN = 9;

/**
 * The program's instructions as genuine transfers use them: two that set the
 * sender up, and the one that queues the transfer. Anything else it offers
 * is not part of sending and is refused.
 *
 * The Token program is listed for one instruction only, the relay-fee
 * transfer, and this list alone does not make one safe: `checkRelayFee`
 * decides which single transfer that may be, and the two are only ever used
 * together.
 */
export const PRIVATE_PAYMENT_PROGRAMS: ProgramRule[] = [
  COMPUTE_BUDGET_RULE,
  CREATE_ATA_RULE,
  { programId: EPHEMERAL_SPL_PROGRAM, instructions: [0, 4, QUEUE_TRANSFER] },
  { programId: TOKEN_PROGRAM_ID, instructions: [TOKEN_TRANSFER] },
];

/**
 * The shape of a gasless transfer, read off genuine ones on both networks.
 *
 * The sponsor is the fee payer and the sender signs second, read-only: it
 * authorises its token account and nothing else, so no SOL of the sender's
 * can move. The sponsor's address is not published anywhere in MagicBlock's
 * documentation, so it is not pinned here; what is held instead is that the
 * fee payer is somebody other than the sender.
 *
 * The one direct token transfer a genuine transaction carries pays the relay
 * fee, and it is the only way tokens leave outside the service's own program.
 * So there must be exactly one, out of the sender's own account for this
 * mint, on the sender's authority, for no more than the published fee, into
 * the fee payer's associated account for the same mint. That destination is
 * derived, not looked up: an account of any other mint or owner has a
 * different address and is refused. The fee comes back as read from the
 * transaction, never from what the service's JSON says it charged.
 */
export async function checkRelayFee(
  transaction: VersionedTransaction,
  sender: PublicKey,
  mint: PublicKey,
): Promise<{ ok: true; relayFeeRaw: bigint } | { ok: false; reason: string }> {
  const refuse = (reason: string) => ({ ok: false as const, reason: `${reason} Not signed.` });
  const { message } = transaction;
  const [feePayer] = message.staticAccountKeys;
  if (!feePayer) return refuse("This transfer names no fee payer.");
  const senderIndex = message.staticAccountKeys.findIndex((key) => key.equals(sender));
  if (feePayer.equals(sender)) {
    return refuse("This transfer would be paid for in SOL by the wallet sending it.");
  }
  if (!message.isAccountSigner(senderIndex) || message.isAccountWritable(senderIndex)) {
    return refuse("This transfer asks the wallet sending it for more than its signature.");
  }

  const accountKeys = await resolveAccountKeys(transaction);
  const tokenInstructions = message.compiledInstructions.filter((instruction) =>
    accountKeys.get(instruction.programIdIndex)?.equals(TOKEN_PROGRAM_ID),
  );
  if (tokenInstructions.length !== 1) {
    return refuse("This transfer moves tokens in a way a private transfer has no reason to.");
  }
  const [relay] = tokenInstructions;
  const [source, destination, authority] = relay.accountKeyIndexes.map((index) =>
    accountKeys.get(index),
  );
  const expected =
    relay.data[0] === TOKEN_TRANSFER &&
    relay.data.length === TOKEN_TRANSFER_LEN &&
    relay.accountKeyIndexes.length === 3 &&
    source?.equals(ataFor(mint, sender)) &&
    destination?.equals(ataFor(mint, feePayer)) &&
    authority?.equals(sender);
  if (!expected) {
    return refuse("This transfer pays its relay fee in a way this app does not recognise.");
  }
  const relayFeeRaw = readU64LE(relay.data, 1);
  if (relayFeeRaw > RELAY_FEE_RAW) {
    return refuse(
      `This transfer charges a larger relay fee than published (${relayFeeRaw} units).`,
    );
  }
  return { ok: true, relayFeeRaw };
}

/**
 * The transaction must queue exactly one transfer, for exactly the amount
 * asked for. The balance check only caps what leaves the sender; this ties
 * what is queued to the request, so the service cannot queue less and keep
 * the difference, or queue a second transfer beside the first. The layout
 * was read off genuine transactions, and one that does not match it is
 * refused, not interpreted.
 */
export async function checkQueuedAmount(
  transaction: VersionedTransaction,
  amountRaw: bigint,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const accountKeys = await resolveAccountKeys(transaction);
  const queued = transaction.message.compiledInstructions.filter(
    (instruction) =>
      accountKeys.get(instruction.programIdIndex)?.equals(EPHEMERAL_SPL_PROGRAM) &&
      instruction.data[0] === QUEUE_TRANSFER,
  );
  if (queued.length !== 1 || queued[0].data.length !== QUEUE_TRANSFER_LEN) {
    return {
      ok: false,
      reason: "The private payment service returned a transfer this app cannot read. Not signed.",
    };
  }
  const amount = readU64LE(queued[0].data, QUEUE_TRANSFER_AMOUNT_OFFSET);
  if (amount !== amountRaw) {
    return {
      ok: false,
      reason: `This transfer is for a different amount than was asked for (${amount} units). Not signed.`,
    };
  }
  return { ok: true };
}

const CREATE_ATA_ACCOUNTS = 6;

/**
 * The token accounts the transaction may open. The allowlist admits the
 * Associated Token Account program's two create instructions and says
 * nothing about whose account: left at that, the service could have the
 * sponsor open an account for any owner at all, the destination portfolio
 * included, and the funding wallet would sign a public transaction naming it.
 *
 * Genuine gasless builds carry exactly one create, read off live ones: the
 * sender's own account for the mint being moved, paid for by the sponsor.
 * (The sponsor's fee account already exists, and the program's own accounts
 * are opened inside its instructions.) So that is the only one accepted:
 * the sender as owner, this mint, the classic Token program, and the account
 * address those derive.
 */
export async function checkCreatedAccounts(
  transaction: VersionedTransaction,
  sender: PublicKey,
  mint: PublicKey,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const accountKeys = await resolveAccountKeys(transaction);
  for (const instruction of transaction.message.compiledInstructions) {
    if (!accountKeys.get(instruction.programIdIndex)?.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) continue;
    const [, account, owner, createdMint, , tokenProgram] = instruction.accountKeyIndexes.map(
      (index) => accountKeys.get(index),
    );
    const expected =
      instruction.accountKeyIndexes.length === CREATE_ATA_ACCOUNTS &&
      owner?.equals(sender) &&
      createdMint?.equals(mint) &&
      tokenProgram?.equals(TOKEN_PROGRAM_ID) &&
      account?.equals(ataFor(mint, sender));
    if (!expected) {
      return {
        ok: false,
        reason:
          "This transfer would open a token account a private transfer has no reason to. Not signed.",
      };
    }
  }
  return { ok: true };
}

/**
 * None of `addresses`, nor the token account any of them has for `mint`, may
 * appear anywhere in the transaction, lookup tables included.
 *
 * This is the property the transfer is paid for. The transaction the funding
 * wallet signs is public and names the funding wallet. A genuine one names
 * the destination nowhere: it is sealed inside the queueing instruction. One
 * that named the destination portfolio, or any other portfolio of this
 * wallet, would pass every amount check and write on chain the very link the
 * private route exists to leave out. Reading an account is enough to name
 * it, so every account key is checked, whatever the instruction does with it.
 */
export async function checkKeepsOut(
  transaction: VersionedTransaction,
  mint: PublicKey,
  addresses: PublicKey[],
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const accountKeys = await resolveAccountKeys(transaction);
  const secret = new Set(
    addresses.flatMap((address) => [address.toBase58(), ataFor(mint, address).toBase58()]),
  );
  for (let index = 0; index < accountKeys.length; index += 1) {
    if (secret.has(accountKeys.get(index)!.toBase58())) {
      return {
        ok: false,
        reason:
          "This transfer would publicly name another wallet of yours next to the one sending it. Not signed.",
      };
    }
  }
  return { ok: true };
}

type BuiltTransaction = {
  version: "legacy" | "v0";
  transactionBase64: string;
  sendTo: "base" | "ephemeral";
  sendRpcEndpoint?: string;
  recentBlockhash?: string;
  lastValidBlockHeight?: number;
};

async function postJson<T>(path: string, body: unknown): Promise<T> {
  // Only ever an unsigned transaction to check, or a nudge: nothing signed leaves here.
  const response = await authorizedFetch(apiUrl("privatePayments", path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    asksAgain: true,
  });

  const ours = await apiErrorOf(response);
  if (ours) throw ours;
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    // The service reports a refusal as `{ error: { code, message } }`.
    const { error, message } = (payload ?? {}) as {
      error?: string | { message?: string };
      message?: string;
    };
    const detail = (typeof error === "string" ? error : error?.message) ?? message;
    throw new Error(detail || `The private payment service returned ${response.status}.`);
  }
  return payload as T;
}

/**
 * Signs the service-built transaction only after simulating it on our own
 * RPC and checking what it does to the sender's balances. Anything that
 * cannot be simulated here - a legacy transaction, or one destined for the
 * ephemeral rollup rather than the base chain - is refused, not signed blind.
 *
 * The sponsor has already signed when the transaction arrives, so the
 * sender's signature is the last one it needs and it goes back to the same
 * send endpoint as before.
 */
async function verifyAndSign(
  built: BuiltTransaction,
  signer: Keypair,
  mint: PublicKey,
  amountRaw: bigint,
  keepOut: PublicKey[],
  stillUnlocked: StillUnlocked,
): Promise<{ transactionBase64: string; feeRaw: bigint; signature: string | null }> {
  if (built.version !== "v0" || built.sendTo !== "base") {
    throw new Error("The private payment service returned a transaction this app cannot check.");
  }
  const transaction = VersionedTransaction.deserialize(
    Buffer.from(built.transactionBase64, "base64"),
  );
  const unlinked = await checkKeepsOut(transaction, mint, keepOut);
  if (!unlinked.ok) throw new Error(unlinked.reason);
  const created = await checkCreatedAccounts(transaction, signer.publicKey, mint);
  if (!created.ok) throw new Error(created.reason);
  const queued = await checkQueuedAmount(transaction, amountRaw);
  if (!queued.ok) throw new Error(queued.reason);
  const relay = await checkRelayFee(transaction, signer.publicKey, mint);
  if (!relay.ok) throw new Error(relay.reason);
  const privacyFee = privacyFeeFor(amountRaw);
  const limits: BalanceLimits = {
    cashAccount: ataFor(mint, signer.publicKey),
    maxCashSpent: amountRaw + privacyFee + relay.relayFeeRaw,
    // The sender is not writable in a gasless transfer, so none can leave.
    maxLamportsSpent: 0n,
    programs: PRIVATE_PAYMENT_PROGRAMS,
  };
  const verification = await verifyBalancesBeforeSigning(transaction, signer.publicKey, limits);
  if (!verification.ok) throw new Error(verification.reason);

  await signForSending(transaction, signer, stillUnlocked);
  return {
    transactionBase64: Buffer.from(transaction.serialize()).toString("base64"),
    feeRaw: privacyFee + relay.relayFeeRaw,
    // The sponsor signed first, as fee payer, before the transaction got
    // here, so the id it will land under is known before it is sent.
    signature: signatureOf(transaction),
  };
}

/** How long the chain is asked about a transfer whose send got no clear answer. */
const UNANSWERED_SEND_WAIT_MS = 30_000;

/**
 * Hands the signed transfer to the service to send, and settles what became
 * of it when the service does not say.
 *
 * A send can land and its answer still be lost: a timeout, a dropped
 * connection, a 5xx from a relay that had already passed it on. Calling that
 * a failure invites a second transfer on top of one that went through. So
 * every answer short of an accepted send is settled against the chain under
 * the transaction's own signature. That includes a refusal: a service that
 * passed the transaction on before it refused can still have it land, so a
 * refusal is only taken as one once the chain shows the transfer can no
 * longer land. Landed is landed, failed only when the chain recorded an
 * error or the transaction expired with no trace, and otherwise the outcome
 * is unknown and is reported as that, to be settled later.
 *
 * "Can no longer land" is judged against a block height read here, not the
 * one the service states: no blockhash outlives the newest one, so the
 * newest one's last valid height is a bound the service cannot shorten.
 */
export async function submitTransfer(
  body: Record<string, unknown>,
  signature: string | null,
  waitMs = UNANSWERED_SEND_WAIT_MS,
): Promise<string> {
  const latest = signature
    ? await connection.getLatestBlockhash("confirmed").catch(() => null)
    : null;

  let refusal: string | null = null;
  try {
    const response = await authorizedFetch(apiUrl("privatePayments", "/v1/transaction/send"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as {
      signature?: string;
      error?: string | { message?: string };
      message?: string;
    } | null;
    if (response.ok && payload?.signature) return signature ?? payload.signature;
    if (response.status >= 400 && response.status < 500) {
      // The service's own words are kept; the server's own sentence is never shown.
      const { error, message } = apiErrorIn(response.status, payload) ? {} : (payload ?? {});
      refusal =
        (typeof error === "string" ? error : error?.message) ??
        message ??
        `The private payment service returned ${response.status}.`;
    }
  } catch (error) {
    // No session could be had, so the request was never made: nothing left the device.
    if (isChainError(error, "notAvailableNow")) throw error;
    /* no answer at all: settled against the chain below */
  }
  // Handed over with no clear success and no signature to ask the chain
  // about: what became of it is not known, whatever the answer said.
  if (!signature) throw new UnknownOutcomeError();
  const outcome = await outcomeWithin(
    signature,
    latest?.lastValidBlockHeight,
    refusal === null ? waitMs : 0,
  );
  if (outcome === "confirmed") return signature;
  if (outcome === "failed") throw new Error(refusal ?? "The private transfer did not go through.");
  throw new UnknownOutcomeError(signature, latest?.lastValidBlockHeight);
}

/**
 * Moves `amount` of `mint` from `sender` to `to` as a queued private
 * transfer, and returns the signature of the transaction that enqueued it.
 *
 * What is checked before signing is everything the transaction shows: the
 * programs and instructions called, that exactly the requested amount is
 * queued, that the one relay-fee transfer is the published one, and that no
 * more than the amount plus both fees leaves. Who it is
 * queued for is not. The recipient is sealed inside the instruction, where
 * only the service can read it, so it cannot be checked here and `to` is
 * taken on the service's word. Delivery is confirmed the only way it can be:
 * by watching the recipient's balance for the arrival.
 *
 * The signature proves the transfer was *accepted*, never that it has
 * *arrived*: settlement is deferred by design, so the caller has to watch
 * the recipient's balance rather than treat this resolving as delivery.
 */
type PrivateTransferRequest = {
  sender: Keypair;
  to: PublicKey;
  mint: PublicKey;
  decimals: number;
  amount: number;
  /**
   * Every address of this wallet that must stay out of the transaction: the
   * destination and every other portfolio. See `checkKeepsOut`.
   */
  keepOut: PublicKey[];
  /** Asked again right before the sender's key signs. */
  stillUnlocked: StillUnlocked;
};

export async function sendPrivateTransfer(
  request: PrivateTransferRequest,
): Promise<{ signature: string; feeTokens: number }> {
  const { sender, to, mint, decimals, amount, keepOut, stillUnlocked } = request;
  const amountRaw = BigInt(Math.round(amount * 10 ** decimals));
  if (amountRaw < MIN_TRANSFER_RAW) {
    throw new Error(
      `A private transfer has to be at least ${Number(MIN_TRANSFER_RAW) / 10 ** decimals} USDC.`,
    );
  }

  const built = await postJson<BuiltTransaction>("/v1/spl/transfer", {
    from: sender.publicKey.toBase58(),
    to: to.toBase58(),
    mint: mint.toBase58(),
    amount: Number(amountRaw),
    cluster: privatePaymentCluster(),
    visibility: "private",
    fromBalance: "base",
    toBalance: "base",
    minDelayMs: String(SETTLEMENT_DELAY_MS.min),
    maxDelayMs: String(SETTLEMENT_DELAY_MS.max),
    split: SPLIT,
    initIfMissing: true,
    initAtasIfMissing: true,
    gasless: true,
  });

  const signed = await verifyAndSign(
    built,
    sender,
    mint,
    amountRaw,
    // The destination is kept out whether or not the caller listed it.
    [to, ...keepOut],
    stillUnlocked,
  );
  const { feeRaw } = signed;
  const signature = await submitTransfer(
    {
      transactionBase64: signed.transactionBase64,
      sendTo: built.sendTo,
      ...(built.sendRpcEndpoint ? { sendRpcEndpoint: built.sendRpcEndpoint } : {}),
      cluster: privatePaymentCluster(),
    },
    signed.signature,
  );

  // The limit that was enforced, so never less than what was really charged.
  return { signature, feeTokens: Number(feeRaw) / 10 ** decimals };
}

/**
 * Nudges the mint's transfer queue along. Permissionless by design, which is
 * the part that matters: a queued transfer is not waiting on MagicBlock's
 * goodwill to be delivered, because anyone - including us, on the recipient's
 * behalf - can ask for a crank attempt.
 *
 * Best-effort. A failure here is not a failed transfer, so it is swallowed:
 * the queue's own cranking continues regardless.
 */
export async function nudgeSettlement(mint: PublicKey): Promise<void> {
  try {
    await postJson("/v1/spl/transfer-queue/ensure-crank", {
      mint: mint.toBase58(),
      cluster: privatePaymentCluster(),
    });
  } catch {
    /* the queue advances on its own; this only tries to make it sooner */
  }
}
