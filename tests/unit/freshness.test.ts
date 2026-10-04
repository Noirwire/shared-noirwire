import { describe, expect, it } from "vitest";
import {
  NEVER_READ,
  REFRESH_INTERVAL_MS,
  STALE_AFTER_MS,
  freshnessOf,
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
