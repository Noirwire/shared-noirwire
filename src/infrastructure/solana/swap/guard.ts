import "../buffer-polyfill.js";

import { Buffer } from "buffer";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  type MessageAccountKeys,
  type VersionedTransaction,
} from "@solana/web3.js";
import { bytesEqual, readU32LE, readU64LE } from "../bytes.js";
import { connection } from "../client.js";
import { jupiterReferralAccount, noirwireFeeBps } from "../config.js";
import { checkPrograms, type ProgramRule } from "../presign-guard.js";
import { ownedTokenAccountsIn, resolveAccountKeys } from "../signerAccounts.js";
import { inspectMint, multiplierSchedule, multiplierSwitching } from "../mintPolicy.mjs";
import type { SwapQuote } from "./types.js";

/**
 * The check that stands between a quote and a signature.
 *
 * A venue hands back a transaction it built. Trusting that it does what the
 * quote said is the whole risk: a hosted router is a third party, a pool can
 * move between quote and signature, and neither failure announces itself -
 * both just produce a transaction that takes the input and returns less than
 * promised. Reading the instructions cannot settle it either, because what
 * a swap actually pays out depends on pool state at execution, not on what
 * the instruction data says.
 *
 * So the transaction is run. Simulation gives the account states it would
 * actually produce, and the balances are compared against what the quote
 * committed to. A swap that would deliver less than its own floor never gets
 * signed.
 *
 * Simulation only shows the accounts that are watched, though, and only as
 * they stand today. So the instructions are held to one static rule first:
 * nothing but the venue's own programs may be called directly.
 */

/**
 * The only programs a swap may call at the top level.
 *
 * Taken from orders the live router really built, not from documentation:
 * the contract suite samples buys and sells across routes and fails if any
 * genuine order calls something that is not listed here. No genuine order
 * calls the System program directly, and the only token instructions one
 * carries are CloseAccount and, on a market-maker order with NoirWire's fee,
 * the one TransferChecked that pays it. Each is held to a single exact shape
 * below, so any other top-level transfer, approval or authority change is
 * always refused. A router that has not been observed is not listed, and its
 * orders are refused until it is, with the one exception marked below. The
 * two shared rules are spelled out here instead of imported because that
 * module imports this one.
 */
const CLOSE_ACCOUNT = 9;
const TRANSFER_CHECKED = 12;
const TRANSFER_CHECKED_LEN = 10;

export const SWAP_PROGRAMS: ProgramRule[] = [
  { programId: ComputeBudgetProgram.programId },
  // Create and create-idempotent only; the program's other instructions can move tokens.
  { programId: ASSOCIATED_TOKEN_PROGRAM_ID, instructions: [0, 1] },
  // Jupiter's aggregator, the pooled route.
  { programId: new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4") },
  // Jupiter's RFQ order engine, the market-maker route.
  { programId: new PublicKey("61DFfeTKM7trxYcPQCM78bJ794ddZprZpAwAnLiwTpYH") },
  // DFlow's aggregator, which the router picks for some pooled orders.
  { programId: new PublicKey("DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH") },
  // OKX's DEX router, the fourth router Jupiter's order endpoint lets
  // compete. This id was taken from documentation, not from a captured
  // order: it is the Solana "DEX router address" in OKX's developer
  // documentation, and the program's own on-chain IDL names it "OKX: DEX
  // Router". The contract suite has since built a genuine order through it.
  // Every simulation check applies to such an order unchanged.
  { programId: new PublicKey("proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u") },
  // CloseAccount only in the shape `checkCloses` accepts: a pooled order
  // that routes through SOL ends by closing the taker's wrapped-SOL account.
  // TransferChecked only in the shape `checkFeeTransfer` accepts.
  { programId: TOKEN_PROGRAM_ID, instructions: [CLOSE_ACCOUNT, TRANSFER_CHECKED] },
];

/**
 * A top-level CloseAccount pays an account's whole lamport balance to
 * whoever the instruction names. Net balances cannot be trusted to catch a
 * wrong one: an account opened and closed inside the same transaction is
 * never watched. So each is read directly. It may only close the taker's
 * wrapped-SOL account or the account the swap spends from, on the taker's
 * own authority, and the lamports may only go to the taker.
 */
function checkCloses(
  transaction: VersionedTransaction,
  accountKeys: MessageAccountKeys,
  taker: PublicKey,
  inputAta: PublicKey,
): ProgramVerification {
  const wrappedSol = getAssociatedTokenAddressSync(NATIVE_MINT, taker, true);
  for (const instruction of transaction.message.compiledInstructions) {
    if (!accountKeys.get(instruction.programIdIndex)?.equals(TOKEN_PROGRAM_ID)) continue;
    if (instruction.data[0] !== CLOSE_ACCOUNT) continue;
    const [account, destination, authority] = instruction.accountKeyIndexes.map((index) =>
      accountKeys.get(index),
    );
    const expected =
      instruction.accountKeyIndexes.length === 3 &&
      (account?.equals(wrappedSol) || account?.equals(inputAta)) &&
      destination?.equals(taker) &&
      authority?.equals(taker);
    if (!expected) {
      return {
        ok: false,
        reason: "This swap would close an account in a way a swap has no reason to. Not signed.",
      };
    }
  }
  return { ok: true };
}

type ProgramVerification = ReturnType<typeof checkPrograms>;

/** The cash side of an order, which is where NoirWire's fee is taken. */
export type FeeLeg = { quote: SwapQuote; outputAta: PublicKey };

type FeeTransfer = { destination: PublicKey; mint: PublicKey };

/**
 * A market-maker order does not take NoirWire's fee inside the fill, as a
 * pooled order does. It carries one top-level TransferChecked that pays it:
 * out of the taker's cash account, on the taker's authority, to the referral
 * account's token account. Seen on genuine buys (out of the account the order
 * spends from) and sells (out of the account it pays into).
 *
 * The simulation already holds the net result to the quote in both
 * directions, fee included. This holds the instruction itself to the fee the
 * review showed, so it cannot be used to move anything else: at most one,
 * only when a fee is configured, only from the order's own cash account in
 * that account's mint, and for no more than the fee rate applied to the
 * order. Where it pays is returned for the caller to read from the chain,
 * because a referral token account's address cannot be derived here.
 */
function checkFeeTransfer(
  transaction: VersionedTransaction,
  accountKeys: MessageAccountKeys,
  taker: PublicKey,
  inputAta: PublicKey,
  fee: FeeLeg | undefined,
): { ok: true; feeTransfer?: FeeTransfer } | { ok: false; reason: string } {
  const transfers = transaction.message.compiledInstructions.filter(
    (instruction) =>
      accountKeys.get(instruction.programIdIndex)?.equals(TOKEN_PROGRAM_ID) &&
      instruction.data[0] === TRANSFER_CHECKED,
  );
  if (transfers.length === 0) return { ok: true };
  const refused = {
    ok: false as const,
    reason: "This swap would transfer tokens in a way a swap has no reason to. Not signed.",
  };
  if (transfers.length > 1 || !fee || noirwireFeeBps() <= 0) return refused;

  const [transfer] = transfers;
  const [source, mint, destination, authority] = transfer.accountKeyIndexes.map((index) =>
    accountKeys.get(index),
  );
  if (
    transfer.accountKeyIndexes.length !== 4 ||
    transfer.data.length !== TRANSFER_CHECKED_LEN ||
    !source ||
    !mint ||
    !destination ||
    !authority?.equals(taker)
  ) {
    return refused;
  }
  const { quote } = fee;
  const rate = BigInt(noirwireFeeBps());
  // On a buy the fee is part of the quoted input. On a sell it comes out of
  // the proceeds, and the quoted output is what is left after it.
  let cap: bigint;
  if (source.equals(inputAta) && mint.equals(quote.inputMint)) {
    cap = (quote.inAmount * rate + 9_999n) / 10_000n;
  } else if (source.equals(fee.outputAta) && mint.equals(quote.outputMint)) {
    cap = (quote.outAmount * rate) / (10_000n - rate) + 1n;
  } else {
    return refused;
  }
  if (readU64LE(transfer.data, 1) > cap) return refused;
  return { ok: true, feeTransfer: { destination, mint } };
}

/** Whether `data` is a token account of `mint` owned by the configured referral account. */
function isReferralAccount(data: Uint8Array | undefined, mint: PublicKey): boolean {
  const referral = jupiterReferralAccount();
  return (
    !!referral &&
    !!data &&
    !tokenAccountClosed(data) &&
    bytesEqual(data.subarray(0, 32), mint.toBytes()) &&
    ownedBy(data, new PublicKey(referral))
  );
}

const WRONG_FEE_ACCOUNT = {
  ok: false as const,
  reason: "This swap would pay its fee to an account that is not NoirWire's. Not signed.",
};

function checkInstructions(
  transaction: VersionedTransaction,
  accountKeys: MessageAccountKeys,
  taker: PublicKey,
  inputAta: PublicKey,
  fee?: FeeLeg,
): ReturnType<typeof checkFeeTransfer> {
  const programs = checkPrograms(transaction, accountKeys, SWAP_PROGRAMS);
  if (!programs.ok) return programs;
  const closes = checkCloses(transaction, accountKeys, taker, inputAta);
  if (!closes.ok) return closes;
  return checkFeeTransfer(transaction, accountKeys, taker, inputAta, fee);
}

/**
 * The static half of the swap check on its own, lookup tables resolved. Pass
 * the order's cash leg to have a fee transfer checked against it; without it
 * any top-level transfer is refused.
 */
export async function checkSwapPrograms(
  transaction: VersionedTransaction,
  taker: PublicKey,
  inputAta: PublicKey,
  fee?: FeeLeg,
): Promise<ProgramVerification> {
  const accountKeys = await resolveAccountKeys(transaction);
  const instructions = checkInstructions(transaction, accountKeys, taker, inputAta, fee);
  if (!instructions.ok) return instructions;
  if (!instructions.feeTransfer) return { ok: true };
  const { destination, mint } = instructions.feeTransfer;
  const account = await connection.getAccountInfo(destination);
  return isReferralAccount(account?.data, mint) ? { ok: true } : WRONG_FEE_ACCOUNT;
}

/** `amount` is a u64 at byte 64 of an SPL token account, in both Token and Token-2022. */
const TOKEN_AMOUNT_OFFSET = 64;
const TOKEN_ACCOUNT_LEN = 165;

type SwapVerification = { ok: true; expectedOut: bigint } | { ok: false; reason: string };

export function readTokenAmount(data: Uint8Array | undefined): bigint {
  if (!data || data.length < TOKEN_ACCOUNT_LEN) return 0n;
  return readU64LE(data, TOKEN_AMOUNT_OFFSET);
}

/**
 * Balances are not the only thing a signature can give away. `Approve` sets a
 * delegate that can drain the account later, and `SetAuthority` hands over
 * ownership or the right to close it - none of which moves a single unit, so
 * a balance check alone passes them. These are the three base-layout fields
 * (identical in Token and Token-2022) that decide who controls an account.
 */
const OWNER = [32, 64] as const;
const DELEGATE = [72, 108] as const;
const DELEGATED_AMOUNT = [121, 129] as const;
const CLOSE_AUTHORITY = [129, 165] as const;

/**
 * Whether a transaction hands control of a token account to anyone new. An
 * existing account must keep its owner, delegate and close authority exactly;
 * one the transaction creates must come out with no delegate and no close
 * authority. A closed account is not this function's to judge: callers
 * refuse that separately with `tokenAccountClosed`.
 */
export function tokenControlChanged(before: Uint8Array | undefined, after: Uint8Array | undefined) {
  if (!after || after.length < TOKEN_ACCOUNT_LEN) return false;
  const field = (data: Uint8Array, [start, end]: readonly [number, number]) =>
    data.subarray(start, end);
  if (before && before.length >= TOKEN_ACCOUNT_LEN) {
    return [OWNER, DELEGATE, DELEGATED_AMOUNT, CLOSE_AUTHORITY].some(
      (range) => !bytesEqual(field(before, range), field(after, range)),
    );
  }
  return readU32LE(after, DELEGATE[0]) !== 0 || readU32LE(after, CLOSE_AUTHORITY[0]) !== 0;
}

/** Whether there is no token account in this data: never created, or closed. */
export function tokenAccountClosed(data: Uint8Array | undefined) {
  return !data || data.length < TOKEN_ACCOUNT_LEN;
}

function ownedBy(data: Uint8Array, owner: PublicKey) {
  return bytesEqual(data.subarray(OWNER[0], OWNER[1]), owner.toBytes());
}

export function decodeAccount(value: { data: [string, string] } | null): Uint8Array | undefined {
  if (!value) return undefined;
  const [encoded, encoding] = value.data;
  return encoding === "base64" ? Buffer.from(encoded, "base64") : undefined;
}

const UNCHECKED: SwapVerification = {
  ok: false,
  reason: "The swap could not be checked before signing.",
};

/**
 * Simulates `transaction` and confirms it moves at least the quote's
 * committed minimum into `outputAta`, takes no more than the quoted amount
 * out of `inputAta`, and leaves everything else `taker` owns alone.
 *
 * Both directions matter. Checking only the output would accept a swap that
 * delivers the right amount while spending far more than quoted. And the two
 * swap accounts are not all the taker has: a transaction that settles the
 * quote exactly can still carry an instruction that moves SOL or another
 * holding. So the taker's own balance and every other token account of
 * theirs the transaction can touch are watched too: SOL may fall by no more
 * than `maxLamportsSpent`, which the caller works out from the fee and rent
 * this order really needs (nothing at all for an order the venue pays for),
 * and no other holding may fall, change hands or be closed. Before any of
 * that, every program the transaction calls directly must be on the swap
 * allowlist and it must not run on a durable nonce.
 *
 * The stock's mint account is read in the same request, for two reasons. On
 * a buy it must still match the profile it was listed under: an issuer can
 * pause a mint, start freezing new accounts or attach a transfer hook at any
 * time, and none of that shows in a quote. A sell is not held to the profile,
 * so a token that changed can always be sold for what the simulation shows.
 * And on either side nothing is signed in the minutes around a new display
 * multiplier taking effect, which is when the issuer asks venues to pause.
 *
 * The balances before the swap are what everything is measured against, so
 * when they cannot be read nothing is signed: reading them as zero would
 * count whatever the account already held as delivered by this swap. The
 * same goes for an account that has to exist and comes back missing. Only
 * the output account, which a first buy creates, and a wallet that holds no
 * SOL at all may be absent.
 */
export async function verifySwapBeforeSigning(
  transaction: VersionedTransaction,
  quote: SwapQuote,
  taker: PublicKey,
  inputAta: PublicKey,
  outputAta: PublicKey,
  stock: { mint: PublicKey; acquiring: boolean },
  maxLamportsSpent: bigint,
): Promise<SwapVerification> {
  const accountKeys = await resolveAccountKeys(transaction).catch(() => null);
  if (!accountKeys) return UNCHECKED;
  const instructions = checkInstructions(transaction, accountKeys, taker, inputAta, {
    quote,
    outputAta,
  });
  if (!instructions.ok) return instructions;
  const { feeTransfer } = instructions;

  const touched = await ownedTokenAccountsIn(accountKeys, taker).catch(() => null);
  if (!touched) return UNCHECKED;
  const others = touched.filter(
    (account) => !account.equals(inputAta) && !account.equals(outputAta),
  );
  const watched = [inputAta, outputAta, taker, ...others];

  // Read in the same request as the balances: the stock's mint, and where a
  // fee transfer pays.
  const extras = [stock.mint, feeTransfer?.destination].filter((key) => key !== undefined);
  const before = await connection
    .getMultipleAccountsInfo([...watched, ...extras])
    .catch(() => null);
  if (!before) return UNCHECKED;
  const [preInput, preOutput, preTaker] = before;
  const extraInfo = (key: PublicKey | undefined) =>
    key ? before[watched.length + extras.indexOf(key)] : null;
  if (!preInput || others.some((_, index) => !before[index + 3])) return UNCHECKED;

  if (
    feeTransfer &&
    !isReferralAccount(extraInfo(feeTransfer.destination)?.data, feeTransfer.mint)
  ) {
    return WRONG_FEE_ACCOUNT;
  }

  const mintAccount = extraInfo(stock.mint);
  const address = stock.mint.toBase58();
  if (stock.acquiring) {
    const mint = inspectMint(address, mintAccount);
    if (mint.problem) {
      return {
        ok: false,
        reason: `This token no longer works the way it did when it was listed (${mint.problem}). Not signed.`,
      };
    }
  }
  const multiplier = multiplierSchedule(address, mintAccount);
  if (!multiplier) return UNCHECKED;
  if (multiplierSwitching(multiplier, Date.now() / 1000)) {
    return {
      ok: false,
      reason:
        "The issuer is applying a dividend or split to this token right now. Try again in a few minutes. Not signed.",
    };
  }

  const simulation = await connection.simulateTransaction(transaction, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    accounts: { encoding: "base64", addresses: watched.map((account) => account.toBase58()) },
  });

  if (simulation.value.err) {
    return {
      ok: false,
      reason: `The swap would fail on chain (${JSON.stringify(simulation.value.err)}).`,
    };
  }

  const simulated = simulation.value.accounts;
  if (!simulated || simulated.length !== watched.length) return UNCHECKED;
  const [postInput, postOutput, postTaker] = simulated;

  if (postTaker && postTaker.owner !== SystemProgram.programId.toBase58()) {
    return { ok: false, reason: "This swap would hand your wallet to a program. Not signed." };
  }
  const lamportsSpent = BigInt(preTaker?.lamports ?? 0) - BigInt(postTaker?.lamports ?? 0);
  if (lamportsSpent > maxLamportsSpent) {
    return {
      ok: false,
      reason: `This swap would spend more SOL than it should (${lamportsSpent} lamports, at most ${maxLamportsSpent} expected). Not signed.`,
    };
  }

  const inputAfterData = decodeAccount(postInput as never);
  const outputAfterData = decodeAccount(postOutput as never);
  const otherAfterData = others.map((_, index) => decodeAccount(simulated[index + 3] as never));

  // Closing a token account pays its rent out to whoever the instruction
  // names, and an empty account has no balance to notice missing. So no other
  // holding may be closed, and the input account only if its rent comes home.
  if (otherAfterData.some(tokenAccountClosed)) {
    return { ok: false, reason: "This swap would close another of your accounts. Not signed." };
  }
  if (
    tokenAccountClosed(inputAfterData) &&
    lamportsSpent + BigInt(preInput.lamports) > maxLamportsSpent
  ) {
    return {
      ok: false,
      reason: "This swap would close the account it spends from and keep its rent. Not signed.",
    };
  }
  if (
    tokenControlChanged(preInput?.data, inputAfterData) ||
    tokenControlChanged(preOutput?.data, outputAfterData) ||
    others.some((_, index) => tokenControlChanged(before[index + 3]?.data, otherAfterData[index]))
  ) {
    return {
      ok: false,
      reason: "This swap would give someone else control of this account's tokens. Not signed.",
    };
  }
  // An account the transaction creates has no earlier owner to compare with,
  // so every account still standing is held to the taker directly: tokens
  // delivered to an account someone else owns were not delivered.
  if (
    [inputAfterData, outputAfterData, ...otherAfterData].some(
      (data) => data && !tokenAccountClosed(data) && !ownedBy(data, taker),
    )
  ) {
    return {
      ok: false,
      reason: "This swap would leave tokens in an account you do not own. Not signed.",
    };
  }
  if (
    others.some(
      (_, index) =>
        readTokenAmount(otherAfterData[index]) < readTokenAmount(before[index + 3]?.data),
    )
  ) {
    return { ok: false, reason: "This swap would also move another asset. Not signed." };
  }

  const received = readTokenAmount(outputAfterData) - readTokenAmount(preOutput?.data);
  const spent = readTokenAmount(preInput?.data) - readTokenAmount(inputAfterData);

  if (received < quote.minOutAmount) {
    return {
      ok: false,
      reason: `This swap would deliver less than quoted. Expected at least ${quote.minOutAmount}, simulated ${received}.`,
    };
  }

  if (spent > quote.inAmount) {
    return {
      ok: false,
      reason: `This swap would spend more than quoted. Quoted ${quote.inAmount}, simulated ${spent}.`,
    };
  }

  return { ok: true, expectedOut: received };
}

/**
 * The static half: this transaction is one we are actually a party to.
 *
 * Deliberately narrow, after two wrong attempts at something stricter. A
 * real Jupiter RFQ swap requires **three** signatures - the market maker,
 * a gas-station account that pays rent, and the taker - and at quote time
 * **none** of them are filled in; Jupiter collects the other two itself when
 * the signed transaction is handed back to `/execute`. So neither "the taker
 * must be the only signer" nor "every other signer must already have signed"
 * is true, and both reject every real stock trade.
 *
 * Counting signers was never the protection anyway. We hold one key and can
 * only ever sign as the taker, so a co-signer is not a way for anyone to
 * move our funds. What protects the account is `verifySwapBeforeSigning`,
 * which runs the transaction and checks what it actually does to our
 * balances. This only rules out signing something that is not ours at all.
 */
export function verifySigners(
  transaction: VersionedTransaction,
  taker: PublicKey,
): SwapVerification {
  const required = transaction.message.header.numRequiredSignatures;
  const signers = transaction.message.staticAccountKeys.slice(0, required);

  if (!signers.some((key) => key.equals(taker))) {
    return {
      ok: false,
      reason: "This swap does not involve this account, so signing it would be pointless.",
    };
  }

  return { ok: true, expectedOut: 0n };
}
