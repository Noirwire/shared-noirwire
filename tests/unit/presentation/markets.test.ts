import { describe, expect, it } from "vitest";
import {
  changeView,
  marketsView,
  trackerRowView,
  trackerView,
  type TrackerState,
} from "../../../src/presentation/markets.js";
import {
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
      noLivePrice: null,
      label: "NVIDIA, NVDAx, $100.00, up 2.00 percent today",
      star: { watched: true, label: "Remove NVDAx from watchlist" },
    });
    expect(trackerRowView(reads, { symbol: "AAPLx", name: "Apple" }, null)).toMatchObject({
      price: "At review",
      live: false,
      change: null,
      noLivePrice: "No live price",
      label: "Apple, AAPLx, no live price",
      star: null,
    });
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
      platform: "mobile",
      ...over,
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
      price: { live: true, figure: "$100.00", tag: "Indicative" },
      change: { text: "+2.00%", caption: "past 24h" },
      orderNote: "Your order price is confirmed at review.",
      chart: {
        kind: "ready",
        label:
          "1 week price chart. Started at 90 dollars 0 cents, now 100 dollars 0 cents, up 11.11 percent.",
      },
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
        value: "$200.00 indicative value",
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

  it("says the chart is loading or missing, and the price is at review without a live one", () => {
    expect(trackerView(reads, state({ history: { status: "loading" } }))).toMatchObject({
      chart: { kind: "loading", text: "Loading price history..." },
    });
    expect(
      trackerView(reads, state({ history: { status: "none" }, updatedAt: null })),
    ).toMatchObject({
      chart: { kind: "none", text: "No verified 1W chart available." },
      price: { live: false, figure: "At review" },
      change: null,
    });
  });
});
