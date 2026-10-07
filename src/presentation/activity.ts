import { FUNDING } from "../application/pendingActions.js";
import type { ScreenReads } from "../application/screenReads.js";
import { activityCopy, mobileActivityCopy } from "../copy/activity.js";
import { commonCopy } from "../copy/common.js";
import { fundingCopy } from "../copy/funding.js";
import type { AppPlatform } from "../domain/appPlatform.js";
import { dateAndTime, sinceDate, spokenDay, usd } from "../domain/format.js";
import { resolvePortfolioIcon, type PortfolioIcon } from "../domain/portfolioIcon.js";
import {
  MAX_ACTIVITY_ENTRIES,
  type Activity,
  type ActivityKind,
  type Wallet,
} from "../domain/wallet.js";
import { activityAmountOf } from "./amount.js";

type Reads = Pick<ScreenReads, "asset" | "isPosition">;

export type ActivityFilter = "all" | "funding" | "transfers" | "trades" | "earn";

const FILTER_KINDS: Record<ActivityFilter, readonly ActivityKind[]> = {
  all: ["deposit", "fund", "send", "buy", "sell", "earnDeposit", "earnWithdraw"],
  funding: ["deposit", "fund"],
  transfers: ["send"],
  trades: ["buy", "sell"],
  earn: ["earnDeposit", "earnWithdraw"],
};

export const ACTIVITY_FILTERS: readonly { id: ActivityFilter; label: string }[] = (
  ["all", "funding", "transfers", "trades", "earn"] as const
).map((id) => ({ id, label: activityCopy.filters[id] }));

/** Which mark leads a row: money in, money out, bought, sold, or moved to or from Earn. */
export type ActivityIcon = "in" | "out" | "bought" | "sold" | "earn";

const ICON: Record<ActivityKind, ActivityIcon> = {
  deposit: "in",
  fund: "in",
  send: "out",
  buy: "bought",
  sell: "sold",
  earnDeposit: "earn",
  earnWithdraw: "earn",
};

/**
 * Money in, sells and returns from Earn add to the cash of the portfolio (or
 * of the main wallet) the entry belongs to; the rest takes from it.
 */
const INCOMING: Record<ActivityKind, boolean> = {
  deposit: true,
  fund: true,
  sell: true,
  earnWithdraw: true,
  send: false,
  buy: false,
  earnDeposit: false,
};

export type ActivityValue = { text: string; tone: "safe" | "ink" | "faint"; priced: boolean };

export type ActivityRowView = {
  id: string;
  icon: ActivityIcon;
  title: string;
  caption: string;
  value: ActivityValue;
  /** What moved, as it arrived: a return from Earn less the network cost taken out of it. */
  amount: string;
  /** "Network cost 0.02 USDC" when the action was charged one, else null. */
  networkCost: string | null;
  /** The whole row as one sentence, with the sign spoken rather than coloured. */
  spoken: string;
};

export type ActivitySection = { title: string; rows: ActivityRowView[] };

function trackerName(reads: Reads, symbol: string) {
  return commonCopy.tracker(reads.asset(symbol)?.name ?? symbol);
}

/** "Money arrived", "Sent", "Bought NVIDIA tracker", "Moved into Earn". */
export function activityTitle(reads: Reads, entry: Pick<Activity, "kind" | "symbol">): string {
  switch (entry.kind) {
    case "buy":
      return activityCopy.bought(trackerName(reads, entry.symbol));
    case "sell":
      return activityCopy.sold(trackerName(reads, entry.symbol));
    default:
      return activityCopy.entry(entry.kind, entry.symbol);
  }
}

/** The amount an entry moved, in its own unit, as it read on the day. */
export function entryAmount(
  reads: Reads,
  entry: Pick<Activity, "symbol" | "amount" | "shown">,
): string {
  return activityAmountOf(entry, reads.isPosition(entry.symbol));
}

/**
 * The dollar value at the time with its sign, or "Not priced" when there was
 * no live price. `incoming` is whether it added to where it is listed: by
 * the entry's kind unless said, since a move into a portfolio is money out
 * on the main wallet's own list.
 */
export function activityValue(
  entry: Pick<Activity, "kind" | "usd">,
  incoming: boolean = INCOMING[entry.kind],
): ActivityValue {
  if (!(entry.usd > 0)) return { text: activityCopy.notPriced, tone: "faint", priced: false };
  return {
    text: `${incoming ? "+" : "-"}${usd(entry.usd)}`,
    tone: incoming ? "safe" : "ink",
    priced: true,
  };
}

function portfolioName(wallet: Wallet, id: string): string {
  if (id === FUNDING) return fundingCopy.wallet.title;
  return (
    wallet.portfolios.find((portfolio) => portfolio.id === id)?.label ??
    activityCopy.portfolioFallback
  );
}

const ONE_CENT = 0.01;

/** A network cost as money: to the cent, or as it is when it is under one. */
function costFigure(cost: number): string {
  return `${cost < ONE_CENT ? Number(cost.toFixed(6)) : cost.toFixed(2)} USDC`;
}

/** The network cost an entry was charged, when it was charged one in cash. */
function chargedOf(entry: Activity): number {
  return entry.networkCost && entry.networkCost > 0 ? entry.networkCost : 0;
}

/**
 * An entry as what really arrived. A return from Earn pays its network cost
 * out of the cash it returns, so 10.00 withdrawn with a cost of 0.02 arrived
 * as 9.98, and that is the amount and the value shown. Every other entry is
 * as it was recorded: its cost came out of cash beside it.
 */
export function asArrived(entry: Activity): Activity {
  const cost = chargedOf(entry);
  if (entry.kind !== "earnWithdraw" || cost === 0 || !(entry.amount > cost)) return entry;
  const arrived = entry.amount - cost;
  return { ...entry, amount: arrived, usd: entry.usd * (arrived / entry.amount) };
}

type RowWords = { title: string; caption: string; icon: ActivityIcon; incoming: boolean };

function rowOf(reads: Reads, recorded: Activity, words: RowWords): ActivityRowView {
  const entry = asArrived(recorded);
  const { title, caption, icon, incoming } = words;
  const value = activityValue(entry, incoming);
  const amount = entryAmount(reads, entry);
  const cost = chargedOf(recorded);
  const networkCost = cost > 0 ? activityCopy.networkCost(costFigure(cost)) : null;
  const spokenValue = value.priced
    ? `${incoming ? activityCopy.plus : activityCopy.minus} ${usd(entry.usd)}`
    : value.text;
  return {
    id: entry.id,
    icon,
    title,
    caption,
    value,
    amount,
    networkCost,
    spoken: [title, caption, spokenDay(entry.at), spokenValue, amount, networkCost]
      .filter((part) => part !== null)
      .join(", "),
  };
}

/** The name of the place of this wallet a send went to, or null when it left the wallet. */
function movedTo(wallet: Wallet, recorded: Activity): string | null {
  if (recorded.kind !== "send" || !recorded.counterparty) return null;
  if (recorded.counterparty === wallet.funding.address) return fundingCopy.wallet.title;
  return (
    wallet.portfolios.find((portfolio) => portfolio.address === recorded.counterparty)?.label ??
    null
  );
}

export function activityRow(reads: Reads, wallet: Wallet, recorded: Activity): ActivityRowView {
  const name = portfolioName(wallet, recorded.portfolioId);
  const destination = movedTo(wallet, recorded);
  return rowOf(reads, recorded, {
    title: destination ? activityCopy.movedTo(destination) : activityTitle(reads, recorded),
    caption: recorded.kind === "send" && !destination ? activityCopy.sentCaption(name) : name,
    icon: ICON[recorded.kind],
    incoming: INCOMING[recorded.kind],
  });
}

/**
 * The main wallet's own list, newest first: money that arrived in it, its
 * sends, and every move into a portfolio. A move is recorded once, on the
 * portfolio it went to, and is shown here from the main wallet's side: money
 * out, to that portfolio.
 */
export function fundingActivity(reads: Reads, wallet: Wallet): ActivityRowView[] {
  return newestFirst(
    wallet.activity.filter((entry) => entry.portfolioId === FUNDING || entry.kind === "fund"),
  ).map((entry) =>
    entry.portfolioId === FUNDING
      ? activityRow(reads, wallet, entry)
      : rowOf(reads, entry, {
          title: activityCopy.movedToPortfolio,
          caption: portfolioName(wallet, entry.portfolioId),
          icon: "out",
          incoming: false,
        }),
  );
}

/** Newest first. */
export function newestFirst(entries: readonly Activity[]): Activity[] {
  return [...entries].sort((a, b) => b.at - a.at);
}

export function filterActivity(entries: readonly Activity[], filter: ActivityFilter): Activity[] {
  return entries.filter((entry) => FILTER_KINDS[filter].includes(entry.kind));
}

function dayKey(at: number) {
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** "Today", "Yesterday", or the day as "28 Sep 2026", by the device's calendar. */
export function dayHeading(at: number, now: number): string {
  if (dayKey(at) === dayKey(now)) return activityCopy.today;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey(at) === dayKey(yesterday.getTime())) return activityCopy.yesterday;
  return sinceDate(at);
}

export type ActivityListView = (
  | { kind: "none"; title: string; detail: string }
  | { kind: "noMatch"; title: string }
  | ActivityRows
) & {
  /**
   * Said on a wallet that was imported: what it did before, on another
   * device, is not in this list. Null on a wallet created here.
   */
  importedNote: string | null;
};

type ActivityRows = {
  kind: "list";
  sections: ActivitySection[];
  more: boolean;
  /**
   * Said under the last row once the list has reached the most the
   * record keeps: older entries are no longer on this device. Null while
   * more rows are still to be shown, or the list is short of the limit.
   */
  olderNotKept: string | null;
};

/**
 * The Activity screen: the log this device keeps, newest first, filtered,
 * grouped by day, and cut at `limit` rows so a long history loads as the list
 * scrolls.
 */
export function activityListView(
  reads: Reads,
  state: {
    wallet: Wallet;
    filter: ActivityFilter;
    limit: number;
    now: number;
    platform: AppPlatform;
  },
): ActivityListView {
  const { wallet, filter, limit, now } = state;
  const words = state.platform === "mobile" ? mobileActivityCopy : activityCopy;
  const importedNote = wallet.imported ? words.importedNote : null;
  if (wallet.activity.length === 0) {
    return { kind: "none", title: activityCopy.empty, detail: words.emptyDetail, importedNote };
  }
  const matching = newestFirst(filterActivity(wallet.activity, filter));
  if (matching.length === 0) {
    return { kind: "noMatch", title: activityCopy.noMatch, importedNote };
  }
  const sections: ActivitySection[] = [];
  for (const entry of matching.slice(0, limit)) {
    const title = dayHeading(entry.at, now);
    const row = activityRow(reads, wallet, entry);
    const last = sections[sections.length - 1];
    if (last?.title === title) last.rows.push(row);
    else sections.push({ title, rows: [row] });
  }
  const more = matching.length > limit;
  const olderNotKept =
    !more && wallet.activity.length >= MAX_ACTIVITY_ENTRIES
      ? words.olderNotKept(MAX_ACTIVITY_ENTRIES)
      : null;
  return { kind: "list", sections, more, olderNotKept, importedNote };
}

/** The most recent rows, for Home (every portfolio) or one portfolio's screen. */
export function recentActivity(
  reads: Reads,
  wallet: Wallet,
  count: number,
  portfolioId?: string,
): ActivityRowView[] {
  const entries = portfolioId
    ? wallet.activity.filter((entry) => entry.portfolioId === portfolioId)
    : wallet.activity;
  return newestFirst(entries)
    .slice(0, count)
    .map((entry) => activityRow(reads, wallet, entry));
}

export type ActivityDetailView = {
  title: string;
  headline: string;
  headlineTone: ActivityValue["tone"];
  portfolio: { id: string; name: string; icon: PortfolioIcon } | null;
  /** Said where there is no portfolio to open: "Main wallet" for an entry of the main wallet. */
  portfolioFallback: string;
  date: string;
  /** What the action was for: 10.00 USDC withdrawn, 5.00 USDC sent. */
  amount: string;
  /** What arrived once a network cost was taken out of it, when that differs from `amount`. Else null. */
  arrived: string | null;
  /** The network cost the action was charged, or null when it was charged none in cash. */
  networkCost: string | null;
  value: string;
  /** Only for a send: the address the person entered, held back until asked for. */
  recipient: string | null;
};

/** Everything this device recorded about one entry, or null when there is no such entry. */
export function activityDetailView(
  reads: Reads,
  wallet: Wallet,
  id: string,
): ActivityDetailView | null {
  const recorded = wallet.activity.find((item) => item.id === id);
  if (!recorded) return null;
  const entry = asArrived(recorded);
  const value = activityValue(entry);
  const amount = entryAmount(reads, recorded);
  const cost = chargedOf(recorded);
  const portfolio = wallet.portfolios.find((item) => item.id === entry.portfolioId);
  return {
    title: activityTitle(reads, entry),
    headline: value.priced ? value.text : amount,
    headlineTone: value.priced ? value.tone : "ink",
    portfolio: portfolio
      ? { id: portfolio.id, name: portfolio.label, icon: resolvePortfolioIcon(portfolio.icon) }
      : null,
    portfolioFallback:
      entry.portfolioId === FUNDING ? fundingCopy.wallet.title : activityCopy.portfolioFallback,
    date: dateAndTime(entry.at),
    amount,
    arrived: entry === recorded ? null : entryAmount(reads, entry),
    networkCost: cost > 0 ? costFigure(cost) : null,
    value: value.priced ? usd(entry.usd) : activityCopy.notPriced,
    recipient: entry.kind === "send" && entry.counterparty ? entry.counterparty : null,
  };
}
