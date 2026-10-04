import type { ScreenReads } from "../application/screenReads.js";
import { commonCopy } from "../copy/common.js";
import { portfolioCopy } from "../copy/portfolio.js";
import { deltaText, shares, tokenAmount, usd } from "../domain/format.js";
import type { Wallet } from "../domain/wallet.js";
import { recentActivity, type ActivityRowView } from "./activity.js";
import { portfolioRowView, toneOf, type ChangeTone, type PortfolioRowView } from "./portfolio.js";

/** Where a Home control leads. The app maps each to a screen or sheet. */
export type HomeTarget =
  { to: "markets" } | { to: "fund"; portfolioId?: string } | { to: "addMoney" };

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
    value: string;
    unavailable: boolean;
    change?: string;
    changeTone: ChangeTone | "faint";
    /** The tappable line under the total: who sees it. */
    explainer: string;
  };
  /** The header arc is a share of something. With a total of zero there is nothing to draw. */
  showArc: boolean;
  /** The "Ready to invest" row: what the portfolios hold uninvested. */
  cash: { label: string; value: string };
  /** What every portfolio has in Earn together; null where Earn is not offered. */
  earning: { label: string; value: string } | null;
  /** Total value, Earn and the funding wallet are all zero: the screen leads with getting money in. */
  empty: boolean;
  /** USDC sitting in the funding wallet, waiting to be moved into a portfolio. */
  waiting: { text: string; action: HomeAction | null } | null;
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
): HomeView["total"] {
  const home = portfolioCopy.home;
  const label = home.totalValue;
  const explainer = home.onlyYouSee;
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
 * last read (null: there is no live price) and what is in Earn. The combined
 * total and the combined list of trackers exist only here, added up on the
 * device.
 */
export function homeView(
  reads: ScreenReads,
  wallet: Wallet,
  updatedAt: number | null,
  earn: EarnTotal,
  archivedHeld: ArchivedHeldState,
): HomeView {
  const home = portfolioCopy.home;
  const addMoneyCopy = portfolioCopy.addMoney;
  const overview = reads.portfolioOverview(wallet, updatedAt);
  const earnUnconfirmed = earn === null || archivedHeld.earnUnknown;
  const earnHeld = typeof earn === "number" && earn > 0;
  const empty =
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
    usdc > 0
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
    target: usdc > 0 ? { to: "fund" } : { to: "addMoney" },
  };
  const archived = reads.archivedPortfolios(wallet);

  return {
    total: totalOf(overview, empty, earn),
    showArc: overview.valued && overview.total + (earn ?? 0) > 0,
    cash: { label: home.readyToInvest, value: usd(overview.cash) },
    earning:
      earn === undefined
        ? null
        : { label: home.earning, value: earn === null ? commonCopy.unavailable : usd(earn) },
    empty,
    waiting,
    primary: empty
      ? { label: home.addMoney, target: { to: "addMoney" } }
      : { label: home.findTrackers, target: { to: "markets" } },
    secondary: empty ? null : addMoney,
    actionsQuiet: waiting?.action != null,
    explanation: empty ? home.moneyArrives : null,
    portfolios: overview.portfolios.map((portfolio) =>
      portfolioRowView(reads, portfolio, updatedAt),
    ),
    archived: {
      heading: home.archivedCount(archived.length),
      rows: archived.map((portfolio) => portfolioRowView(reads, portfolio, updatedAt)),
    },
    investments: investments(reads, overview.positions, updatedAt),
    recent: recentActivity(reads, wallet, RECENT_ROWS),
  };
}
