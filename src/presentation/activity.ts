import type { ScreenReads } from "../application/screenReads.js";
import { activityCopy, mobileActivityCopy } from "../copy/activity.js";
import { commonCopy } from "../copy/common.js";
import type { AppPlatform } from "../domain/appPlatform.js";
import { dateAndTime, sinceDate, spokenDay, usd } from "../domain/format.js";
import { resolvePortfolioIcon, type PortfolioIcon } from "../domain/portfolioIcon.js";
import type { Activity, ActivityKind, Wallet } from "../domain/wallet.js";
import { activityAmountOf } from "./amount.js";

type Reads = Pick<ScreenReads, "asset" | "isPosition">;

export type ActivityFilter = "all" | "funding" | "transfers" | "trades" | "earn";

const FILTER_KINDS: Record<ActivityFilter, readonly ActivityKind[]> = {
  all: ["fund", "send", "buy", "sell", "earnDeposit", "earnWithdraw"],
  funding: ["fund"],
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
  fund: "in",
  send: "out",
  buy: "bought",
  sell: "sold",
  earnDeposit: "earn",
  earnWithdraw: "earn",
};

/** Money in, sells and returns from Earn add to a portfolio's cash; the rest takes from it. */
const INCOMING: Record<ActivityKind, boolean> = {
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
  amount: string;
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

/** The dollar value at the time with its sign, or "Not priced" when there was no live price. */
export function activityValue(entry: Pick<Activity, "kind" | "usd">): ActivityValue {
  if (!(entry.usd > 0)) return { text: activityCopy.notPriced, tone: "faint", priced: false };
  const incoming = INCOMING[entry.kind];
  return {
    text: `${incoming ? "+" : "-"}${usd(entry.usd)}`,
    tone: incoming ? "safe" : "ink",
    priced: true,
  };
}

function portfolioName(wallet: Wallet, id: string): string {
  return (
    wallet.portfolios.find((portfolio) => portfolio.id === id)?.label ??
    activityCopy.portfolioFallback
  );
}

export function activityRow(reads: Reads, wallet: Wallet, entry: Activity): ActivityRowView {
  const name = portfolioName(wallet, entry.portfolioId);
  const title = activityTitle(reads, entry);
  const caption = entry.kind === "send" ? activityCopy.sentCaption(name) : name;
  const value = activityValue(entry);
  const amount = entryAmount(reads, entry);
  const spokenValue = value.priced
    ? `${INCOMING[entry.kind] ? activityCopy.plus : activityCopy.minus} ${usd(entry.usd)}`
    : value.text;
  return {
    id: entry.id,
    icon: ICON[entry.kind],
    title,
    caption,
    value,
    amount,
    spoken: [title, caption, spokenDay(entry.at), spokenValue, amount].join(", "),
  };
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

export type ActivityListView =
  | { kind: "none"; title: string; detail: string }
  | { kind: "noMatch"; title: string }
  | { kind: "list"; sections: ActivitySection[]; more: boolean };

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
  if (wallet.activity.length === 0) {
    const detail =
      state.platform === "mobile" ? mobileActivityCopy.emptyDetail : activityCopy.emptyDetail;
    return { kind: "none", title: activityCopy.empty, detail };
  }
  const matching = newestFirst(filterActivity(wallet.activity, filter));
  if (matching.length === 0) return { kind: "noMatch", title: activityCopy.noMatch };
  const sections: ActivitySection[] = [];
  for (const entry of matching.slice(0, limit)) {
    const title = dayHeading(entry.at, now);
    const row = activityRow(reads, wallet, entry);
    const last = sections[sections.length - 1];
    if (last?.title === title) last.rows.push(row);
    else sections.push({ title, rows: [row] });
  }
  return { kind: "list", sections, more: matching.length > limit };
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
  portfolioFallback: string;
  date: string;
  amount: string;
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
  const entry = wallet.activity.find((item) => item.id === id);
  if (!entry) return null;
  const value = activityValue(entry);
  const amount = entryAmount(reads, entry);
  const portfolio = wallet.portfolios.find((item) => item.id === entry.portfolioId);
  return {
    title: activityTitle(reads, entry),
    headline: value.priced ? value.text : amount,
    headlineTone: value.priced ? value.tone : "ink",
    portfolio: portfolio
      ? { id: portfolio.id, name: portfolio.label, icon: resolvePortfolioIcon(portfolio.icon) }
      : null,
    portfolioFallback: activityCopy.portfolioFallback,
    date: dateAndTime(entry.at),
    amount,
    value: value.priced ? usd(entry.usd) : activityCopy.notPriced,
    recipient: entry.kind === "send" && entry.counterparty ? entry.counterparty : null,
  };
}
