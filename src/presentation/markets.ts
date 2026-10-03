import { MARKET_PAGE_SIZE, SHELF_SIZE, type MarketCategory } from "../application/markets.js";
import type { ScreenReads } from "../application/screenReads.js";
import { commonCopy } from "../copy/common.js";
import { marketsCopy, mobileMarketsCopy } from "../copy/markets.js";
import { portfolioCopy } from "../copy/portfolio.js";
import { tradeCopy } from "../copy/trade.js";
import type { AppPlatform } from "../domain/appPlatform.js";
import { shares, usd } from "../domain/format.js";
import type { PriceRange } from "../domain/priceRanges.js";
import type { Wallet } from "../domain/wallet.js";

type Listed = { symbol: string; name: string; issuer?: string };

export type ChangeView = { text: string; tone: "safe" | "danger" | "dim" };

export type TrackerRowView = {
  symbol: string;
  name: string;
  caption: string;
  /** The live price, or "At review" when there is none. */
  price: string;
  live: boolean;
  change: ChangeView | null;
  /** Shown in place of the change when there is no live price. */
  noLivePrice: string | null;
  label: string;
  /** Null for a visitor, who has no watchlist. */
  star: { watched: boolean; label: string } | null;
};

/** A daily change: zero, or anything that rounds to it, carries no sign and no gain or loss colour. */
export function changeView(percent: number): ChangeView {
  if (Math.abs(percent) < 0.005) return { text: "0.00%", tone: "dim" };
  return {
    text: `${percent > 0 ? "+" : "-"}${Math.abs(percent).toFixed(2)}%`,
    tone: percent > 0 ? "safe" : "danger",
  };
}

export function trackerRowView(
  reads: ScreenReads,
  entry: Listed,
  watchlist: readonly string[] | null,
): TrackerRowView {
  const live = reads.isLivePrice(entry.symbol);
  const priced = reads.asset(entry.symbol);
  const price = live && priced ? usd(priced.price) : null;
  const change = live && priced ? priced.change24h : null;
  const watched = watchlist?.includes(entry.symbol) ?? false;
  return {
    symbol: entry.symbol,
    name: entry.name,
    caption: marketsCopy.issuerLine(entry.symbol, entry.issuer),
    price: price ?? marketsCopy.atReview,
    live: price !== null,
    change: change === null ? null : changeView(change),
    noLivePrice: price === null ? marketsCopy.noLivePrice : null,
    label: marketsCopy.rowLabel(
      entry.name,
      entry.symbol,
      price,
      change === null ? null : marketsCopy.changeSpoken(change),
    ),
    star:
      watchlist === null
        ? null
        : { watched, label: marketsCopy.watchToggle(watched, entry.symbol) },
  };
}

export type Shelf = { key: string; title: string; trailing: string | null; rows: TrackerRowView[] };

export type MarketsState = {
  query: string;
  category: MarketCategory;
  /** How many rows of the list are shown. */
  shown: number;
  /** The wallet's watchlist, or null for a visitor. */
  watchlist: readonly string[] | null;
  updatedAt: number | null;
  platform: AppPlatform;
};

export type MarketsView = {
  title: string;
  search: { label: string; placeholder: string; clear: string };
  searching: { count: string; rows: TrackerRowView[]; empty: string | null } | null;
  shelves: Shelf[];
  moversWaiting: string | null;
  browse: {
    title: string;
    categories: { category: MarketCategory; label: string; active: boolean }[];
    rows: TrackerRowView[];
    more: string | null;
    empty: { title: string; detail: string } | null;
  };
};

/** Finding trackers: search, the featured shelves, and the full list a page at a time. */
export function marketsView(reads: ScreenReads, state: MarketsState): MarketsView {
  const { watchlist } = state;
  const mobile = state.platform === "mobile";
  const visitor = watchlist === null;
  const row = (entry: Listed) => trackerRowView(reads, entry, watchlist);
  const holder = { watchlist: [...(watchlist ?? [])] };
  const query = state.query.trim();

  const searching = query
    ? (() => {
        const rows = reads.searchMarkets(query).map(row);
        return {
          count: marketsCopy.results(rows.length),
          rows,
          empty: rows.length === 0 ? marketsCopy.noMatch : null,
        };
      })()
    : null;

  const movers = reads.topMovers(state.updatedAt).slice(0, SHELF_SIZE).map(row);
  const shelf = (key: string, title: string, rows: TrackerRowView[], trailing: string | null) =>
    ({ key, title, trailing, rows }) satisfies Shelf;
  const shelves = [
    shelf("movers", marketsCopy.groups.movers, movers, marketsCopy.dayChange),
    shelf(
      "index",
      marketsCopy.groups.index,
      reads.marketsByCategory(holder, "index").slice(0, SHELF_SIZE).map(row),
      null,
    ),
    shelf(
      "companies",
      marketsCopy.groups.companies,
      reads.marketsByCategory(holder, "companies").slice(0, SHELF_SIZE).map(row),
      null,
    ),
    ...(visitor
      ? []
      : [
          shelf(
            "watchlist",
            marketsCopy.groups.watchlist,
            reads.marketsByCategory(holder, "watchlist").map(row),
            null,
          ),
        ]),
  ].filter((entry) => entry.rows.length > 0);

  const category = visitor && state.category === "watchlist" ? "all" : state.category;
  const listed = reads.marketsByCategory(holder, category);
  const remaining = listed.length - state.shown;
  const categories: MarketCategory[] = visitor
    ? ["all", "companies", "index"]
    : ["all", "companies", "index", "watchlist"];

  return {
    title: marketsCopy.desktopTitle,
    search: {
      label: mobile ? mobileMarketsCopy.searchLabel : marketsCopy.searchLabel,
      placeholder: marketsCopy.searchPlaceholder,
      clear: marketsCopy.clearSearch,
    },
    searching,
    shelves,
    moversWaiting: movers.length === 0 ? marketsCopy.moversWaiting : null,
    browse: {
      title: marketsCopy.browseAll,
      categories: categories.map((entry) => ({
        category: entry,
        label: marketsCopy.categories[entry],
        active: entry === category,
      })),
      rows: listed.slice(0, state.shown).map(row),
      more:
        remaining <= 0
          ? null
          : mobile
            ? mobileMarketsCopy.showMore(remaining, MARKET_PAGE_SIZE)
            : marketsCopy.showMore(remaining),
      empty:
        listed.length === 0 && category === "watchlist"
          ? {
              title: marketsCopy.watchlistEmpty,
              detail: mobile
                ? mobileMarketsCopy.watchlistEmptyDetail
                : portfolioCopy.home.watchlistEmpty,
            }
          : null,
    },
  };
}

/** A tracker's price history for one range, as far as it has been read. */
export type PriceHistory =
  { status: "loading" } | { status: "ready"; points: number[] } | { status: "none" };

export type TrackerAction =
  | { kind: "buy"; label: string; disabled: boolean }
  | { kind: "sell"; label: string; disabled: boolean }
  | { kind: "createWallet"; label: string }
  | { kind: "createPortfolio"; label: string };

export type TrackerView =
  | { kind: "notFound"; title: string; detail: string; back: string }
  | {
      kind: "tracker";
      symbol: string;
      name: string;
      caption: string;
      star: { watched: boolean; label: string } | null;
      price:
        { live: true; figure: string; tag: string } | { live: false; figure: string; note: string };
      change: (ChangeView & { caption: string }) | null;
      orderNote: string;
      chart:
        | { kind: "loading"; text: string }
        | { kind: "none"; text: string }
        | { kind: "ready"; points: number[]; label: string; source: string };
      ranges: { value: PriceRange; label: string };
      holding: {
        title: string;
        quantity: string | null;
        value: string | null;
        rows: { id: string; label: string }[];
        none: string | null;
      } | null;
      about: {
        title: string;
        lines: string[];
        notOffered: string;
        retired: string | null;
        readRisks: string;
        issuerDetails: string;
      };
      actions: TrackerAction[];
      bottomNote: string | null;
      offline: string | null;
    };

export type TrackerState = {
  symbol: string;
  /** The unlocked wallet, or null for a visitor. */
  wallet: Wallet | null;
  updatedAt: number | null;
  online: boolean;
  range: PriceRange;
  history: PriceHistory;
  platform: AppPlatform;
};

function spokenDollars(amount: number) {
  const [whole, cents] = amount.toFixed(2).split(".");
  return `${whole} dollars ${Number(cents)} cents`;
}

function chartOf(state: TrackerState): Extract<TrackerView, { kind: "tracker" }>["chart"] {
  const { history, range } = state;
  const detail = marketsCopy.detail;
  if (history.status === "loading") return { kind: "loading", text: detail.loadingHistory };
  if (history.status === "none") return { kind: "none", text: detail.noChart(range) };
  const first = history.points[0];
  const last = history.points[history.points.length - 1];
  const percent = ((last - first) / first) * 100;
  const rangeName = detail.rangeName[range];
  return {
    kind: "ready",
    points: history.points,
    label: detail.chartLabel(
      rangeName.charAt(0).toUpperCase() + rangeName.slice(1),
      spokenDollars(first),
      spokenDollars(last),
      marketsCopy.changeSpoken(percent).replace(" today", ""),
    ),
    source: detail.historySource,
  };
}

/** A tracker's own page: its price, its chart, what the person holds of it, and what they can do. */
export function trackerView(reads: ScreenReads, state: TrackerState): TrackerView {
  const { symbol, wallet, online } = state;
  const mobile = state.platform === "mobile";
  const detail = { ...marketsCopy.detail, ...(mobile ? mobileMarketsCopy.detail : {}) };
  const entry = reads.asset(symbol);
  if (!entry || entry.kind !== "stock") {
    return {
      kind: "notFound",
      title: detail.notFound,
      detail: marketsCopy.noMatch,
      back: detail.backToMarkets,
    };
  }
  const live = state.updatedAt !== null && reads.isLivePrice(symbol);
  const visitor = wallet === null;
  const portfolios = wallet ? reads.activePortfolios(wallet) : [];
  const holders = portfolios.filter((portfolio) =>
    portfolio.holdings.some((holding) => holding.symbol === symbol && holding.amount > 0),
  );
  const position = wallet ? reads.positionAcross(wallet, symbol) : null;
  const held = position !== null && position.amount > 0;
  const quantity = (amount: number) => {
    const shown = reads.shownUnits(symbol, amount);
    return shown === undefined ? commonCopy.unavailable : `${shares(shown)} ${symbol}`;
  };

  const actions: TrackerAction[] = visitor
    ? [{ kind: "createWallet", label: detail.createWallet }]
    : portfolios.length === 0
      ? [{ kind: "createPortfolio", label: detail.createPortfolio }]
      : [
          ...(entry.retired
            ? []
            : [{ kind: "buy" as const, label: detail.buy, disabled: !online }]),
          ...(holders.length > 0
            ? [{ kind: "sell" as const, label: detail.sell, disabled: !online }]
            : []),
        ];

  return {
    kind: "tracker",
    symbol,
    name: entry.name,
    caption: marketsCopy.issuerLine(symbol, entry.issuer),
    star: wallet
      ? {
          watched: wallet.watchlist.includes(symbol),
          label: marketsCopy.watchToggle(wallet.watchlist.includes(symbol), symbol),
        }
      : null,
    price: live
      ? { live: true, figure: usd(entry.price), tag: detail.indicative }
      : { live: false, figure: marketsCopy.atReview, note: detail.priceUnavailable },
    change: live ? { ...changeView(entry.change24h), caption: detail.past24h } : null,
    orderNote: live ? detail.liveNote : detail.quoteNote,
    chart: chartOf(state),
    ranges: { value: state.range, label: detail.rangeLabel },
    holding: visitor
      ? null
      : {
          title: detail.yourHolding,
          quantity: held ? quantity(position.amount) : null,
          value: held
            ? live
              ? detail.holdingValue(usd(position.value))
              : detail.valueWaiting
            : null,
          rows: holders.map((portfolio) => ({
            id: portfolio.id,
            label: detail.holdingRow(
              portfolio.label,
              quantity(
                portfolio.holdings.find((holding) => holding.symbol === symbol)?.amount ?? 0,
              ),
            ),
          })),
          none: held ? null : detail.notOwned,
        },
    about: {
      title: detail.aboutAndRisk,
      lines: [detail.aboutTracker(symbol, entry.name), detail.issuerControl, detail.dividends],
      notOffered: tradeCopy.tracker.notOffered,
      retired: entry.retired ? detail.retired(symbol) : null,
      readRisks: detail.readRisks,
      issuerDetails: detail.issuerDetails,
    },
    actions,
    bottomNote:
      !visitor && portfolios.length > 0 && entry.retired && holders.length === 0
        ? detail.retiredMobile
        : null,
    offline: mobile && !visitor && !online ? mobileMarketsCopy.detail.offline : null,
  };
}
