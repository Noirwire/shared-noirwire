import { connection } from "./client.js";

/**
 * A transaction that was signed and not seen to land or fail. It may still
 * land, so whatever it was for must not be done a second time until the
 * chain has settled the first: that is how one decision turns into two
 * payments.
 *
 * It is settled on chain evidence only, never on this device's clock: a
 * transaction can be delayed, and a clock can be wrong. Either the chain
 * shows it, or the chain shows it can no longer be included, because the
 * blockhash it was signed against has expired.
 */
export type SentUnconfirmed = {
  /** The transaction's id, when it was ours to know: a fee payer that is not this wallet signs first. */
  signature?: string;
  /** The block height past which it can no longer land. */
  lastValidBlockHeight?: number;
  /** The blockhash it was signed against, for when the height is not known. */
  blockhash?: string;
};

/**
 * What became of `sent`:
 * - "landed": the chain shows it confirmed;
 * - "expired": it failed on chain, or can no longer land and the chain has
 *   no trace of it;
 * - "pending": it may still land;
 * - "unknown": there is nothing to settle it by, neither when it expires nor
 *   (with no id) whether it landed. Only the person who can check the
 *   balance can release it.
 *
 * Expiry is read before the status, so that one landing between the two
 * reads is seen as landed and not as expired.
 */
export async function settle(
  sent: SentUnconfirmed,
): Promise<"landed" | "expired" | "pending" | "unknown"> {
  let expired: boolean | null = null;
  try {
    if (sent.lastValidBlockHeight) {
      expired = (await connection.getBlockHeight("finalized")) > sent.lastValidBlockHeight;
    } else if (sent.blockhash) {
      // "processed" is the newest view: a blockhash this wallet signed with is
      // known there, so a "no" means it expired, not that it is too new.
      const valid = await connection.isBlockhashValid(sent.blockhash, { commitment: "processed" });
      expired = !valid.value;
    }
  } catch {
    return "pending";
  }

  if (sent.signature) {
    const status = await connection
      .getSignatureStatus(sent.signature, { searchTransactionHistory: true })
      .catch(() => undefined);
    if (status === undefined) return "pending";
    if (status.value?.err) return "expired";
    const level = status.value?.confirmationStatus;
    if (level === "confirmed" || level === "finalized") return "landed";
    if (status.value) return "pending";
  }
  if (expired === null) return "unknown";
  return expired ? "expired" : "pending";
}
