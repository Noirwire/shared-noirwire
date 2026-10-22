import { describe, expect, it } from "vitest";
import {
  NEVER_READ,
  REFRESH_INTERVAL_MS,
  STALE_AFTER_MS,
  ageOf,
  freshnessOf,
  markFreshness,
  olderThan,
  recordRead,
} from "../../src/domain/freshness.js";
import { POLL_MS } from "../../src/infrastructure/prices/live.js";

const AT = 1_750_000_000_000;

describe("how current a read is", () => {
  it("waits for a read that was never attempted", () => {
    expect(freshnessOf(NEVER_READ, AT)).toBe("waiting");
  });

  it("is stale the moment an attempt fails, however recent the last success", () => {
    const read = recordRead(NEVER_READ, true, AT);
    expect(freshnessOf(read, AT)).toBe("fresh");
    const failed = recordRead(read, false, AT + 1);
    expect(failed).toEqual({ succeededAt: AT, lastAttemptFailed: true });
    expect(freshnessOf(failed, AT + 1)).toBe("stale");
  });

  it("is fresh again on the next success", () => {
    const failed = recordRead(recordRead(NEVER_READ, true, AT), false, AT + 1);
    const back = recordRead(failed, true, AT + 2);
    expect(back).toEqual({ succeededAt: AT + 2, lastAttemptFailed: false });
    expect(freshnessOf(back, AT + 2)).toBe("fresh");
  });

  it("is stale, not waiting, when the very first attempt fails", () => {
    expect(freshnessOf(recordRead(NEVER_READ, false, AT), AT)).toBe("stale");
  });

  it("ages out past the bound with no failure seen", () => {
    const read = recordRead(NEVER_READ, true, AT);
    expect(freshnessOf(read, AT + STALE_AFTER_MS)).toBe("fresh");
    expect(freshnessOf(read, AT + STALE_AFTER_MS + 1)).toBe("stale");
  });

  it("allows one late refresh and not two: the bound is two intervals of the price feed's own", () => {
    expect(POLL_MS).toBe(REFRESH_INTERVAL_MS);
    expect(STALE_AFTER_MS).toBe(2 * POLL_MS);
  });
});

describe("how old a reading is", () => {
  it("is the time since it was taken, and none without a reading", () => {
    expect(ageOf(AT - 4_000, AT)).toBe(4_000);
    expect(ageOf(null, AT)).toBeNull();
    expect(ageOf(undefined, AT)).toBeNull();
  });

  it("is never below zero for a reading stamped ahead of this clock", () => {
    expect(ageOf(AT + 5_000, AT)).toBe(0);
  });

  it("counts a missing reading as older than any limit", () => {
    expect(olderThan(null, AT, 1_000_000)).toBe(true);
    expect(olderThan(AT - 30_000, AT, 30_000)).toBe(false);
    expect(olderThan(AT - 30_001, AT, 30_000)).toBe(true);
  });
});

describe("a mark an order may use", () => {
  it("is usable up to the market's own price age, which the program accepts", () => {
    expect(markFreshness(AT - 15_000, AT, 90)).toEqual({ ageMs: 15_000, usable: true });
    expect(markFreshness(AT - 90_000, AT, 90)).toEqual({ ageMs: 90_000, usable: true });
    expect(markFreshness(AT - 90_001, AT, 90)).toEqual({ ageMs: 90_001, usable: false });
  });

  it("follows each market's own limit", () => {
    expect(markFreshness(AT - 6_000, AT, 5).usable).toBe(false);
    expect(markFreshness(AT - 6_000, AT, 120).usable).toBe(true);
  });

  it("is not usable without a mark, or without a limit that is a number", () => {
    expect(markFreshness(null, AT, 90)).toEqual({ ageMs: null, usable: false });
    expect(markFreshness(AT, AT, Number.NaN).usable).toBe(false);
  });
});
