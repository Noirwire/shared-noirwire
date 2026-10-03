import "./buffer-polyfill.js";

import {
  ACCOUNT_SIZE,
  AccountType,
  MINT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, SystemProgram, type AccountInfo } from "@solana/web3.js";
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

function unsendableReason(to: PublicKey, account: AccountInfo<Uint8Array> | null): string | null {
  if (account?.executable) {
    return "This is a program's address, not a wallet. Anything sent to it could not be moved again.";
  }
  if (account?.owner.equals(TOKEN_PROGRAM_ID) || account?.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    return isMint(account.data)
      ? "This is a token's own mint address, not a wallet. Anything sent to it could not be moved again."
      : "This is a token account, not a wallet. Send to the wallet address that owns it instead.";
  }
  if (!PublicKey.isOnCurve(to.toBytes())) return NOT_A_WALLET_ADDRESS;
  // A stake, vote or other program-owned account has a key behind its address,
  // but what it holds moves only by that program's rules, not by a transfer.
  if (account && !account.owner.equals(SystemProgram.programId)) {
    return "This address is an account that a program controls, such as a stake account, not an ordinary wallet. Ask for the recipient's wallet address.";
  }
  return null;
}

/**
 * Refuses a recipient that is not an ordinary wallet. Every 32-byte value is
 * a well-formed address, and pasting a mint, a token account or a program
 * where a wallet address belongs is an easy mistake that sends funds
 * somewhere they can never leave. The account is read first so the refusal
 * can say which of those it is. An address that does not exist yet is a
 * wallet nobody has funded, and is allowed; one that exists must belong to
 * the System program, as every wallet does.
 */
export async function requireSendableRecipient(to: PublicKey): Promise<void> {
  const reason = unsendableReason(to, await connection.getAccountInfo(to));
  if (reason) throw new Error(reason);
}
