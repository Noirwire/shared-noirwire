import { describe, expect, it } from "vitest";
import type { LegOutcome } from "../../../src/application/actions/pieOrder.js";
import {
  changeMix,
  investFloor,
  mixFrom,
  rebalanceSells,
  wholePercent,
} from "../../../src/domain/pie.js";
import {
  investFloorView,
  pieLegSteps,
  pieMixView,
  pieProgressHeadline,
  pieResultHeadline,
  pieRunStopped,
  rebalanceNote,
} from "../../../src/presentation/pie.js";
import { testReads } from "../support/screens.js";

const reads = testReads();
const mixView = (mix: ReturnType<typeof mixFrom>) => pieMixView(reads, mix);

const symbols = [
  "NVDAx",
  "SPYx",
  "QQQx",
  "TSLAx",
  "AAPLx",
  "MSFTx",
  "METAx",
  "AMZNx",
  "GOOGLx",
  "AMDx",
  "INTCx",
];

describe("pie mix rules", () => {
  it("stays an even split while trackers come and go, the remainder going first", () => {
    let mix = mixFrom([]);
    for (const symbol of symbols.slice(0, 3)) mix = changeMix(mix, { type: "add", symbol });
    expect(mix.slices.map((slice) => slice.weight)).toEqual([34, 33, 33]);
    mix = changeMix(mix, { type: "remove", symbol: "SPYx" });
    expect(mix.slices.map((slice) => slice.weight)).toEqual([50, 50]);
    expect(mixView(mix).total.caption).toBe("Fully allocated");
    expect(mixView(mix).problem).toBeNull();
    expect(mixView(mix).ring.label).toBe("2 trackers: NVDAx 50 percent, QQQx 50 percent");
  });

  it("adds at 0% once a target was set by hand, and says what is left or over", () => {
    let mix = changeMix(mixFrom([]), { type: "add", symbol: "NVDAx" });
    mix = changeMix(mix, { type: "set", symbol: "NVDAx", weight: 85 });
    mix = changeMix(mix, { type: "add", symbol: "SPYx" });
    expect(mix.slices).toEqual([
      { symbol: "NVDAx", weight: 85 },
      { symbol: "SPYx", weight: 0 },
    ]);
    expect(mixView(mix).total).toMatchObject({
      text: "85%",
      warning: true,
      caption: "15% left to place",
      spoken: "85 percent, 15% left to place",
    });
    expect(mixView(mix).problem).toBe("Every tracker needs at least 1%.");
    mix = changeMix(mix, { type: "set", symbol: "SPYx", weight: 20 });
    expect(mixView(mix).total.caption).toBe("5% over");
    expect(mixView(mix).problem).toBe("The mix adds up to 105%. It needs to be 100%.");
    expect(mixView(mix).splitEvenly).toBe("Split evenly");
    expect(mixView(changeMix(mix, { type: "splitEvenly" })).problem).toBeNull();
  });

  it("rounds a typed target to a whole number within 0 to 100", () => {
    expect(wholePercent(33.6)).toBe(34);
    expect(wholePercent(140)).toBe(100);
    expect(wholePercent(-3)).toBe(0);
    expect(wholePercent(Number.NaN)).toBe(0);
  });

  it("holds at most ten trackers, each once, and stops offering the chooser at ten", () => {
    let mix = mixFrom([]);
    for (const symbol of symbols) mix = changeMix(mix, { type: "add", symbol });
    expect(mix.slices).toHaveLength(10);
    expect(changeMix(mix, { type: "add", symbol: "NVDAx" })).toBe(mix);
    expect(mixView(mix).chooser).toBeNull();
    expect(mixView(mixFrom([])).chooser?.label).toBe("Pick the trackers for this pie");
    expect(mixView(mixFrom([])).ring.label).toBe("No trackers yet");
    expect(mixView(mixFrom([])).problem).toBe("Add at least one tracker.");
  });

  it("refuses an unlisted tracker and a repeated one, in tracker words", () => {
    expect(mixView(mixFrom([{ symbol: "NOPEx", weight: 100 }])).problem).toBe(
      "Only listed trackers can be added.",
    );
    expect(
      mixView(
        mixFrom([
          { symbol: "NVDAx", weight: 50 },
          { symbol: "NVDAx", weight: 50 },
        ]),
      ).problem,
    ).toBe("Each tracker can appear once.");
  });
});

describe("pie order floor", () => {
  const empty = [
    { symbol: "NVDAx", weight: 90, value: 0 },
    { symbol: "SPYx", weight: 10, value: 0 },
  ];

  it("works out the smallest amount for a mix from its smallest share, rounded up to the dollar", () => {
    expect(investFloor(50, empty, 12)).toBe(120);
    expect(investFloor(120, empty, 12)).toBeNull();
    expect(investFloor(0, empty, 12)).toBeNull();
    expect(investFloorView(120)).toEqual({
      text: "With this mix, invest at least about $120.00 right now so every order can be placed. This figure is approximate and depends on live prices.",
      use: "Use $120.00",
      amount: 120,
    });
    expect(investFloorView(null)).toBeNull();
  });

  it("sells only drifts at least as large as the smallest order, and says the rest are left", () => {
    const slices = [
      { symbol: "NVDAx", weight: 50, amount: 1, value: 80, actual: 80 },
      { symbol: "SPYx", weight: 50, amount: 1, value: 20, actual: 20 },
    ];
    expect(rebalanceSells(slices, 12).sells.map((leg) => leg.symbol)).toEqual(["NVDAx"]);
    expect(rebalanceSells(slices, 12).leftAlone).toBe(false);
    const none = rebalanceSells(slices, 40);
    expect(none).toEqual({ sells: [], leftAlone: true });
    expect(rebalanceNote(none.leftAlone)).toBe("Smaller differences are left as they are.");
    expect(rebalanceNote(false)).toBeNull();
  });
});

describe("pie progress", () => {
  const outcomes: LegOutcome[] = [
    { symbol: "NVDAx", status: "done" },
    { symbol: "SPYx", status: "failed", stop: { because: "notAccepted" } },
    { symbol: "TSLAx", status: "not placed" },
  ] as LegOutcome[];

  it("lists each order with its status word and why it stopped", () => {
    expect(pieLegSteps(outcomes, (symbol) => `${symbol} tracker`)).toEqual([
      { key: "NVDAx", title: "NVDAx tracker", status: "done", statusLabel: "Placed" },
      {
        key: "SPYx",
        title: "SPYx tracker",
        status: "failed",
        statusLabel: "Failed",
        reason: "Stopped: the new price was not accepted.",
      },
      { key: "TSLAx", title: "TSLAx tracker", status: "skipped", statusLabel: "Not placed" },
    ]);
    expect(pieRunStopped(outcomes)).toBe(true);
  });

  it("says none were placed rather than 0 of 3, and keeps the web's running count", () => {
    const none = outcomes.map((outcome) => ({ ...outcome, status: "not placed" as const }));
    expect(pieResultHeadline(none)).toBe("No order was placed");
    expect(pieProgressHeadline({ kind: "done" }, none)).toBe("0 of 3 orders placed");
    expect(pieResultHeadline(outcomes)).toBe("1 of 3 orders placed");
  });
});
