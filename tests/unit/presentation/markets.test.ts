import { describe, expect, it } from "vitest";
import { createCatalog } from "../../../src/application/catalog.js";
import { createScreenReads } from "../../../src/application/screenReads.js";
import { commonCopy } from "../../../src/copy/common.js";
import { marketsCopy } from "../../../src/copy/markets.js";
import { STALE_AFTER_MS, recordRead } from "../../../src/domain/freshness.js";
import { ALL_STOCKS } from "../../../src/infrastructure/solana/tokenRegistry.js";
import {
  changeView,
  chartHighLow,
  chartReadout,
  marketsView,
  trackerRowView,
  trackerView,
  type TrackerState,
} from "../../../src/presentation/markets.js";
import {
  FRESH,
  READ,
  TEST_PRICES,
  UPDATED_AT,
  holding,
  testReads,
  testWallet,
  withFirst,
  withHolding,
} from "../support/screens.js";

const reads = testReads();

describe("changeView", () => {
  it("signs a move and leaves a zero move dim, with no sign", () => {
    expect(changeView(2)).toEqual({ text: "+2.00%", tone: "safe" });
    expect(changeView(-1)).toEqual({ text: "-1.00%", tone: "danger" });
    expect(changeView(0.001)).toEqual({ text: "0.00%", tone: "dim" });
  });
});

describe("trackerRowView", () => {
  it("prices a live tracker and says so aloud, and has no star for a visitor", () => {
    expect(trackerRowView(reads, { symbol: "NVDAx", name: "NVIDIA" }, ["NVDAx"])).toMatchObject({
      price: "$100.00",
      live: true,
      change: { text: "+2.00%", tone: "safe" },
      label: "NVIDIA, NVDAx, $100.00, up 2.00 percent today",
      star: { watched: true, label: "Remove NVDAx from watchlist" },
    });
  });

  it("says one thing where a price is missing, and nothing beside it", () => {
    const row = trackerRowView(reads, { symbol: "AAPLx", name: "Apple" }, null);
    expect(row).toMatchObject({ live: false, change: null, star: null });
    expect(row.price).toBe(commonCopy.priceUnavailable);
    expect(row.price).toBe("Price unavailable right now.");
    expect(row.label).toBe("Apple, AAPLx, Price unavailable right now");
    expect(row).not.toHaveProperty("noLivePrice");
  });
});

describe("marketsView", () => {
  const view = (over: Partial<Parameters<typeof marketsView>[1]> = {}) =>
    marketsView(reads, {
      query: "",
      category: "all",
      shown: 25,
      watchlist: [],
      updatedAt: UPDATED_AT,
      freshness: FRESH,
      platform: "mobile",
      ...over,
    });
  const NEVER = { succeededAt: null, lastAttemptFailed: false };

  it("shows the notice the moment a price refresh fails, over prices still on screen", () => {
    expect(view()).toMatchObject({ stale: null, loading: false });
    const failed = recordRead(READ, false, UPDATED_AT + 5_000);
    const offline = view({ freshness: { now: UPDATED_AT + 5_000, prices: failed } });
    expect(offline.stale).toBe(marketsCopy.stale);
    // The prices read before are still drawn: the notice is what says they may be old.
    expect(offline.shelves[0].rows[0].live).toBe(true);
  });

  it("drops the notice on the next refresh that succeeds", () => {
    const failed = recordRead(READ, false, UPDATED_AT + 5_000);
    const back = recordRead(failed, true, UPDATED_AT + 35_000);
    expect(view({ freshness: { now: UPDATED_AT + 35_000, prices: back } }).stale).toBeNull();
  });

  it("shows the notice once prices are older than the bound", () => {
    const at = (age: number) => view({ freshness: { now: UPDATED_AT + age, prices: READ } }).stale;
    expect(at(STALE_AFTER_MS)).toBeNull();
    expect(at(STALE_AFTER_MS + 1)).toBe(marketsCopy.stale);
  });

  it("waits, without the notice, for prices that were never loaded", () => {
    const first = view({ updatedAt: null, freshness: { now: UPDATED_AT, prices: NEVER } });
    expect(first).toMatchObject({ stale: null, loading: true });
    const failedFirst = recordRead(NEVER, false, UPDATED_AT);
    expect(
      view({ updatedAt: null, freshness: { now: UPDATED_AT, prices: failedFirst } }),
    ).toMatchObject({ stale: marketsCopy.stale, loading: false });
  });

  it("leads with the movers, then the shelves, and pages the full list", () => {
    const markets = view();
    expect(markets.shelves[0]).toMatchObject({ key: "movers", trailing: "24h change" });
    expect(markets.shelves[0].rows.map((row) => row.symbol)).toEqual(["NVDAx", "SPYx", "TSLAx"]);
    expect(markets.moversWaiting).toBeNull();
    expect(markets.search.label).toBe("Search trackers");
    expect(markets.browse.more).toMatch(/^Show \d+ more$/);
    expect(view({ platform: "web" }).search.label).toBe("Search investments");
    expect(view({ platform: "web" }).browse.more).toMatch(/^Show more \(\d+ left\)$/);
  });

  it("says movers are waiting while there is no live price", () => {
    expect(view({ updatedAt: null }).moversWaiting).toBe(
      "Top movers appear when current prices load.",
    );
  });

  it("searches, and says when nothing matches", () => {
    expect(view({ query: "nvda" }).searching?.rows.map((row) => row.symbol)).toContain("NVDAx");
    expect(view({ query: "zzzz" }).searching).toMatchObject({
      count: "0 results",
      empty: "No matching investment.",
    });
  });

  it("keeps a visitor out of the watchlist, and words an empty one by platform", () => {
    expect(
      view({ watchlist: null, category: "watchlist" }).browse.categories.map((c) => c.category),
    ).toEqual(["all", "companies", "index"]);
    expect(view({ category: "watchlist" }).browse.empty).toEqual({
      title: "Your watchlist is empty.",
      detail: "Tap the star on a tracker to save it here.",
    });
    expect(view({ category: "watchlist", platform: "web" }).browse.empty?.detail).toBe(
      "Save trackers to find them here.",
    );
  });
});

describe("trackerView", () => {
  const state = (over: Partial<TrackerState> = {}): TrackerState => ({
    symbol: "NVDAx",
    wallet: testWallet(),
    updatedAt: UPDATED_AT,
    online: true,
    range: "1W",
    history: { status: "ready", points: [90, 100] },
    smallestOrderUsd: 12,
    freshness: FRESH,
    platform: "mobile",
    ...over,
  });

  it("says a symbol that is not a tracker was not found", () => {
    expect(trackerView(reads, state({ symbol: "USDC" }))).toMatchObject({
      kind: "notFound",
      back: "Back to Markets",
    });
  });

  it("prices a live tracker, describes its chart aloud, and offers to buy", () => {
    const view = trackerView(reads, state());
    expect(view).toMatchObject({
      kind: "tracker",
      name: "NVIDIA",
      caption: "NVIDIA tracker · NVDAx",
      follows: "Follows NVIDIA's share price. You do not own a share.",
      price: { live: true, figure: "$100.00", tag: "Approximate price" },
      change: { text: "+2.00%", caption: "past 24h" },
      orderNote: "The final price is shown before you buy.",
      minimum: "The smallest order is about $12.",
      stale: null,
      chart: {
        kind: "ready",
        label:
          "1 week price chart. Started at 90 dollars 0 cents, now 100 dollars 0 cents, up 11.11 percent.",
        source: "Historical prices",
        high: { label: "High", value: "$100.00" },
        low: { label: "Low", value: "$90.00" },
      },
      risks: { title: "Read the risks" },
      holding: { quantity: null, none: "You do not own this tracker yet." },
      actions: [{ kind: "buy", label: "Buy", disabled: false }],
      offline: null,
    });
  });

  it("shows what is held and where, offers to sell, and holds both back offline", () => {
    const wallet = withFirst((p) => withHolding(p, holding("NVDAx", 2)));
    const view = trackerView(reads, state({ wallet, online: false }));
    expect(view).toMatchObject({
      holding: {
        quantity: "2.0000 NVDAx",
        value: "$200.00 approximate value",
        rows: [{ id: "acc_1", label: "Investing · 2.0000 NVDAx" }],
      },
      actions: [
        { kind: "buy", disabled: true },
        { kind: "sell", disabled: true },
      ],
      offline: "You're offline. Nothing can be bought or sold until you're back online.",
    });
  });

  it("asks a visitor to create a wallet, and one with no portfolio to create one", () => {
    expect(trackerView(reads, state({ wallet: null }))).toMatchObject({
      actions: [{ kind: "createWallet" }],
      holding: null,
      star: null,
    });
    expect(
      trackerView(reads, state({ wallet: testWallet((w) => ({ ...w, portfolios: [] })) })),
    ).toMatchObject({ actions: [{ kind: "createPortfolio", label: "Create a portfolio" }] });
  });

  it("says the chart is loading or missing, and one thing for a missing price", () => {
    expect(trackerView(reads, state({ history: { status: "loading" } }))).toMatchObject({
      chart: { kind: "loading" },
    });
    const view = trackerView(reads, state({ history: { status: "none" }, updatedAt: null }));
    expect(view).toMatchObject({
      chart: { kind: "none" },
      price: { live: false, figure: commonCopy.priceUnavailable },
      change: null,
    });
    if (view.kind !== "tracker") throw new Error("expected a tracker");
    expect(view.price).not.toHaveProperty("note");
  });

  it("keeps the certificate, its issuer, the multiplier and the venue under Read the risks", () => {
    const view = trackerView(reads, state());
    if (view.kind !== "tracker") throw new Error("expected a tracker");
    const { risks, ...main } = view;
    const behind = [...risks.lines, risks.details].join(" ");
    expect(behind).toMatch(/freeze or remove/);
    expect(behind).toMatch(/xStocks tracker certificate/);
    expect(behind).toMatch(/issuer/);
    expect(JSON.stringify(main)).not.toMatch(
      /multiplier|\bburn|Jupiter|freeze|xStocks|issuer|certificate/i,
    );
  });

  it("states the smallest order from the figure it is given, and not for a tracker no longer sold", () => {
    expect(trackerView(reads, state({ smallestOrderUsd: 10 }))).toMatchObject({
      minimum: "The smallest order is about $10.",
    });
    expect(trackerView(reads, state({ smallestOrderUsd: 2.5 }))).toMatchObject({
      minimum: "The smallest order is about $2.50.",
    });
    const retired = createScreenReads(
      createCatalog({
        stocks: ALL_STOCKS.map((stock) =>
          stock.symbol === "NVDAx" ? { ...stock, retired: true } : stock,
        ),
        livePrice: (symbol) => TEST_PRICES[symbol],
        stockMultiplier: () => 1,
      }),
    );
    expect(trackerView(retired, state())).toMatchObject({ minimum: null });
  });

  it("shows the notice the moment the price or the chart could not be read again", () => {
    const failed = recordRead(READ, false, UPDATED_AT);
    expect(trackerView(reads, state())).toMatchObject({ stale: null, loading: false });
    expect(trackerView(reads, state({ freshness: { ...FRESH, prices: failed } }))).toMatchObject({
      stale: marketsCopy.stale,
    });
    expect(trackerView(reads, state({ freshness: { ...FRESH, chart: failed } }))).toMatchObject({
      stale: marketsCopy.stale,
    });
    const back = recordRead(failed, true, UPDATED_AT + 1);
    expect(
      trackerView(reads, state({ freshness: { ...FRESH, now: UPDATED_AT + 1, prices: back } })),
    ).toMatchObject({ stale: null });
  });

  it("ages the price, and not a chart that is read once", () => {
    const later = UPDATED_AT + STALE_AFTER_MS + 1;
    const pricesRefreshed = { succeededAt: later, lastAttemptFailed: false };
    expect(
      trackerView(
        reads,
        state({ freshness: { now: later, prices: pricesRefreshed, chart: READ } }),
      ),
    ).toMatchObject({ stale: null });
    expect(
      trackerView(reads, state({ freshness: { now: later, prices: READ, chart: READ } })),
    ).toMatchObject({ stale: marketsCopy.stale });
  });

  it("waits, without the notice, while the price or the chart was never loaded", () => {
    const never = { succeededAt: null, lastAttemptFailed: false };
    expect(
      trackerView(
        reads,
        state({
          updatedAt: null,
          history: { status: "loading" },
          freshness: { now: UPDATED_AT, prices: never, chart: never },
        }),
      ),
    ).toMatchObject({ stale: null, loading: true });
  });
});

describe("reading a chart", () => {
  const points = [100, 104, 98, 110, 107];
  const readAt = new Date(2026, 6, 15, 12, 0).getTime();

  it("finds the range's high and low", () => {
    expect(chartHighLow(points)).toEqual({ high: 110, low: 98 });
  });

  it("answers the price and the date under a finger, from the left edge to the right", () => {
    const series = { range: "1D" as const, readAt };
    expect(chartReadout(points, 0, series)).toEqual({
      index: 0,
      price: "$100.00",
      date: "14 Jul 2026, 12:00",
      text: "$100.00 · 14 Jul 2026, 12:00",
    });
    expect(chartReadout(points, 0.5, series)).toEqual({
      index: 2,
      price: "$98.00",
      date: "15 Jul 2026, 00:00",
      text: "$98.00 · 15 Jul 2026, 00:00",
    });
    expect(chartReadout(points, 1, series)).toEqual({
      index: 4,
      price: "$107.00",
      date: "15 Jul 2026, 12:00",
      text: "$107.00 · 15 Jul 2026, 12:00",
    });
  });

  it("takes the nearest point, and holds a finger past either edge to the edge", () => {
    const series = { range: "1D" as const, readAt };
    expect(chartReadout(points, 0.3, series)?.index).toBe(1);
    expect(chartReadout(points, 0.4, series)?.index).toBe(2);
    expect(chartReadout(points, -2, series)?.index).toBe(0);
    expect(chartReadout(points, 7, series)?.index).toBe(4);
  });

  it("shows a month's points by their day", () => {
    expect(chartReadout(points, 0, { range: "1M", readAt })?.date).toBe("15 Jun 2026");
    expect(chartReadout(points, 1, { range: "1M", readAt })?.date).toBe("15 Jul 2026");
  });

  it("has nothing to read on a series too short to draw", () => {
    expect(chartReadout([100], 0.5, { range: "1W", readAt })).toBeNull();
  });
});
