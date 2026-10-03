import "./buffer-polyfill.js";

import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { requireSendableRecipient } from "./address.js";
import { connection } from "./client.js";
import { NETWORK_FEE_LAMPORTS, requireSenderCovers } from "./fees.js";
import { signForSending, type StillUnlocked } from "./signerAccounts.js";
import { sendAndSettle, signatureOf } from "./settlement.js";

/**
 * Native SOL held by an account's own keypair. No program sits between the
 * user and their SOL: an account is a derived keypair, which holds SOL by
 * definition, so creating one is free and instant.
 */

export function solToLamports(sol: number): number {
  return Math.round(sol * LAMPORTS_PER_SOL);
}

export function lamportsToSol(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL;
}

export async function getWalletBalanceSol(pubkey: PublicKey): Promise<number> {
  return lamportsToSol(await connection.getBalance(pubkey));
}

/**
 * An amount typed in display units, as the whole base units that will move.
 * A JavaScript number carries about 15 significant digits, so an amount is
 * refused when it would round to nothing or cannot be represented exactly,
 * rather than sent as a figure the user did not type.
 */
export function toRawUnits(amount: number, decimals: number): bigint {
  const scaled = Math.round(amount * 10 ** decimals);
  if (!Number.isFinite(scaled) || scaled > Number.MAX_SAFE_INTEGER) {
    throw new Error("This amount is too large to send exactly. Send it in smaller parts.");
  }
  if (scaled <= 0) {
    throw new Error("This amount is smaller than the smallest unit that can be sent.");
  }
  return BigInt(scaled);
}

/**
 * Signs `instructions` once with `payer`, its fee payer and only signer,
 * sends it, and returns the signature once the chain shows it confirmed,
 * which it is asked for until it answers or the blockhash has expired.
 *
 * From the moment it is sent the transaction may land whatever happens to
 * the connection, so an error after that is not yet a failure. Only the RPC
 * rejecting it outright is; anything else is settled against the chain, and
 * thrown as `UnknownOutcomeError` when the chain cannot say either. Nothing
 * is signed a second time, so a caller that retries does so knowingly.
 *
 * `stillUnlocked` is asked right before the key is used. Every path in the
 * app passes its session's answer; it only defaults to yes for code that
 * holds a key with no wallet session behind it.
 */
export async function signSendConfirm(
  instructions: TransactionInstruction[],
  payer: Keypair,
  stillUnlocked: StillUnlocked = () => true,
): Promise<string> {
  const latest = await connection.getLatestBlockhash("confirmed");
  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: latest.blockhash,
      instructions,
    }).compileToLegacyMessage(),
  );
  await signForSending(transaction, payer, stillUnlocked, latest.lastValidBlockHeight);
  const signature = signatureOf(transaction)!;
  return sendAndSettle(
    transaction,
    signature,
    latest.lastValidBlockHeight,
    () => new Error("The transfer failed on chain."),
  );
}

/**
 * An account needs no on-chain setup before it can receive: a keypair that
 * has never been touched can be sent SOL, and a private transfer opens the
 * recipient's token account as part of settlement. Kept as an explicit no-op
 * so the asset interface stays uniform across SOL and tokens.
 */
export async function ensureSolAccountReady(): Promise<void> {}

/** Sends `amountSol` from `funder` to `owner`. A plain transfer - `funder` signs and pays the fee. */
export async function depositSol(
  funder: Keypair,
  owner: PublicKey,
  amountSol: number,
  stillUnlocked?: StillUnlocked,
): Promise<void> {
  await signSendConfirm(
    [
      SystemProgram.transfer({
        fromPubkey: funder.publicKey,
        toPubkey: owner,
        lamports: toRawUnits(amountSol, 9),
      }),
    ],
    funder,
    stillUnlocked,
  );
}

/**
 * Sends `owner`'s own SOL on to `to`. `owner` is the fee payer and the only
 * signer, so the fee comes out of the same balance: asking for exactly what
 * it holds sends that less the fee, and leaves nothing behind.
 *
 * `funder` never signs or pays. A transaction it co-signed would name the
 * funding wallet and the portfolio together on chain. It is taken only to
 * tell a send from the funding wallet itself apart, for the wording of a
 * refusal.
 */
export async function sendSolTo(
  owner: Keypair,
  funder: Keypair,
  to: PublicKey,
  amountSol: number,
  stillUnlocked?: StillUnlocked,
): Promise<void> {
  await requireSendableRecipient(to);

  const balance = await connection.getBalance(owner.publicKey);
  const sendingAll = amountSol === lamportsToSol(balance);
  if (sendingAll && balance <= NETWORK_FEE_LAMPORTS) {
    throw new Error("There is too little SOL here to cover the network fee of a send.");
  }
  const lamports = sendingAll ? BigInt(balance - NETWORK_FEE_LAMPORTS) : toRawUnits(amountSol, 9);

  await requireSenderCovers(
    balance,
    Number(lamports) + NETWORK_FEE_LAMPORTS,
    "this amount and the network fee",
    owner.publicKey.equals(funder.publicKey),
  );

  await signSendConfirm(
    [SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: to, lamports })],
    owner,
    stillUnlocked,
  );
}
