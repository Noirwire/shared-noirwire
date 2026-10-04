import "../buffer-polyfill.js";

import { Buffer } from "buffer";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { bytesEqual, readU64LE } from "../bytes.js";
import { connection } from "../client.js";
import { jupiterThroughApi, usdcMint, usdcMintKey } from "../config.js";
import {
  COMPUTE_BUDGET_RULE,
  CREATE_ATA_RULE,
  type BalanceLimits,
  type ProgramRule,
  verifyBalancesBeforeSigning,
} from "../presign-guard.js";
import { LEND_PROGRAM, LEND_RECEIPT_MINT, LEND_REDEEM, LEND_WITHDRAW } from "../relayed.js";
import type { RelayedDraft, RelayerTerms } from "../relayer.js";
import { signForSending, type StillUnlocked } from "../signerAccounts.js";
import { readTokenAmount } from "../swap/guard.js";
import { sendAndSettle, signatureOf } from "../settlement.js";
import { ataFor } from "../tokens.js";
import type { EarnPosition, EarnRate } from "./types.js";

/**
 * Jupiter Lend's USDC vault. Deposits mint `jlUSDC`, a receipt token whose
 * value in USDC grows as borrowers pay interest; withdrawing burns it back.
 *
 * Jupiter builds both transactions, so both go through the same pre-sign
 * guard as a swap: only Jupiter Lend's program may be called, USDC may drop
 * by no more than the deposit, and the receipt must actually arrive (or, on
 * the way out, the USDC must).
 */

const RECEIPT_MINT = LEND_RECEIPT_MINT;
const DECIMALS = 6;
const UNIT = 10 ** DECIMALS;

const PROGRAMS: ProgramRule[] = [COMPUTE_BUDGET_RULE, CREATE_ATA_RULE, { programId: LEND_PROGRAM }];

/**
 * SOL a first deposit may cost, and the guard's ceiling for every Earn
 * transaction. The receipt account's rent alone is 2,039,280 lamports, but
 * simulating real first deposits showed up to 3,656,268: Jupiter also opens an
 * account of its own for some first-time depositors. A withdrawal to a wallet
 * with no USDC account opens one too (2,039,280).
 */
export const EARN_FIRST_DEPOSIT_LAMPORTS = 5_000_000;
export const EARN_NETWORK_FEE_LAMPORTS = 50_000;

/** Shares-to-assets drift allowed between reading the rate and the transaction landing. */
const SLACK_BPS = 50n;

/**
 * The vault's own account, which every deposit and withdrawal passes through.
 * It records the price of a share in USDC, raw units for raw units, scaled by
 * `PRICE_SCALE`. Address and layout were read off genuine transactions and
 * matched against the rate the API reports.
 */
const LENDING_ACCOUNT = new PublicKey("2vVYHYM8VYnvZqQWpTJSj8o8DBf1wM8pVs3bsTgYZiqJ");
const LENDING_ACCOUNT_LEN = 196;
const ASSET_MINT_OFFSET = 8;
const RECEIPT_MINT_OFFSET = 40;
const SHARE_PRICE_OFFSET = 115;
const PRICE_SCALE = 1_000_000_000_000n;

/**
 * A share started at one USDC and only grows by the interest borrowers pay,
 * so its price can never be below one. The ceiling is not a forecast, only a
 * check that the bytes read really are a share price.
 */
const MAX_SHARE_PRICE = 2n * PRICE_SCALE;

/**
 * The share price as the chain holds it, not as the API reports it.
 *
 * The guard's limits are derived from this number, and the API that builds
 * the transaction is the last party that should supply it: a made-up rate
 * would loosen them, letting a deposit return too few shares or a withdrawal
 * burn too many. The stored price is as of the vault's last update, so the
 * live one is a touch higher; interest accrues at fractions of a basis point
 * a day, far inside `SLACK_BPS`.
 */
async function sharePrice(): Promise<bigint> {
  const account = await connection.getAccountInfo(LENDING_ACCOUNT);
  const readable =
    account?.owner.equals(LEND_PROGRAM) &&
    account.data.length === LENDING_ACCOUNT_LEN &&
    bytesEqual(
      account.data.subarray(ASSET_MINT_OFFSET, ASSET_MINT_OFFSET + 32),
      usdcMintKey().toBytes(),
    ) &&
    bytesEqual(
      account.data.subarray(RECEIPT_MINT_OFFSET, RECEIPT_MINT_OFFSET + 32),
      RECEIPT_MINT.toBytes(),
    );
  if (!account || !readable) {
    throw new Error("The Jupiter Lend vault could not be read as expected. Not signed.");
  }
  return readU64LE(account.data, SHARE_PRICE_OFFSET);
}

/** The receipt shares that `amountRaw` of USDC stands for at `price`, refusing a price that cannot be true. */
export function sharesFor(amountRaw: bigint, price: bigint): bigint {
  if (price < PRICE_SCALE || price > MAX_SHARE_PRICE) {
    throw new Error("The Jupiter Lend share price cannot be right. Not signed.");
  }
  return (amountRaw * PRICE_SCALE) / price;
}

/** What `shares` are worth in USDC at `price`, rounded down: the least a redemption returns. */
function assetsFor(shares: bigint, price: bigint): bigint {
  sharesFor(0n, price);
  return (shares * price) / PRICE_SCALE;
}

/**
 * Jupiter's withdrawal instruction turned into the program's `redeem` for
 * `shares`: the same accounts, with the instruction named in shares. A
 * withdrawal names USDC, and the shares it burns are worked out on chain at
 * a price that has moved on since any figure the app holds: asking for what
 * a whole position was last said to be worth either leaves a few shares
 * behind or asks for more than there is and fails. Redeeming every share
 * takes all of it, exactly. Anything but the withdrawal it expects is
 * refused.
 */
function asRedemption(withdrawal: TransactionInstruction, shares: bigint): TransactionInstruction {
  const { data } = withdrawal;
  if (
    !withdrawal.programId.equals(LEND_PROGRAM) ||
    data.length !== 16 ||
    !bytesEqual(data.subarray(0, 8), Uint8Array.from(LEND_WITHDRAW))
  ) {
    throw new Error("Jupiter Lend returned something other than a withdrawal. Not signed.");
  }
  const redeem = new Uint8Array(16);
  redeem.set(LEND_REDEEM, 0);
  new DataView(redeem.buffer).setBigUint64(8, shares, true);
  return new TransactionInstruction({
    programId: withdrawal.programId,
    keys: withdrawal.keys,
    data: Buffer.from(redeem),
  });
}

/**
 * What a withdrawal of `amountRaw` really is, read from the chain: when it
 * asks for everything the position is worth or more, it is the whole
 * position, taken back by its shares. That is what "Max" fills, and what any
 * amount above the position can only mean.
 */
async function withdrawalOf(
  receipt: Uint8Array | undefined,
  amountRaw: bigint,
): Promise<{ price: bigint; shares: bigint; all: boolean; amountRaw: bigint }> {
  const price = await sharePrice();
  const held = readTokenAmount(receipt);
  const worth = assetsFor(held, price);
  const all = held > 0n && amountRaw >= worth;
  return all
    ? { price, shares: held, all, amountRaw: worth }
    : { price, shares: sharesFor(amountRaw, price), all, amountRaw };
}

type VaultInfo = {
  address: string;
  supplyRate: string;
  rewardsRate: string;
  totalRate: string;
  convertToAssets: string;
  asset: { address: string };
};

/**
 * The vault's rate and share price, shared across every caller for a short
 * while. Every screen that shows Earn reads it, once per portfolio, and the
 * keyless Jupiter API allows about one request every two seconds - without
 * this a wallet with a few portfolios is rate-limited on its own home screen.
 * The share price moves by fractions of a basis point per minute, well inside
 * the guard's slack.
 */
const VAULT_TTL_MS = 30_000;
let vaultCache: { at: number; info: Promise<VaultInfo> } | null = null;

function vault(): Promise<VaultInfo> {
  if (vaultCache && Date.now() - vaultCache.at < VAULT_TTL_MS) return vaultCache.info;
  const info = fetchVault();
  vaultCache = { at: Date.now(), info };
  info.catch(() => {
    if (vaultCache?.info === info) vaultCache = null;
  });
  return info;
}

async function fetchVault(): Promise<VaultInfo> {
  const response = await jupiterThroughApi(`/lend/v1/earn/tokens`);
  if (!response.ok) throw new Error(`Jupiter Lend returned ${response.status}.`);
  const vaults = (await response.json()) as VaultInfo[];
  const usdc = vaults.find(
    (entry) => entry.asset.address === usdcMint() && entry.address === RECEIPT_MINT.toBase58(),
  );
  if (!usdc) throw new Error("Jupiter Lend is not offering this USDC vault right now.");
  return usdc;
}

function toRaw(amount: number): bigint {
  return BigInt(Math.round(amount * UNIT));
}

async function buildTransaction(
  action: "deposit" | "withdraw",
  owner: PublicKey,
  amountRaw: bigint,
): Promise<VersionedTransaction> {
  const response = await jupiterThroughApi(`/lend/v1/earn/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      asset: usdcMint(),
      signer: owner.toBase58(),
      amount: amountRaw.toString(),
    }),
  });
  const payload = (await response.json().catch(() => null)) as {
    transaction?: string;
    error?: string;
  } | null;
  if (!response.ok || !payload?.transaction) {
    throw new Error(payload?.error || `Jupiter Lend returned ${response.status}.`);
  }
  return VersionedTransaction.deserialize(Buffer.from(payload.transaction, "base64"));
}

/**
 * The owner is the only signer, so the transaction can carry a blockhash we
 * fetched ourselves; that gives an exact expiry to confirm against.
 */
async function signSendConfirm(
  transaction: VersionedTransaction,
  owner: Keypair,
  limits: BalanceLimits,
  stillUnlocked: StillUnlocked,
): Promise<string> {
  const verification = await verifyBalancesBeforeSigning(transaction, owner.publicKey, limits);
  if (!verification.ok) throw new Error(verification.reason);

  const latest = await connection.getLatestBlockhash("confirmed");
  transaction.message.recentBlockhash = latest.blockhash;
  await signForSending(transaction, owner, stillUnlocked, latest.lastValidBlockHeight);
  const signature = signatureOf(transaction)!;
  return sendAndSettle(
    transaction,
    signature,
    latest.lastValidBlockHeight,
    () => new Error("The transaction failed."),
  );
}

/**
 * Jupiter's transactions assume the account they pay into already exists: the
 * receipt account on a deposit, the USDC account on a withdrawal. Without it
 * the transaction fails on chain (Anchor 3012), which is every first deposit
 * and every withdrawal to a wallet that closed its USDC account. Creating it
 * idempotently in the same transaction is safe to add because the owner is
 * the only signer, and the guard still checks the result.
 */
function withTokenAccount(
  transaction: VersionedTransaction,
  owner: PublicKey,
  account: PublicKey,
  mint: PublicKey,
): VersionedTransaction {
  const message = TransactionMessage.decompile(transaction.message);
  message.instructions.unshift(
    createAssociatedTokenAccountIdempotentInstruction(owner, account, owner, mint),
  );
  return new VersionedTransaction(message.compileToV0Message());
}

/** `transaction` with its one Lend withdrawal turned into a redemption of `shares`. */
function redeeming(transaction: VersionedTransaction, shares: bigint): VersionedTransaction {
  const message = TransactionMessage.decompile(transaction.message);
  const lends = message.instructions.filter((entry) => entry.programId.equals(LEND_PROGRAM));
  if (lends.length !== 1) {
    throw new Error("Jupiter Lend returned something other than a withdrawal. Not signed.");
  }
  message.instructions = message.instructions.map((entry) =>
    entry === lends[0] ? asRedemption(entry, shares) : entry,
  );
  return new VersionedTransaction(message.compileToV0Message());
}

/**
 * Builds the transaction and the limits it must satisfy before it is signed.
 * Split from signing so the exact same check can be run against live
 * Jupiter-built transactions without moving anything.
 */
export async function prepareEarn(
  action: "deposit" | "withdraw",
  owner: PublicKey,
  amount: number,
): Promise<{ transaction: VersionedTransaction; limits: BalanceLimits }> {
  const cash = ataFor(usdcMintKey(), owner);
  const receipt = ataFor(RECEIPT_MINT, owner);
  const asked = toRaw(amount);
  const withdrawal =
    action === "withdraw"
      ? await withdrawalOf((await connection.getAccountInfo(receipt))?.data, asked)
      : null;
  const amountRaw = withdrawal?.amountRaw ?? asked;
  const shares = withdrawal?.shares ?? sharesFor(amountRaw, await sharePrice());
  const built = await buildTransaction(action, owner, amountRaw);
  const transaction =
    action === "deposit"
      ? withTokenAccount(built, owner, receipt, RECEIPT_MINT)
      : withTokenAccount(
          withdrawal?.all ? redeeming(built, shares) : built,
          owner,
          cash,
          usdcMintKey(),
        );
  const base = { maxLamportsSpent: BigInt(EARN_FIRST_DEPOSIT_LAMPORTS), programs: PROGRAMS };

  const limits: BalanceLimits =
    action === "deposit"
      ? {
          ...base,
          cashAccount: cash,
          maxCashSpent: amountRaw,
          receive: { account: receipt, minAmount: (shares * (10_000n - SLACK_BPS)) / 10_000n },
        }
      : {
          ...base,
          cashAccount: receipt,
          // Every share, and not one more, when the whole position is taken back.
          maxCashSpent: withdrawal?.all ? shares : (shares * (10_000n + SLACK_BPS)) / 10_000n + 1n,
          receive: { account: cash, minAmount: amountRaw - 1n },
        };
  return { transaction, limits };
}

type LendInstruction = {
  programId?: string;
  accounts?: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data?: string;
};

/**
 * Jupiter's deposit or withdrawal as a single instruction instead of a whole
 * transaction. Its transaction endpoints always make the depositor the fee
 * payer; the instruction is the same one, free to be placed in a transaction
 * somebody else pays for.
 */
async function lendInstruction(
  action: "deposit" | "withdraw",
  owner: PublicKey,
  amountRaw: bigint,
): Promise<TransactionInstruction> {
  const response = await jupiterThroughApi(`/lend/v1/earn/${action}-instructions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      asset: usdcMint(),
      signer: owner.toBase58(),
      amount: amountRaw.toString(),
    }),
  });
  const payload = (await response.json().catch(() => null)) as {
    instructions?: LendInstruction[];
    error?: string;
  } | null;
  const [instruction, ...rest] = payload?.instructions ?? [];
  if (!response.ok || !instruction?.accounts || !instruction.data || rest.length > 0) {
    throw new Error(payload?.error || `Jupiter Lend returned ${response.status}.`);
  }
  if (instruction.programId !== LEND_PROGRAM.toBase58()) {
    throw new Error("Jupiter Lend returned an instruction for another program. Not signed.");
  }
  return new TransactionInstruction({
    programId: LEND_PROGRAM,
    keys: instruction.accounts.map((account) => ({
      pubkey: new PublicKey(account.pubkey),
      isSigner: account.isSigner,
      isWritable: account.isWritable,
    })),
    data: Buffer.from(instruction.data, "base64"),
  });
}

/**
 * The instruction that takes a whole position back: Jupiter's own withdrawal
 * for `owner`, of about what the position is worth, turned into a redemption
 * of `shares`. Built and nothing more: it is signed and sent by nobody here.
 */
export async function redemptionInstruction(
  owner: PublicKey,
  shares: bigint,
  worthRaw: bigint,
): Promise<TransactionInstruction> {
  return asRedemption(await lendInstruction("withdraw", owner, worthRaw), shares);
}

const TRANSFER_CHECKED = 12;

/** What a relayer-paid Earn transaction may call directly: the account it opens, Lend, and the payment. */
const RELAYED_PROGRAMS: ProgramRule[] = [
  { programId: ASSOCIATED_TOKEN_PROGRAM_ID },
  { programId: LEND_PROGRAM },
  { programId: TOKEN_PROGRAM_ID, instructions: [TRANSFER_CHECKED] },
];

/**
 * A deposit or withdrawal built for the fee relayer to pay for: Jupiter's
 * own Lend instruction, unmodified, preceded by the account it pays into
 * when that is missing, opened at `terms.feePayer`'s expense. The payment
 * that covers the cost is added after it by the caller, so a withdrawal pays
 * out of what it returns: a portfolio whose cash is all lent, with no USDC
 * left and no USDC account even, can still take it back.
 *
 * The account is opened only when missing, unlike the self-paid path: the
 * relay charges rent for every create the relayer funds, needed or not.
 *
 * The limits are the self-paid ones with the payment added to what cash may
 * leave (or taken off what must arrive), and no SOL at all: the portfolio
 * pays none. A first deposit for which Jupiter opens an account of its own
 * at the depositor's expense therefore fails its simulation here, and is
 * left to the self-paid path.
 */
export async function relayedEarnDraft(
  action: "deposit" | "withdraw",
  owner: PublicKey,
  amount: number,
  terms: RelayerTerms,
): Promise<RelayedDraft> {
  const cash = ataFor(usdcMintKey(), owner);
  const receipt = ataFor(RECEIPT_MINT, owner);
  const [cashInfo, receiptInfo] = await connection.getMultipleAccountsInfo([cash, receipt]);

  // While pricing, the fee is a placeholder: a deposit of everything is reduced to leave room for it.
  const room = readTokenAmount(cashInfo?.data) - terms.feeRaw;
  const asked = toRaw(amount);
  const withdrawal = action === "withdraw" ? await withdrawalOf(receiptInfo?.data, asked) : null;
  const amountRaw = withdrawal?.amountRaw ?? (terms.pricing && asked > room ? room : asked);
  if (amountRaw <= 0n) throw new Error("Enter an amount greater than zero.");
  if (action === "withdraw" && amountRaw <= terms.feeRaw + 1n) {
    throw new Error("This withdrawal is smaller than its own network cost.");
  }

  const shares = withdrawal?.shares ?? sharesFor(amountRaw, await sharePrice());
  const paidInto = action === "deposit" ? RECEIPT_MINT : usdcMintKey();
  const exists = action === "deposit" ? receiptInfo : cashInfo;
  const opens = exists ? null : { owner, mint: paidInto, programId: TOKEN_PROGRAM_ID };
  const lend = withdrawal?.all
    ? await redemptionInstruction(owner, shares, amountRaw)
    : await lendInstruction(action, owner, amountRaw);

  return {
    instructions: [
      ...(opens
        ? [
            createAssociatedTokenAccountIdempotentInstruction(
              terms.feePayer,
              ataFor(paidInto, owner),
              owner,
              paidInto,
            ),
          ]
        : []),
      lend,
    ],
    intent: withdrawal?.all ? { kind: "redeem", amountRaw: shares } : { kind: action, amountRaw },
    opens,
    mints: [
      { mint: usdcMintKey(), programId: TOKEN_PROGRAM_ID },
      { mint: RECEIPT_MINT, programId: TOKEN_PROGRAM_ID },
    ],
    limits: (feeRaw) =>
      action === "deposit"
        ? {
            cashAccount: cash,
            maxCashSpent: amountRaw + feeRaw,
            maxLamportsSpent: 0n,
            receive: { account: receipt, minAmount: (shares * (10_000n - SLACK_BPS)) / 10_000n },
            programs: RELAYED_PROGRAMS,
          }
        : {
            cashAccount: receipt,
            maxCashSpent: withdrawal?.all
              ? shares
              : (shares * (10_000n + SLACK_BPS)) / 10_000n + 1n,
            maxLamportsSpent: 0n,
            receive: { account: cash, minAmount: amountRaw - 1n - feeRaw },
            programs: RELAYED_PROGRAMS,
          },
  };
}

export const jupiterLend = {
  name: "Jupiter Lend",

  async rate(): Promise<EarnRate> {
    const info = await vault();
    return {
      apy: Number(info.totalRate) / 100,
      supplyApy: Number(info.supplyRate) / 100,
      rewardsApy: Number(info.rewardsRate) / 100,
    };
  },

  async position(owner: PublicKey): Promise<EarnPosition> {
    const receiptAccount = ataFor(RECEIPT_MINT, owner);
    const [info, [wallet, receipt]] = await Promise.all([
      vault(),
      connection.getMultipleAccountsInfo([owner, receiptAccount]),
    ]);
    const shares = readTokenAmount(receipt?.data);
    const position = {
      deposited: Number((shares * BigInt(info.convertToAssets)) / BigInt(UNIT)) / UNIT,
      hasReceiptAccount: receipt !== null,
      lamports: wallet?.lamports ?? 0,
    };
    // Nothing lent means nothing earned, and most portfolios lend nothing:
    // the earnings history is only worth a request when there is a position.
    if (shares === 0n) return { ...position, earnedSinceDeposit: null };

    let earnedSinceDeposit: number | null = null;
    try {
      // A POST, not Jupiter's own GET: the relay builds the query on its
      // side, so the portfolio's address is in no URL of ours.
      const response = await jupiterThroughApi(`/lend/v1/earn/earnings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: owner.toBase58(), positions: RECEIPT_MINT.toBase58() }),
      });
      const rows = (await response.json()) as { earnings?: string }[];
      if (response.ok && rows[0]?.earnings !== undefined) {
        earnedSinceDeposit = Number(rows[0].earnings) / UNIT;
      }
    } catch {
      /* the balance is what matters; earnings history is a nicety */
    }

    return { ...position, earnedSinceDeposit };
  },

  async deposit(owner: Keypair, amount: number, stillUnlocked: StillUnlocked): Promise<string> {
    const { transaction, limits } = await prepareEarn("deposit", owner.publicKey, amount);
    return signSendConfirm(transaction, owner, limits, stillUnlocked);
  },

  async withdraw(owner: Keypair, amount: number, stillUnlocked: StillUnlocked): Promise<string> {
    const { transaction, limits } = await prepareEarn("withdraw", owner.publicKey, amount);
    return signSendConfirm(transaction, owner, limits, stillUnlocked);
  },
};
