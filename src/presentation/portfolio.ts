import type { ScreenReads } from "../application/screenReads.js";
import { activityCopy } from "../copy/activity.js";
import { commonCopy } from "../copy/common.js";
import { pieCopy } from "../copy/pie.js";
import { mobilePortfolioCopy, portfolioCopy } from "../copy/portfolio.js";
import type { AppPlatform } from "../domain/appPlatform.js";
import {
  changeTone,
  deltaText,
  sinceDate,
  symbolAmount,
  tokenAmount,
  usd,
} from "../domain/format.js";
import { REBALANCE_DRIFT, needsRebalance } from "../domain/pie.js";
import { resolvePortfolioIcon, type PortfolioIcon } from "../domain/portfolioIcon.js";
import type { Portfolio, Wallet } from "../domain/wallet.js";
import { entryAmount, recentActivity, type ActivityRowView } from "./activity.js";
import { pendingActionNote } from "./pendingAction.js";

const USDC = "USDC";
const RECENT_ROWS = 8;

/** The tone a change is set in: a gain, a loss, or dim for exactly nothing. */
export type ChangeTone = "safe" | "danger" | "dim";

export function toneOf(value: number): ChangeTone {
  const tone = changeTone(value);
  return tone === "neutral" ? "dim" : tone;
}

function trackerName(reads: Pick<ScreenReads, "asset">, symbol: string) {
  return commonCopy.tracker(reads.asset(symbol)?.name ?? symbol);
}

export type PortfolioRowView = {
  id: string;
  name: string;
  icon: PortfolioIcon;
  line: string;
  value: string;
  change: { text: string; tone: ChangeTone } | null;
  spoken: string;
};

/** One portfolio as a row of a list: its mark, name, one useful line, value and day. */
export function portfolioRowView(
  reads: ScreenReads,
  portfolio: Portfolio,
  updatedAt: number | null,
): PortfolioRowView {
  const cash = usd(reads.cashOf(portfolio));
  const positions = reads.heldPositions(portfolio).length;
  const home = portfolioCopy.home;
  const line = portfolio.pie
    ? home.portfolioLine.pie(portfolio.pie.length, cash)
    : positions > 0
      ? home.portfolioLine.holdings(cash, positions)
      : portfolioCopy.card.noInvestments;
  const value = reads.portfolioPriced(portfolio, updatedAt)
    ? usd(reads.portfolioValue(portfolio))
    : portfolioCopy.card.valueUnavailable;
  const day = reads.portfolioDayChange(portfolio, updatedAt);
  const change = day ? { text: deltaText(day.percent, day.usd), tone: toneOf(day.usd) } : null;
  return {
    id: portfolio.id,
    name: portfolio.label,
    icon: resolvePortfolioIcon(portfolio.icon),
    line,
    value,
    change,
    spoken: [portfolio.label, line, value, change?.text].filter(Boolean).join(", "),
  };
}

/** What a control on a portfolio's screen asks for. The app maps each to a sheet or screen. */
export type PortfolioAction =
  | { to: "fund" }
  | { to: "invest" }
  | { to: "rebalance" }
  | { to: "buy" }
  | { to: "sell"; symbol: string }
  | { to: "receive" }
  | { to: "send" }
  | { to: "editMix" }
  | { to: "tracker"; symbol: string };

export type ActionButton = { label: string; action: PortfolioAction; disabled?: boolean };

export type HoldingRowView = {
  key: string;
  name: string;
  caption: string;
  amount: string;
  /** Dollars, "Price unavailable", or nothing for cash and unpriced other assets. */
  value: string | null;
  /** Trackers open their own screen; cash and anything else do not. */
  tracker: string | null;
  sell: { label: string; disabled: boolean; reason: string | null } | null;
  spoken: string;
};

export type MixSliceView = {
  symbol: string;
  name: string;
  line: string;
  /** Two points or more from target: said in words as well as colour. */
  drift: "over" | "under" | null;
  trailing: string;
  sell: string | null;
  /** The bar under the row: the current share, and where the target sits. */
  current: number;
  target: number;
};

export type MixView = {
  title: string;
  edit: string | null;
  target: number[];
  current: number[] | undefined;
  centre: { label: string; value: string | null };
  ringLabel: string;
  slices: MixSliceView[];
};

export type PortfolioDetailView = {
  kind: "found";
  id: string;
  name: string;
  icon: PortfolioIcon;
  kindLine: string;
  valueLabel: string;
  value: string;
  valueUnavailable: boolean;
  cashLine: string;
  archived: { title: string; lead: string; restore: string; settings: string } | null;
  pending: string | null;
  primary: ActionButton | null;
  rebalance: ActionButton | null;
  quiet: ActionButton[];
  /** Why Send cannot be pressed, when it cannot. */
  sendReason: string | null;
  mix: MixView | null;
  holdings: { title: string; rows: HoldingRowView[] } | null;
  empty: { title: string; button: ActionButton; caption: string | null } | null;
  activity: { title: string; rows: ActivityRowView[]; empty: string };
};

export type PortfolioView =
  PortfolioDetailView | { kind: "missing"; message: string; back: string };

function holdingRows(
  reads: ScreenReads,
  portfolio: Portfolio,
  updatedAt: number | null,
  exclude: ReadonlySet<string>,
  archived: boolean,
): HoldingRowView[] {
  const detail = portfolioCopy.detail;
  const rows: { order: number; row: HoldingRowView }[] = [];
  for (const holding of portfolio.holdings) {
    if (holding.amount <= 0 || exclude.has(holding.symbol)) continue;
    const { symbol } = holding;
    if (symbol === USDC) {
      const amount = symbolAmount(USDC, holding.amount);
      rows.push({
        order: Number.POSITIVE_INFINITY,
        row: {
          key: symbol,
          name: detail.cashName,
          caption: USDC,
          amount,
          value: null,
          tracker: null,
          sell: null,
          spoken: [detail.cashName, amount].join(", "),
        },
      });
      continue;
    }
    const live = updatedAt !== null && reads.isLivePrice(symbol);
    const value = live ? usd(reads.holdingValue(holding)) : null;
    if (reads.isPosition(symbol)) {
      const name = trackerName(reads, symbol);
      const shown = reads.shownUnits(symbol, holding.amount);
      const amount = shown === undefined ? commonCopy.unavailable : symbolAmount(symbol, shown);
      const shownValue = value ?? commonCopy.priceUnavailable;
      rows.push({
        order: live ? reads.holdingValue(holding) : -1,
        row: {
          key: symbol,
          name,
          caption: symbol,
          amount,
          value: shownValue,
          tracker: symbol,
          sell: archived
            ? null
            : {
                label: detail.sellLabel(name),
                disabled: shown === undefined,
                reason: shown === undefined ? commonCopy.balanceUnavailable : null,
              },
          spoken: [name, amount, shownValue].join(", "),
        },
      });
      continue;
    }
    const name = reads.asset(symbol)?.name ?? symbol;
    const amount = symbolAmount(symbol, holding.amount);
    rows.push({
      order: -2,
      row: {
        key: symbol,
        name,
        caption: symbol,
        amount,
        value,
        tracker: null,
        sell: null,
        spoken: [name, amount, value].filter(Boolean).join(", "),
      },
    });
  }
  return rows.sort((a, b) => b.order - a.order).map((entry) => entry.row);
}

function percent(value: number) {
  return value.toFixed(1);
}

function mixView(
  reads: ScreenReads,
  portfolio: Portfolio,
  updatedAt: number | null,
  archived: boolean,
): MixView {
  const words = portfolioCopy.mix;
  const slices = reads.pieSlices(portfolio);
  const invested = slices.some((slice) => slice.amount > 0);
  const live = reads.piePriced(portfolio, updatedAt);
  const measured = invested && live;
  const sliceViews: MixSliceView[] = slices.map((slice) => {
    const gap = slice.actual - slice.weight;
    const drift =
      measured && Math.abs(gap) >= REBALANCE_DRIFT ? (gap > 0 ? "over" : "under") : null;
    const now = measured ? percent(slice.actual) : null;
    const trailing =
      slice.amount <= 0 ? pieCopy.mix.notBought : live ? usd(slice.value) : pieCopy.mix.unpriced;
    const name = trackerName(reads, slice.symbol);
    return {
      symbol: slice.symbol,
      name,
      line:
        now === null
          ? words.targetLine(slice.weight)
          : `${words.targetLine(slice.weight)} · ${words.nowShare(now, drift)}`,
      drift,
      trailing,
      sell: slice.amount > 0 && !archived ? portfolioCopy.detail.sellLabel(name) : null,
      current: measured ? slice.actual : 0,
      target: slice.weight,
    };
  });
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const centre = !invested
    ? { label: pieCopy.mix.centreTarget, value: pieCopy.mix.trackers(slices.length) }
    : live
      ? { label: pieCopy.mix.centreInvested, value: usd(total) }
      : { label: pieCopy.mix.centreUnpriced, value: null };
  return {
    title: pieCopy.mix.title,
    edit: archived ? null : pieCopy.mix.edit,
    target: slices.map((slice) => slice.weight),
    current: !invested
      ? slices.map(() => 0)
      : live
        ? slices.map((slice) => slice.actual)
        : undefined,
    centre,
    ringLabel: words.ringLabel(
      slices.map((slice, index) =>
        words.sliceSpoken(
          sliceViews[index].name,
          slice.weight,
          sliceViews[index].current > 0 ? percent(slice.actual) : null,
          sliceViews[index].drift,
        ),
      ),
    ),
    slices: sliceViews,
  };
}

function actions(reads: ScreenReads, portfolio: Portfolio, updatedAt: number | null) {
  const detail = portfolioCopy.detail;
  const cash = reads.cashOf(portfolio);
  const holdsAnything = portfolio.holdings.some((holding) => holding.amount > 0);
  const primary: ActionButton =
    cash <= 0
      ? { label: detail.moveMoneyHere, action: { to: "fund" } }
      : portfolio.pie
        ? { label: detail.invest, action: { to: "invest" } }
        : { label: detail.buyTracker, action: { to: "buy" } };
  const quiet: ActionButton[] = [
    { label: detail.receive, action: { to: "receive" } },
    { label: detail.send, action: { to: "send" }, disabled: !holdsAnything },
    ...(cash > 0 ? [{ label: detail.addMoney, action: { to: "fund" } } as const] : []),
  ];
  const rebalance =
    portfolio.pie &&
    reads.piePriced(portfolio, updatedAt) &&
    needsRebalance(reads.pieSlices(portfolio))
      ? { label: detail.rebalance, action: { to: "rebalance" } as const }
      : null;
  return { primary, rebalance, quiet, sendReason: holdsAnything ? null : detail.sendDisabled };
}

/**
 * One portfolio: its value, what it holds and what can be done with it,
 * decided from the wallet and when prices were last read (null: there is no
 * live price, so nothing priced shows a number).
 */
export function portfolioView(
  reads: ScreenReads,
  wallet: Wallet,
  id: string,
  updatedAt: number | null,
): PortfolioView {
  const detail = portfolioCopy.detail;
  const portfolio = wallet.portfolios.find((entry) => entry.id === id);
  if (!portfolio) {
    return { kind: "missing", message: portfolioCopy.notFound.message, back: detail.backHome };
  }
  const archived = portfolio.archivedAt !== null;
  const cash = reads.cashOf(portfolio);
  const isPie = portfolio.pie !== undefined;
  const empty = !isPie && reads.heldPositions(portfolio).length === 0;
  const valued = reads.portfolioPriced(portfolio, updatedAt);
  const block = actions(reads, portfolio, updatedAt);
  const pieSymbols = new Set((portfolio.pie ?? []).map((slice) => slice.symbol));
  const rows = holdingRows(reads, portfolio, updatedAt, pieSymbols, archived);
  const kind = isPie ? detail.pie : detail.portfolio;

  return {
    kind: "found",
    id: portfolio.id,
    name: portfolio.label,
    icon: resolvePortfolioIcon(portfolio.icon),
    kindLine: detail.kindLine(kind, sinceDate(portfolio.createdAt)),
    valueLabel: detail.value,
    value: valued ? usd(reads.portfolioValue(portfolio)) : detail.valueUnavailable,
    valueUnavailable: !valued,
    cashLine: detail.cashToInvest(tokenAmount(cash)),
    archived: archived
      ? {
          title: detail.archivedTitle,
          lead: detail.archivedLead,
          restore: detail.restore,
          settings: detail.settings,
        }
      : null,
    pending: portfolio.pendingAction
      ? pendingActionNote("portfolio", portfolio.pendingAction.what, "waiting")
      : null,
    primary: archived || empty ? null : block.primary,
    rebalance: archived ? null : block.rebalance,
    quiet: archived ? [] : block.quiet,
    sendReason: archived ? null : block.sendReason,
    mix: isPie ? mixView(reads, portfolio, updatedAt, archived) : null,
    holdings:
      empty || rows.length === 0
        ? null
        : {
            title: isPie ? portfolioCopy.holdings.titleInPie : portfolioCopy.holdings.title,
            rows,
          },
    empty:
      empty && !archived
        ? {
            title: detail.emptyTitle,
            button:
              cash > 0
                ? { label: detail.addFirstTracker, action: { to: "buy" } }
                : { label: detail.moveMoneyHere, action: { to: "fund" } },
            caption: cash > 0 ? null : detail.addMoneyFirst,
          }
        : null,
    activity: {
      title: detail.recentActivity,
      rows: recentActivity(reads, wallet, RECENT_ROWS, portfolio.id),
      empty: detail.nothingMoved,
    },
  };
}

export type PublicView = {
  address: string;
  holdings: { key: string; text: string }[];
  transactions: { id: string; kind: string; amount: string; date: string }[];
};

/**
 * What someone with this portfolio's address can see, as far as this device
 * knows: tickers and amounts as last read, and this device's own entries for
 * it. No name the person gave, nothing from any other portfolio, and nothing
 * fetched to draw it.
 */
export function publicView(reads: ScreenReads, portfolio: Portfolio, wallet: Wallet): PublicView {
  return {
    address: portfolio.address,
    holdings: portfolio.holdings
      .filter((holding) => holding.amount > 0)
      .map((holding) => {
        const shown = reads.shownUnits(holding.symbol, holding.amount);
        return {
          key: holding.symbol,
          text:
            shown === undefined
              ? `${holding.symbol} · ${commonCopy.unavailable}`
              : symbolAmount(holding.symbol, shown),
        };
      }),
    transactions: wallet.activity
      .filter((entry) => entry.portfolioId === portfolio.id)
      .sort((a, b) => b.at - a.at)
      .map((entry) => ({
        id: entry.id,
        kind: activityCopy.entry(entry.kind, entry.symbol),
        amount: entryAmount(reads, entry),
        date: sinceDate(entry.at),
      })),
  };
}

/** The most characters a portfolio's name may have. */
export const NAME_MAX = 64;

export type SettingsDraft = { name: string; icon: PortfolioIcon };

export type PortfolioSettingsView = {
  title: string;
  nameLabel: string;
  save: string;
  canSave: boolean;
  archived: boolean;
  sectionTitle: string;
  sectionLead: string;
  /** Said above Archive when the portfolio still holds something. */
  stillHolds: string | null;
  toggle: string;
};

/** The draft a settings sheet opens with: the stored name and mark. */
export function settingsDraft(portfolio: Portfolio): SettingsDraft {
  return { name: portfolio.label, icon: resolvePortfolioIcon(portfolio.icon) };
}

/** Whether the draft differs from what is stored, so leaving asks first. */
export function draftChanged(portfolio: Portfolio, draft: SettingsDraft): boolean {
  const stored = settingsDraft(portfolio);
  return (
    draft.name !== stored.name ||
    draft.icon.glyph !== stored.icon.glyph ||
    draft.icon.tint !== stored.icon.tint
  );
}

/**
 * Save needs a name that is not empty once trimmed, and a change to the name
 * or the mark. Archiving moves nothing, so a portfolio that still holds value
 * only says so.
 */
export function portfolioSettingsView(
  reads: ScreenReads,
  portfolio: Portfolio,
  draft: SettingsDraft,
  updatedAt: number | null,
): PortfolioSettingsView {
  const words = portfolioCopy.settings;
  const name = draft.name.trim();
  const archived = portfolio.archivedAt !== null;
  const holds = portfolio.holdings.some((holding) => holding.amount > 0);
  const stillHolds =
    archived || !holds
      ? null
      : reads.portfolioPriced(portfolio, updatedAt)
        ? words.stillHolds(usd(reads.portfolioValue(portfolio)))
        : words.stillHoldsUnpriced;
  return {
    title: words.title,
    nameLabel: words.nameLabel,
    save: commonCopy.save,
    canSave: name.length > 0 && draftChanged(portfolio, { ...draft, name }),
    archived,
    sectionTitle: archived ? words.restoreTitle : words.archiveTitle,
    sectionLead: words.archiveLead,
    stillHolds,
    toggle: archived ? commonCopy.restore : commonCopy.archive,
  };
}

export type NewKind = "portfolio" | "pie";

export const NEW_KINDS: readonly NewKind[] = ["portfolio", "pie"];

export type NewPortfolioView = {
  title: string;
  kindsLabel: string;
  kindLabels: Record<NewKind, string>;
  description: string;
  lead: string;
  nameLabel: string;
  placeholder: string;
  suggestions: readonly string[];
  submit: string;
  submitting: string;
  canSubmit: boolean;
};

/**
 * A name only the person sees, trimmed and not empty; for a pie, a mix with
 * no problem as well (the builder's own problem line is the reason).
 */
export function newPortfolioView(state: {
  kind: NewKind;
  name: string;
  mixProblem: string | null;
  platform: AppPlatform;
}): NewPortfolioView {
  const create = portfolioCopy.create;
  const mobile = state.platform === "mobile";
  const pie = state.kind === "pie";
  const kinds = mobile ? { ...create.kinds, ...mobilePortfolioCopy.create.kinds } : create.kinds;
  return {
    title: pie ? create.titlePie : create.titlePortfolio,
    kindsLabel: create.kindsLabel,
    kindLabels: { portfolio: kinds.portfolio.title, pie: kinds.pie.title },
    description: kinds[state.kind].description,
    lead: pie ? create.pieLead : mobile ? mobilePortfolioCopy.create.lead : create.lead,
    nameLabel: pie ? pieCopy.builder.nameLabel : create.nameLabel,
    placeholder: pie ? pieCopy.builder.namePlaceholder : create.namePlaceholder,
    suggestions: pie ? [] : create.suggestions,
    submit: pie ? create.pieSubmit : create.submit,
    submitting: pie ? create.pieCreating : create.creating,
    canSubmit: state.name.trim().length > 0 && (!pie || state.mixProblem === null),
  };
}
