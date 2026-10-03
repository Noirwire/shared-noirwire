import { describe, expect, it } from "vitest";
import { closesWithin } from "../../src/infrastructure/prices/historySource.js";

const HOUR = 3_600;
const from = 1_000 * HOUR * 1000;
const to = from + 24 * HOUR * 1000;
const at = (hours: number, close: number) => ({ time: from / 1000 + hours * HOUR, close });

describe("closesWithin", () => {
  it("returns closes oldest first, whatever order they arrived in", () => {
    expect(closesWithin([at(3, 30), at(1, 10), at(2, 20)], from, to)).toEqual([10, 20, 30]);
  });

  it("drops candles from outside the window, so another period cannot be drawn as this one", () => {
    expect(closesWithin([at(-400, 1), at(-300, 2), at(1, 10), at(2, 20)], from, to)).toEqual([
      10, 20,
    ]);
    expect(closesWithin([at(-400, 1), at(-300, 2)], from, to)).toBeNull();
  });

  it("drops candles with no usable price or time", () => {
    expect(
      closesWithin(
        [at(1, 10), { close: 5 }, { time: from / 1000 + HOUR }, at(2, 0), at(3, 30)],
        from,
        to,
      ),
    ).toEqual([10, 30]);
  });

  it("is null for fewer than two candles", () => {
    expect(closesWithin([at(1, 10)], from, to)).toBeNull();
  });
});
