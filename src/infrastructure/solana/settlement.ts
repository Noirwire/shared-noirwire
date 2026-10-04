import "./buffer-polyfill.js";

import { Buffer } from "buffer";
import { SendTransactionError, type VersionedTransaction } from "@solana/web3.js";
import { connection } from "./client.js";
import { isChainError } from "../../domain/chainError.js";
import { UnknownOutcomeError } from "./swap/types.js";

/**
 * How a sent transaction is settled: read back from the chain, never taken
 * on the word of whoever sent it. Every route that sends a transaction
 * itself ends here, and keeps its own guard for what it signs.
 */

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58(bytes: Uint8Array): string {
  let value = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let encoded = "";
  for (; value > 0n; value /= 58n) encoded = BASE58[Number(value % 58n)] + encoded;
  for (let i = 0; bytes[i] === 0; i += 1) encoded = `1${encoded}`;
  return encoded;
}

const isSigned = (bytes: Uint8Array) => bytes.some((byte) => byte !== 0);

/**
 * The id a signed transaction will have on chain: its first signature, in
 * base58. Null while that slot is still empty, which is the case whenever
 * someone else pays the fee (an RFQ or gasless order) and signs after us.
 */
export function signatureOf(transaction: VersionedTransaction): string | null {
  const bytes = transaction.signatures[0];
  return bytes && isSigned(bytes) ? base58(bytes) : null;
}

/** Every signature a transaction carries so far, in base58. */
export function signaturesOf(transaction: VersionedTransaction): string[] {
  return transaction.signatures.filter(isSigned).map(base58);
}

/**
 * What the chain itself says became of a transaction that was sent, for when
 * whoever was landing it stopped answering. "failed" is only ever a fact: an
 * error recorded on chain, or a blockhash that expired with no trace of the
 * transaction. Anything short of that is "unknown".
 *
 * The block height is read before the status on purpose. Read the other way
 * round, a transaction landing between the two calls would be seen as absent
 * and then as expired.
 */
async function broadcastOutcome(
  signature: string,
  lastValidBlockHeight?: number,
): Promise<"confirmed" | "failed" | "unknown"> {
  try {
    const height = lastValidBlockHeight ? await connection.getBlockHeight("finalized") : 0;
    const { value } = await connection.getSignatureStatus(signature, {
      searchTransactionHistory: true,
    });
    if (value?.err) return "failed";
    if (value?.confirmationStatus === "confirmed" || value?.confirmationStatus === "finalized") {
      return "confirmed";
    }
    if (!value && lastValidBlockHeight && height > lastValidBlockHeight) return "failed";
    return "unknown";
  } catch {
    return "unknown";
  }
}

const CONFIRM_POLL_MS = 1_000;

/**
 * `broadcastOutcome`, asked again until it is no longer unknown or `waitMs`
 * has passed. This is how every transaction is confirmed: the RPC is reached
 * through a relay that cannot hold a websocket, so nothing subscribes.
 */
export async function outcomeWithin(
  signature: string,
  lastValidBlockHeight: number | undefined,
  waitMs: number,
): Promise<"confirmed" | "failed" | "unknown"> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const outcome = await broadcastOutcome(signature, lastValidBlockHeight);
    if (outcome !== "unknown" || Date.now() >= deadline) return outcome;
    await new Promise((resolve) => setTimeout(resolve, CONFIRM_POLL_MS));
  }
}

/**
 * How long a transaction we sent ourselves is watched for. Its blockhash
 * stops being valid after about a minute, and the finalized height that
 * proves it takes some seconds more to pass, so by then the chain has
 * answered either way: it landed, or it never can.
 */
export const OWN_SEND_WAIT_MS = 120_000;

/**
 * Sends a transaction this wallet signed and paid the blockhash of, and
 * returns `signature` once the chain shows it confirmed.
 *
 * From the moment it is sent the transaction may land whatever happens to
 * the connection, so an error after that is not yet a failure. Only the RPC
 * rejecting it outright is, or NoirWire's server refusing the request before
 * it passed anything on; anything else is settled against the chain, and
 * thrown as `UnknownOutcomeError` when the chain cannot say either. A
 * transaction the chain shows failed is thrown as `failed()`, each route's
 * own error.
 */
export async function sendAndSettle(
  transaction: VersionedTransaction,
  signature: string,
  lastValidBlockHeight: number,
  failed: () => Error,
): Promise<string> {
  const sent = await connection.sendRawTransaction(transaction.serialize()).then(
    () => true,
    (error: unknown) => {
      if (error instanceof SendTransactionError) throw error;
      // The server would not take the request, so it never had the transaction.
      if (isChainError(error, "notAvailableNow")) throw error;
      return false;
    },
  );
  const outcome = await outcomeWithin(signature, lastValidBlockHeight, sent ? OWN_SEND_WAIT_MS : 0);
  if (outcome === "confirmed") return signature;
  if (outcome === "failed") throw failed();
  throw new UnknownOutcomeError(signature, lastValidBlockHeight);
}
