import { describe, expect, it } from "vitest";
import {
  afterTrade,
  reconcileTrackers,
  sameTrackerAmounts,
  uncostedOf,
  withChainAmount,
} from "../../src/domain/holdings.js";
import type { Holding } from "../../src/domain/wallet.js";

const CASH: Holding[] = [
  { symbol: "SOL", amount: 0.2, cost: 30 },
  { symbol: "USDC", amount: 10, cost: 10 },
];
/** What a read of two trackers reports when neither is held. */
const NONE = { NVDAx: 0, SPYx: 0 };

describe("reconcileTrackers", () => {
  it("shows a tracker the chain holds and the record lacks, with no cost and no part of it costed", () => {
    expect(reconcileTrackers(CASH, { ...NONE, NVDAx: 3 })).toEqual([
      ...CASH,
      { symbol: "NVDAx", amount: 3, cost: 0, uncosted: 3 },
    ]);
  });

  it("removes a tracker the record holds and the chain does not", () => {
    const recorded = [...CASH, { symbol: "NVDAx", amount: 3, cost: 300 }];
    expect(reconcileTrackers(recorded, NONE)).toEqual(CASH);
  });

  it("leaves a tracker alone when the chain agrees with the record", () => {
    const recorded = [...CASH, { symbol: "NVDAx", amount: 3, cost: 300 }];
    expect(reconcileTrackers(recorded, { ...NONE, NVDAx: 3 })).toEqual(recorded);
  });

  it("keeps the recorded cost for what was bought here and marks only the extra as uncosted", () => {
    const recorded = [{ symbol: "NVDAx", amount: 3, cost: 300 }];
    expect(reconcileTrackers(recorded, { ...NONE, NVDAx: 5 })).toEqual([
      { symbol: "NVDAx", amount: 5, cost: 300, uncosted: 2 },
    ]);
  });

  it("takes what left from the uncosted part first, then shrinks the cost with what is left", () => {
    const recorded = [{ symbol: "NVDAx", amount: 5, cost: 300, uncosted: 2 }];
    expect(reconcileTrackers(recorded, { ...NONE, NVDAx: 4 })).toEqual([
      { symbol: "NVDAx", amount: 4, cost: 300, uncosted: 1 },
    ]);
    expect(reconcileTrackers(recorded, { ...NONE, NVDAx: 1.5 })).toEqual([
      { symbol: "NVDAx", amount: 1.5, cost: 150 },
    ]);
  });

  it("touches nothing the read did not name: cash, SOL, or a tracker that was not read", () => {
    const recorded = [...CASH, { symbol: "TSLAx", amount: 1, cost: 50 }];
    expect(reconcileTrackers(recorded, NONE)).toEqual(recorded);
    expect(reconcileTrackers(recorded, {})).toEqual(recorded);
  });

  it("keeps a retired tracker that is still held", () => {
    // Retired trackers are read like any other, so they arrive named in `chain`.
    expect(reconcileTrackers([], { RETIREDx: 2 })).toEqual([
      { symbol: "RETIREDx", amount: 2, cost: 0, uncosted: 2 },
    ]);
  });
});

describe("withChainAmount", () => {
  it("never reports more uncosted than is held, whatever the record says", () => {
    expect(uncostedOf({ symbol: "NVDAx", amount: 1, cost: 0, uncosted: 9 })).toBe(1);
  });

  it("drops the cost with the last of a position", () => {
    expect(withChainAmount({ symbol: "NVDAx", amount: 3, cost: 300 }, 0)).toEqual({
      symbol: "NVDAx",
      amount: 0,
      cost: 0,
    });
  });
});

describe("afterTrade", () => {
  const bought: Holding = { symbol: "NVDAx", amount: 2, cost: 200 };
  const mixed: Holding = { symbol: "NVDAx", amount: 4, cost: 200, uncosted: 2 };

  it("adds the cash a buy spent to the cost and leaves the bought tokens costed", () => {
    expect(afterTrade(bought, { side: "buy", spend: 100 }, 3)).toEqual({
      symbol: "NVDAx",
      amount: 3,
      cost: 300,
    });
    expect(afterTrade(mixed, { side: "buy", spend: 100 }, 5)).toEqual({
      symbol: "NVDAx",
      amount: 5,
      cost: 300,
      uncosted: 2,
    });
  });

  it("takes a sold share off the cost and the uncosted part alike", () => {
    expect(afterTrade(mixed, { side: "sell", spend: 2 }, 2)).toEqual({
      symbol: "NVDAx",
      amount: 2,
      cost: 100,
      uncosted: 1,
    });
  });

  it("carries nothing over from a position sold out", () => {
    expect(afterTrade(mixed, { side: "sell", spend: 4 }, 0)).toEqual({
      symbol: "NVDAx",
      amount: 0,
      cost: 0,
    });
  });
});

describe("sameTrackerAmounts", () => {
  it("notices a trade recorded between a read being sent and landing", () => {
    const before = [...CASH, { symbol: "NVDAx", amount: 2, cost: 200 }];
    const after = [...CASH, { symbol: "NVDAx", amount: 3, cost: 300 }];
    expect(sameTrackerAmounts(before, before, NONE)).toBe(true);
    expect(sameTrackerAmounts(before, after, NONE)).toBe(false);
    expect(sameTrackerAmounts(CASH, after, NONE)).toBe(false);
  });

  it("ignores cash moving, which every read replaces anyway", () => {
    const moved = [{ symbol: "SOL", amount: 9, cost: 9 }];
    expect(sameTrackerAmounts(CASH, moved, NONE)).toBe(true);
  });
});
