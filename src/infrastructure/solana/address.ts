import "./buffer-polyfill.js";

import {
  ACCOUNT_SIZE,
  AccountType,
  MINT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, SystemProgram, type AccountInfo } from "@solana/web3.js";
import type { Unsendable } from "../../domain/recipients.js";
import { connection } from "./client.js";

/**
 * Format validation only; it does not verify an address's owner or token
 * support. Solana addresses have no checksum, so a well-formed-looking
 * string with a typo is indistinguishable from a real one - `PublicKey`'s
 * own base58 decode plus its exact-32-byte-length check is the full extent
 * of what can be verified offline.
 */
export function isRecipientAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

export const NOT_A_WALLET_ADDRESS =
  "This address has no private key behind it: it is a token account or another address a program controls, not a wallet. Ask for the recipient's wallet address.";

/**
 * True for a well-formed address that is not a point on the ed25519 curve.
 * No keypair can exist for one, so nobody could sign for what it was sent.
 * Checked offline, which is why the form can say so before anything is read.
 */
export function isOffCurveAddress(address: string): boolean {
  return isRecipientAddress(address) && !PublicKey.isOnCurve(new PublicKey(address).toBytes());
}

/** In Token-2022 both kinds can grow past their base size; the byte after the base account layout says which it is. */
function isMint(data: Uint8Array): boolean {
  return data.length === MINT_SIZE || data[ACCOUNT_SIZE] === AccountType.Mint;
}

/** The parts of an account the recipient check reads. Null for an address that holds nothing yet. */
export type RecipientAccount = {
  executable: boolean;
  owner: string;
  data: Uint8Array;
} | null;

const TOKEN_PROGRAMS = new Set([TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()]);
const SYSTEM_PROGRAM = SystemProgram.programId.toBase58();

/**
 * Why `address` cannot receive a send, given what the network holds at it,
 * or null for a wallet. An address that does not exist yet is a wallet
 * nobody has funded, and is allowed; one that exists must belong to the
 * System program, as every wallet does. A stake, vote or other
 * program-owned account has a key behind its address, but what it holds
 * moves only by that program's rules, not by a transfer.
 */
export function unsendable(address: string, account: RecipientAccount): Unsendable | null {
  if (account?.executable) return "program";
  if (account && TOKEN_PROGRAMS.has(account.owner)) {
    return isMint(account.data) ? "mint" : "tokenAccount";
  }
  if (isOffCurveAddress(address)) return "offCurve";
  if (account && account.owner !== SYSTEM_PROGRAM) return "programOwned";
  return null;
}

function recipientAccount(account: AccountInfo<Uint8Array> | null): RecipientAccount {
  return (
    account && {
      executable: account.executable,
      owner: account.owner.toBase58(),
      data: account.data,
    }
  );
}

/**
 * Reads the recipient from the network and says why it cannot receive, or
 * null for a wallet. The same reading every send makes before signing, so a
 * review can say which it is before anything is asked of the person.
 */
export async function checkRecipient(address: string): Promise<Unsendable | null> {
  return unsendable(
    address,
    recipientAccount(await connection.getAccountInfo(new PublicKey(address))),
  );
}

const REFUSALS: Record<Unsendable, string> = {
  program:
    "This is a program's address, not a wallet. Anything sent to it could not be moved again.",
  mint: "This is a token's own mint address, not a wallet. Anything sent to it could not be moved again.",
  tokenAccount:
    "This is a token account, not a wallet. Send to the wallet address that owns it instead.",
  offCurve: NOT_A_WALLET_ADDRESS,
  programOwned:
    "This address is an account that a program controls, such as a stake account, not an ordinary wallet. Ask for the recipient's wallet address.",
};

/**
 * Refuses a recipient that is not an ordinary wallet. Every 32-byte value is
 * a well-formed address, and pasting a mint, a token account or a program
 * where a wallet address belongs is an easy mistake that sends funds
 * somewhere they can never leave. The account is read first so the refusal
 * can say which of those it is.
 */
export async function requireSendableRecipient(to: PublicKey): Promise<void> {
  const reason = unsendable(to.toBase58(), recipientAccount(await connection.getAccountInfo(to)));
  if (reason) throw new Error(REFUSALS[reason]);
}

export type ScannedRecipient = { address: string; fromPaymentCode: boolean };

/**
 * The address in a scanned code: a plain Solana address, or the address of a
 * `solana:` payment code with everything after it dropped. Null for anything
 * else. An amount or a label in a payment code is never taken.
 */
export function recipientFromCode(text: string): ScannedRecipient | null {
  const trimmed = text.trim();
  if (isRecipientAddress(trimmed)) return { address: trimmed, fromPaymentCode: false };
  const payment = /^solana:([^?/#]+)/i.exec(trimmed);
  if (payment && isRecipientAddress(payment[1])) {
    return { address: payment[1], fromPaymentCode: true };
  }
  return null;
}
