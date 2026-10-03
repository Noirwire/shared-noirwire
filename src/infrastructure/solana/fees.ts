import "./buffer-polyfill.js";

import type { Keypair } from "@solana/web3.js";
import { connection } from "./client.js";

/**
 * What a one-signature transaction costs. 5,000 lamports/signature is
 * Solana's standard base fee absent priority fees, which nothing here sets.
 */
export const NETWORK_FEE_LAMPORTS = 5_000;

/**
 * Throws a plain, user-facing error if `funder` clearly can't cover
 * `lamportsNeeded` (its own balance requirement plus a fee floor). This is
 * only an upfront sanity check for a friendly error message, never an exact
 * fee calculation.
 */
export async function requireFunderCovers(funder: Keypair, lamportsNeeded: number): Promise<void> {
  const funderBalance = await connection.getBalance(funder.publicKey);
  if (funderBalance < lamportsNeeded + NETWORK_FEE_LAMPORTS) {
    throw new Error("The funding wallet does not have enough SOL to cover this.");
  }
}

/**
 * The lamports a sender holding `balance` would need to pay `lamportsOut`
 * itself, or null when it already can. More than `lamportsOut` when paying would leave a remainder
 * the network refuses: an address may end a transaction holding nothing, or
 * enough to be rent-exempt, but not an amount in between unless it was
 * already below that line.
 */
export async function shortfallFor(
  balance: number,
  lamportsOut: number,
): Promise<{ required: number } | null> {
  if (balance < lamportsOut) return { required: lamportsOut };
  const left = balance - lamportsOut;
  if (left === 0) return null;
  const rentExempt = await connection.getMinimumBalanceForRentExemption(0);
  return balance >= rentExempt && left < rentExempt ? { required: lamportsOut + rentExempt } : null;
}

/**
 * Refuses, before anything is built, a send whose sender holds `balance`
 * lamports and cannot pay `lamportsNeeded` (for `purpose`) out of them.
 *
 * A portfolio pays for its own sends. The funding wallet could cover the fee,
 * but only by signing the same transaction, and that transaction would then
 * name both addresses on chain: the one link a portfolio exists to not have.
 *
 * The review covers a portfolio's network cost before a send gets this far
 * (src/application/networkCost.ts), so for a portfolio this is the last
 * line of defence against a balance that moved in between, and it says only
 * that.
 */
export async function requireSenderCovers(
  balance: number,
  lamportsNeeded: number,
  purpose: string,
  senderIsFundingWallet: boolean,
): Promise<void> {
  const short = await shortfallFor(balance, lamportsNeeded);
  if (!short) return;
  if (senderIsFundingWallet) {
    throw new Error("The funding wallet does not have enough SOL to cover this.");
  }
  throw new Error(`This portfolio cannot pay for ${purpose} right now. Review it again.`);
}
