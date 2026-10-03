import "./buffer-polyfill.js";

import { ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  SystemProgram,
  type MessageAccountKeys,
  type PublicKey,
  type VersionedTransaction,
} from "@solana/web3.js";
import { readU32LE } from "./bytes.js";
import { connection } from "./client.js";
import { ownedTokenAccounts, resolveAccountKeys } from "./signerAccounts.js";
import {
  decodeAccount,
  readTokenAmount,
  tokenAccountClosed,
  tokenControlChanged,
} from "./swap/guard.js";

/**
 * The private-payment service and the lending venue both build the
 * transaction the wallet signs, which is the same trust problem a swap venue
 * poses: a third party hands back bytes and asks for a signature. So they get
 * the same answer - run it first, and refuse to sign unless what it does to
 * the signer's accounts is what was asked for.
 *
 * Checked against the simulated end state of every account the signer owns
 * that the transaction references, rather than against what the instructions
 * claim:
 * - the cash token drops by no more than the amount plus the published fee,
 * - SOL drops by no more than the rent and network fee budgeted for,
 * - no other token balance drops at all,
 * - when something is owed back (a deposit receipt), at least that much arrives,
 * - no token account gains a new owner, delegate or close authority,
 * - no token account that existed before is closed.
 */

/**
 * A program the transaction may call at the top level, optionally limited to
 * specific instructions by their first data byte.
 *
 * Balance checks alone cannot tell where money went: a transaction that
 * spends exactly the requested amount into an attacker's account looks
 * identical, from the sender's side, to one that queues it privately. So the
 * trust boundary is moved from the service's HTTP API to its on-chain
 * program. Only the named programs may be invoked directly, and the token
 * programs never are - any token movement has to happen inside the service's
 * own program, which is the thing being trusted in the first place.
 */
export type ProgramRule = { programId: PublicKey; instructions?: number[] };

export const COMPUTE_BUDGET_RULE: ProgramRule = { programId: ComputeBudgetProgram.programId };
/** Create and create-idempotent only; the program's other instructions can move tokens. */
export const CREATE_ATA_RULE: ProgramRule = {
  programId: ASSOCIATED_TOKEN_PROGRAM_ID,
  instructions: [0, 1],
};

/** The System program's instruction index for AdvanceNonceAccount, a little-endian u32. */
const ADVANCE_NONCE_ACCOUNT = 4;

/**
 * Whether the transaction runs on a durable nonce instead of a recent
 * blockhash. Such a transaction never expires: once signed it can be held
 * back and landed whenever it suits whoever holds it, long after the balances
 * and prices it was checked against have moved. The runtime only treats a
 * transaction this way when the nonce advance is its first instruction.
 */
export function usesDurableNonce(
  transaction: VersionedTransaction,
  accountKeys: MessageAccountKeys,
): boolean {
  const first = transaction.message.compiledInstructions[0];
  if (!first || !accountKeys.get(first.programIdIndex)?.equals(SystemProgram.programId)) {
    return false;
  }
  return first.data.length >= 4 && readU32LE(first.data, 0) === ADVANCE_NONCE_ACCOUNT;
}

/**
 * Every top-level instruction must match a rule, and the transaction must
 * expire with its blockhash. Lookup-table programs are resolved first.
 */
export function checkPrograms(
  transaction: VersionedTransaction,
  accountKeys: MessageAccountKeys,
  rules: ProgramRule[],
): BalanceVerification {
  if (usesDurableNonce(transaction, accountKeys)) {
    return {
      ok: false,
      reason: "This transaction would stay valid indefinitely instead of expiring. Not signed.",
    };
  }
  for (const instruction of transaction.message.compiledInstructions) {
    const programId = accountKeys.get(instruction.programIdIndex);
    const rule = rules.find((candidate) => programId?.equals(candidate.programId));
    const allowed =
      rule !== undefined &&
      (rule.instructions === undefined || rule.instructions.includes(instruction.data[0]));
    if (!allowed) {
      return {
        ok: false,
        reason: `This transaction calls a program it has no reason to (${programId?.toBase58() ?? "unknown"}). Not signed.`,
      };
    }
  }
  return { ok: true };
}

export type BalanceLimits = {
  cashAccount: PublicKey;
  maxCashSpent: bigint;
  maxLamportsSpent: bigint;
  /** A second token account the action itself debits, e.g. the tracker a send moves while cash pays its cost. */
  alsoSpends?: { account: PublicKey; maxAmount: bigint };
  /**
   * For a transaction the app built itself, where what moves is known to the
   * unit: each debit must then be exactly its limit and what is received
   * exactly `receive.minAmount`, not merely within them.
   */
  exact?: boolean;
  /** A token account that must grow by at least `minAmount`, e.g. a lending receipt. */
  receive?: { account: PublicKey; minAmount: bigint };
  /** The only programs the transaction may call directly. */
  programs: ProgramRule[];
};

export type BalanceSnapshot = {
  lamports: bigint;
  /** Token amount per token-account address. */
  tokens: Map<string, bigint>;
};

type BalanceVerification = { ok: true } | { ok: false; reason: string };

/** Pure comparison of two balance snapshots against the limits, split out so it can be tested. */
export function checkBalanceChanges(
  before: BalanceSnapshot,
  after: BalanceSnapshot,
  limits: BalanceLimits,
): BalanceVerification {
  const lamportsSpent = before.lamports - after.lamports;
  if (lamportsSpent > limits.maxLamportsSpent) {
    return {
      ok: false,
      reason: `This transaction would spend more SOL than expected (${lamportsSpent} lamports).`,
    };
  }

  const allowed = new Map([[limits.cashAccount.toBase58(), limits.maxCashSpent]]);
  if (limits.alsoSpends) {
    allowed.set(limits.alsoSpends.account.toBase58(), limits.alsoSpends.maxAmount);
  }
  for (const [address, amountBefore] of before.tokens) {
    const spent = amountBefore - (after.tokens.get(address) ?? 0n);
    const limit = allowed.get(address);
    if (limit === undefined) {
      if (spent > 0n) {
        return { ok: false, reason: "This transaction would also move another asset. Not signed." };
      }
    } else if (spent > limit) {
      return {
        ok: false,
        reason: `This transaction would take more than the amount plus its fee (${spent} units).`,
      };
    } else if (limits.exact && spent !== limit) {
      return {
        ok: false,
        reason: `This transaction would not move the amount that was reviewed (${spent} units). Not signed.`,
      };
    }
  }

  if (limits.receive) {
    const key = limits.receive.account.toBase58();
    const received = (after.tokens.get(key) ?? 0n) - (before.tokens.get(key) ?? 0n);
    if (received < limits.receive.minAmount) {
      return {
        ok: false,
        reason: `This would return less than expected (${received} of ${limits.receive.minAmount} units).`,
      };
    }
    if (limits.exact && received !== limits.receive.minAmount) {
      return {
        ok: false,
        reason: `This would not deliver the amount that was reviewed (${received} units). Not signed.`,
      };
    }
  }

  return { ok: true };
}

export async function verifyBalancesBeforeSigning(
  transaction: VersionedTransaction,
  sender: PublicKey,
  limits: BalanceLimits,
): Promise<BalanceVerification> {
  const [owned, accountKeys] = await Promise.all([
    ownedTokenAccounts(sender),
    resolveAccountKeys(transaction),
  ]);
  const programs = checkPrograms(transaction, accountKeys, limits.programs);
  if (!programs.ok) return programs;

  const referenced = new Set<string>();
  for (let i = 0; i < accountKeys.length; i += 1) referenced.add(accountKeys.get(i)!.toBase58());
  const tokenAccounts = owned.filter((account) => referenced.has(account.toBase58()));
  for (const required of [
    limits.cashAccount,
    limits.alsoSpends?.account,
    limits.receive?.account,
  ]) {
    if (required && !tokenAccounts.some((account) => account.equals(required))) {
      tokenAccounts.push(required);
    }
  }
  const watched = [sender, ...tokenAccounts];

  const infos = await connection.getMultipleAccountsInfo(watched);
  const before: BalanceSnapshot = {
    lamports: BigInt(infos[0]?.lamports ?? 0),
    tokens: new Map(
      tokenAccounts.map((account, i) => [account.toBase58(), readTokenAmount(infos[i + 1]?.data)]),
    ),
  };

  const simulation = await connection.simulateTransaction(transaction, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    accounts: { encoding: "base64", addresses: watched.map((account) => account.toBase58()) },
  });

  if (simulation.value.err) {
    return {
      ok: false,
      reason: `The transaction would fail on chain (${JSON.stringify(simulation.value.err)}).`,
    };
  }
  const simulated = simulation.value.accounts;
  if (!simulated || simulated.length !== watched.length) {
    return { ok: false, reason: "The transaction could not be checked before signing." };
  }

  if (simulated[0] && simulated[0].owner !== SystemProgram.programId.toBase58()) {
    return {
      ok: false,
      reason: "This transaction would hand your wallet to a program. Not signed.",
    };
  }
  for (let i = 0; i < tokenAccounts.length; i += 1) {
    const dataBefore = infos[i + 1]?.data;
    const dataAfter = decodeAccount(simulated[i + 1] as never);
    // An empty account has no balance to notice missing, and closing it pays
    // its rent to whoever the instruction names.
    if (!tokenAccountClosed(dataBefore) && tokenAccountClosed(dataAfter)) {
      return {
        ok: false,
        reason: "This transaction would close one of your token accounts. Not signed.",
      };
    }
    if (tokenControlChanged(dataBefore, dataAfter)) {
      return {
        ok: false,
        reason: "This transaction would give someone else control of your funds. Not signed.",
      };
    }
  }

  const after: BalanceSnapshot = {
    lamports: BigInt(simulated[0]?.lamports ?? 0),
    tokens: new Map(
      tokenAccounts.map((account, i) => [
        account.toBase58(),
        readTokenAmount(decodeAccount(simulated[i + 1] as never)),
      ]),
    ),
  };

  return checkBalanceChanges(before, after, limits);
}
