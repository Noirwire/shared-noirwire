import type { ScreenReads } from "../application/screenReads.js";
import { commonCopy } from "../copy/common.js";
import { fundingCopy } from "../copy/funding.js";
import { portfolioCopy } from "../copy/portfolio.js";
import { deltaText, shares, tokenAmount, usd } from "../domain/format.js";
import type { Wallet } from "../domain/wallet.js";
import { recentActivity, type ActivityRowView } from "./activity.js";
import {
  balancesView,
  freshnessView,
  type Figure,
  type HomeFreshness,
  type UnavailableView,
} from "./freshness.js";
import { fundingWalletValue } from "./funding.js";
import { portfolioRowView, toneOf, type ChangeTone, type PortfolioRowView } from "./portfolio.js";

/** Where a Home control leads. The app maps each to a screen or sheet. */
export type HomeTarget =
  | { to: "markets" }
  | { to: "fund"; portfolioId?: string }
  | { to: "addMoney" }
  | { to: "fundingWallet" };

export type HomeAction = { label: string; target: HomeTarget };

/**
 * What an archived portfolio still holds, which Home's emptiness check must
 * count even though archived portfolios are left out of the total: `holds`
 * is true while any archived portfolio has a tracker or money moved into it,
 * and `earnUnknown` is true while any archived portfolio's Earn position has
 * not been confirmed as zero (still being read, or the read failed). Either
 * one keeps Home from leading with "Add money" over a wallet that is not
 * really empty.
 */
export type ArchivedHeldState = {
  holds: boolean;
  earnUnknown: boolean;
};

export type InvestmentRowView = {
  symbol: string;
  name: string;
  caption: string;
  value: string;
  spoken: string;
};

export type HomeView = {
  total: {
    label: string;
    /** Null until balances have been read once: nothing is drawn, never a zero. */
    value: Figure;
    unavailable: boolean;
    change?: string;
    changeTone: ChangeTone | "faint";
    /** The tappable line under the total: who sees it. */
    explainer: string;
  };
  /**
   * Balances or prices that did load may be out of date. Null while both are
   * current, while they are still loading, and while `unavailable` is said.
   */
  stale: string | null;
  /** Balances or prices have never been read, and nothing has failed: the screen waits. */
  loading: boolean;
  /**
   * Balances have never been read and the read failed. Every figure is null,
   * and this one line is shown with its retry in place of the stale notice.
   */
  unavailable: UnavailableView | null;
  /** The header arc is a share of something. With a total of zero there is nothing to draw. */
  showArc: boolean;
  /** The "Ready to invest" row: what the portfolios hold uninvested. */
  cash: { label: string; value: Figure };
  /**
   * What every portfolio has in Earn together. Null where Earn does not run:
   * Home then shows no Earn tile and no "could be earning" card.
   */
  earn: { label: string; value: string } | null;
  /** Total value, Earn and the funding wallet are all zero: the screen leads with getting money in. */
  empty: boolean;
  /** USDC sitting in the funding wallet, waiting to be moved into a portfolio. */
  waiting: { text: string; action: HomeAction | null } | null;
  /**
   * The main wallet's row: its name, what its USDC and SOL are worth, and
   * its own page. The figure is null until balances have been read once, and
   * while SOL it holds has no live price.
   */
  fundingWallet: { label: string; value: Figure; target: HomeTarget };
  primary: HomeAction;
  /** Null while the wallet is empty: the one button there is "Add money". */
  secondary: HomeAction | null;
  /** The funding notice holds the one primary button, so both actions render quiet. */
  actionsQuiet: boolean;
  /** The one line under the button while the wallet is empty: where money arrives and what happens next. */
  explanation: string | null;
  portfolios: PortfolioRowView[];
  archived: { heading: string; rows: PortfolioRowView[] };
  investments: InvestmentRowView[];
  recent: ActivityRowView[];
};

/**
 * What is in Earn across every portfolio: undefined where Earn is not
 * offered, null while it could not be read, else the total in USDC.
 */
export type EarnTotal = number | null | undefined;

const RECENT_ROWS = 3;

function fundingHoldsAnything(wallet: Wallet) {
  return (
    wallet.funding.sol > 0 || Object.values(wallet.funding.tokens).some((amount) => amount > 0)
  );
}

/** Each tracker held across every active portfolio, largest first. */
function investments(
  reads: ScreenReads,
  positions: Map<string, number>,
  updatedAt: number | null,
): InvestmentRowView[] {
  return [...positions.entries()]
    .map(([symbol, held]) => {
      const priced = updatedAt !== null && reads.isLivePrice(symbol);
      const shown = reads.shownUnits(symbol, held);
      const tokens = shown === undefined ? commonCopy.unavailable : shares(shown);
      const name = commonCopy.tracker(reads.asset(symbol)?.name ?? symbol);
      const caption = portfolioCopy.holdings.line(symbol, portfolioCopy.holdings.tokens(tokens));
      const value = priced ? usd(held * reads.price(symbol)) : commonCopy.priceUnavailable;
      return {
        order: priced ? held * reads.price(symbol) : -1,
        row: { symbol, name, caption, value, spoken: [name, caption, value].join(", ") },
      };
    })
    .sort((a, b) => b.order - a.order)
    .map((entry) => entry.row);
}

function totalOf(
  overview: ReturnType<ScreenReads["portfolioOverview"]>,
  empty: boolean,
  earn: EarnTotal,
  balancesKnown: boolean,
): HomeView["total"] {
  const home = portfolioCopy.home;
  const label = home.totalValue;
  const explainer = home.onlyYouSee;
  if (!balancesKnown) {
    return { label, explainer, value: null, unavailable: true, changeTone: "faint" };
  }
  if (!overview.valued) {
    return {
      label,
      explainer,
      value: home.valueUnavailable,
      unavailable: true,
      change: home.waitingForValues,
      changeTone: "faint",
    };
  }
  // What is lent is the person's money like the rest, so it counts. While
  // it cannot be read, the total is of everything else, and the Earn line says so.
  const value = usd(overview.total + (earn ?? 0));
  if (empty || !overview.hasInvestments) {
    return { label, explainer, value, unavailable: false, changeTone: "dim" };
  }
  if (!overview.day) {
    return {
      label,
      explainer,
      value,
      unavailable: false,
      change: home.noDayChange,
      changeTone: "faint",
    };
  }
  return {
    label,
    explainer,
    value,
    unavailable: false,
    change: home.heldTrackersDay(deltaText(overview.day.percent, overview.day.usd)),
    changeTone: toneOf(overview.day.usd),
  };
}

/**
 * Everything on Home, decided from the unlocked wallet, when prices were
 * last read (null: there is no live price), what is in Earn, and how
 * current the balances and the prices are (`freshness`: the notice shows the
 * moment a refresh fails and goes on the next one that succeeds). Until
 * balances have been read once nothing is known of what the wallet holds:
 * every figure is null, the wallet is not called empty, and a failed first
 * read is `unavailable`. The combined total and the combined list of trackers exist only here, added
 * up on the device.
 */
export function homeView(
  reads: ScreenReads,
  wallet: Wallet,
  updatedAt: number | null,
  earn: EarnTotal,
  archivedHeld: ArchivedHeldState,
  freshness: HomeFreshness,
): HomeView {
  const home = portfolioCopy.home;
  const addMoneyCopy = portfolioCopy.addMoney;
  const overview = reads.portfolioOverview(wallet, updatedAt);
  const balances = balancesView(freshness.balances);
  const { known } = balances;
  const fresh = freshnessView(freshness.now, [
    ...(known ? [{ read: freshness.balances, notice: "balances" as const }] : []),
    { read: freshness.prices, notice: "prices" },
  ]);
  const earnUnconfirmed = earn === null || archivedHeld.earnUnknown;
  const earnHeld = typeof earn === "number" && earn > 0;
  const empty =
    known &&
    overview.valued &&
    overview.total === 0 &&
    !overview.hasInvestments &&
    !fundingHoldsAnything(wallet) &&
    !archivedHeld.holds &&
    !earnUnconfirmed &&
    !earnHeld;
  const usdc = wallet.funding.tokens.USDC ?? 0;
  const first = reads.activePortfolios(wallet)[0];
  const waiting =
    known && usdc > 0
      ? {
          text: addMoneyCopy.arrived(tokenAmount(usdc)),
          action: first
            ? {
                label: addMoneyCopy.moveTo(first.label),
                target: { to: "fund", portfolioId: first.id } as const,
              }
            : null,
        }
      : null;

  const addMoney: HomeAction = {
    label: home.addMoney,
    target: known && usdc > 0 ? { to: "fund" } : { to: "addMoney" },
  };
  const archived = reads.archivedPortfolios(wallet);
  const fundingValue = fundingWalletValue(reads, wallet, updatedAt);

  return {
    stale: balances.unavailable ? null : fresh.stale,
    loading: balances.loading || (known && fresh.loading),
    unavailable: balances.unavailable,
    total: totalOf(overview, empty, earn, known),
    showArc: known && overview.valued && overview.total + (earn ?? 0) > 0,
    cash: { label: home.readyToInvest, value: known ? usd(overview.cash) : null },
    earn:
      earn === undefined
        ? null
        : { label: home.earning, value: earn === null ? commonCopy.unavailable : usd(earn) },
    empty,
    waiting,
    fundingWallet: {
      label: fundingCopy.wallet.title,
      value: known && fundingValue !== null ? usd(fundingValue) : null,
      target: { to: "fundingWallet" },
    },
    primary: empty
      ? { label: home.addMoney, target: { to: "addMoney" } }
      : { label: home.findTrackers, target: { to: "markets" } },
    secondary: empty ? null : addMoney,
    actionsQuiet: waiting?.action != null,
    explanation: empty ? home.moneyArrives : null,
    portfolios: overview.portfolios.map((portfolio) =>
      portfolioRowView(reads, portfolio, updatedAt, freshness.balances),
    ),
    archived: {
      heading: home.archivedCount(archived.length),
      rows: archived.map((portfolio) =>
        portfolioRowView(reads, portfolio, updatedAt, freshness.balances),
      ),
    },
    investments: known ? investments(reads, overview.positions, updatedAt) : [],
    recent: recentActivity(reads, wallet, RECENT_ROWS),
  };
}
