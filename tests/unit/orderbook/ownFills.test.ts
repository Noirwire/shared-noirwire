import { describe, expect, it } from "vitest";
import {
  type OrderbookReceipt,
  type OrderbookTapeFill,
  orderbookOwnFills,
  receiptTag,
} from "../../../src/domain/orderbook/ownFills.js";

const receipt: OrderbookReceipt = (secret, sequence, role) =>
  Uint8Array.from({ length: 16 }, (_, index) => {
    const mix = Number(sequence & 0xffn) * 31 + index * 7 + (role === "maker" ? 101 : 13);
    return (secret[index] ^ mix) & 0xff;
  });

function fillAt(
  secret: Uint8Array,
  sequence: number,
  over: Partial<OrderbookTapeFill> = {},
): OrderbookTapeFill {
  return {
    market: "NSOL-PERP",
    price: "150.000000",
    size: "1.000000",
    takerSide: "buy",
    takerTag: receiptTag(receipt(secret, BigInt(sequence), "taker")),
    makerTag: receiptTag(receipt(secret, BigInt(sequence), "maker")),
    timestampMs: 1_000,
    sequence,
    ...over,
  };
}

describe("receiptTag", () => {
  it("reads a receipt's first 8 bytes as a big-endian unsigned number", () => {
    expect(receiptTag(Uint8Array.from([0, 0, 0, 0, 0, 0, 1, 2, 99]))).toBe("258");
    expect(receiptTag(new Uint8Array(8).fill(0xff))).toBe("18446744073709551615");
  });
});

describe("orderbookOwnFills", () => {
  const mine = new Uint8Array(16).fill(7);
  const stranger = new Uint8Array(16).fill(9);

  it("finds a fill taken with this device's secret and not with another", () => {
    const fill = fillAt(mine, 42);
    expect(orderbookOwnFills([fill], [mine], receipt)).toHaveLength(1);
    expect(orderbookOwnFills([fill], [stranger], receipt)).toHaveLength(0);
  });

  it("does not take one fill's receipt as another sequence's", () => {
    const first = fillAt(mine, 1);
    const second = { ...fillAt(mine, 2), takerTag: first.takerTag, makerTag: first.makerTag };
    expect(orderbookOwnFills([second], [mine], receipt)).toHaveLength(0);
  });

  it("gives a maker the side opposite the taker's", () => {
    const fill = {
      ...fillAt(stranger, 10),
      makerTag: receiptTag(receipt(mine, 10n, "maker")),
    };
    const [own] = orderbookOwnFills([fill], [mine], receipt);
    expect(own).toMatchObject({ role: "maker", side: "sell", tag: "07".repeat(16) });
  });

  it("skips a row whose sequence is not a whole number", () => {
    expect(orderbookOwnFills([fillAt(mine, 3, { sequence: 1.5 })], [mine], receipt)).toEqual([]);
    expect(orderbookOwnFills([fillAt(mine, 3, { sequence: -1 })], [mine], receipt)).toEqual([]);
  });
});
