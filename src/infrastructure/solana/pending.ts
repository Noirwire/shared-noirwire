import { PublicKey } from "@solana/web3.js";
import { isTransient } from "../../application/retries.js";
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
  /** The address that signed it. */
  signer?: string;
  /** The signer's own signature on it. Absent on a record made before this was kept. */
  ownSignature?: string;
};

/** How many of the signer's most recent transactions are looked through for one with no recorded id. */
const SEARCH_LIMIT = 50;

/**
 * Looks on chain for a transaction whose id was never recorded: among the
 * signer's own most recent transactions, the one that carries the signer's
 * recorded signature, which only that exact message can; or, for a record
 * made before that signature was kept, the one signed against the recorded
 * blockhash.
 *
 * - "landed" or "failed": it is there, and that is what became of it;
 * - "absent": everything the signer did recently was read, and it is not
 *   among it. Only this is evidence that it never landed;
 * - "unread": the chain could not be asked just now;
 * - "unsearchable": there is nothing to look for it by, the signer has done
 *   more since than is looked through, or the chain cannot be asked this at
 *   all. Nothing is concluded.
 */
async function sought(
  sent: SentUnconfirmed,
): Promise<"landed" | "failed" | "absent" | "unread" | "unsearchable"> {
  if (!sent.signer || (!sent.blockhash && !sent.ownSignature)) return "unsearchable";
  try {
    const recent = await connection.getSignaturesForAddress(
      new PublicKey(sent.signer),
      { limit: SEARCH_LIMIT },
      "confirmed",
    );
    for (const entry of recent) {
      const found = await connection.getTransaction(entry.signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (!found) return "unread";
      const { message, signatures } = found.transaction;
      const same = sent.ownSignature
        ? signatures.includes(sent.ownSignature)
        : message.recentBlockhash === sent.blockhash;
      if (!same) continue;
      return entry.err || found.meta?.err ? "failed" : "landed";
    }
    return recent.length < SEARCH_LIMIT ? "absent" : "unsearchable";
  } catch (error) {
    return isTransient(error) ? "unread" : "unsearchable";
  }
}

/**
 * What became of `sent`:
 * - "landed": the chain shows it confirmed;
 * - "expired": the chain itself recorded an error for it;
 * - "pending": it may still land: its last valid height has not passed, or
 *   the chain cannot be read just now;
 * - "unknown": it is past its last valid height (or has nothing to settle it
 *   by) and the chain recorded no error. The absence of a status is never a
 *   verdict, because every read goes through one pool of nodes and a node
 *   that is behind or lacks history reports a landed transaction as absent.
 *   Only the person, after checking the balance and history, can release it
 *   (`userCleared`).
 *
 * A transaction with no recorded id is looked for among the signer's recent
 * transactions once its blockhash has expired, and is "expired" only when
 * one of them carries it with a recorded error.
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
    // Only an error the chain recorded releases it. No status at all never does.
    if (status.value?.err) return "expired";
    const level = status.value?.confirmationStatus;
    if (level === "confirmed" || level === "finalized") return "landed";
    if (status.value) return "pending";
  }
  if (expired === null) return "unknown";
  if (!expired) return "pending";
  // Past its last valid height with no error the chain recorded: never
  // released here, and left to the person to clear once they have checked.
  if (sent.signature) return "unknown";

  const found = await sought(sent);
  if (found === "landed") return "landed";
  if (found === "failed") return "expired";
  return "unknown";
}
