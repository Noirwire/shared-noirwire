import type { Side } from "../order.js";

/** One fill on a market's public tape, as the venue serves it. */
export type OrderbookTapeFill = {
  sequence: number;
  market: string;
  price: string;
  size: string;
  takerSide: Side;
  /** The taker's receipt for this fill: its first 8 bytes as a big-endian unsigned decimal string. */
  takerTag: string;
  /** The maker's receipt for this fill, read the same way. */
  makerTag: string;
  timestampMs: number;
};

export type OrderbookOwnFill = {
  sequence: number;
  market: string;
  /** This trader's side: the taker's side as taker, its opposite as maker. */
  side: Side;
  price: string;
  size: string;
  timestampMs: number;
  role: "taker" | "maker";
  /** The order secret that matched, in hex, so a screen can narrow to one order's fills. Never sent. */
  tag: string;
};

/** The receipt an order's secret gives for a fill at a sequence number, in one role. */
export type OrderbookReceipt = (
  secret: Uint8Array,
  sequence: bigint,
  role: "maker" | "taker",
) => Uint8Array;

const opposite = (side: Side): Side => (side === "buy" ? "sell" : "buy");

/** The first 8 bytes of a receipt as the big-endian unsigned decimal string the tape carries. */
export function receiptTag(receipt: Uint8Array): string {
  let value = 0n;
  for (const byte of receipt.slice(0, 8)) value = (value << 8n) | BigInt(byte);
  return value.toString();
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * A trader's own fills on the public tape. No tag of the trader's is ever on
 * the tape: each fill carries a receipt for its maker and its taker, worked
 * from the order's secret and the fill's own sequence number, so two fills
 * of one order carry unrelated receipts and an observer of the tape cannot
 * link them. This recomputes both receipts from each secret this device
 * holds and keeps the fills that match. `receipt` is the program's receipt
 * function, passed in. A row whose sequence is not a whole number is skipped.
 */
export function orderbookOwnFills(
  fills: readonly OrderbookTapeFill[],
  secrets: readonly Uint8Array[],
  receipt: OrderbookReceipt,
): OrderbookOwnFill[] {
  const own: OrderbookOwnFill[] = [];
  for (const fill of fills) {
    if (!Number.isSafeInteger(fill.sequence) || fill.sequence < 0) continue;
    const sequence = BigInt(fill.sequence);
    for (const secret of secrets) {
      const asTaker = receiptTag(receipt(secret, sequence, "taker")) === fill.takerTag;
      const asMaker = !asTaker && receiptTag(receipt(secret, sequence, "maker")) === fill.makerTag;
      if (!asTaker && !asMaker) continue;
      own.push({
        sequence: fill.sequence,
        market: fill.market,
        side: asTaker ? fill.takerSide : opposite(fill.takerSide),
        price: fill.price,
        size: fill.size,
        timestampMs: fill.timestampMs,
        role: asTaker ? "taker" : "maker",
        tag: toHex(secret),
      });
      break;
    }
  }
  return own;
}
