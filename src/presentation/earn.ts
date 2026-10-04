import { EARN_CASH_DECIMALS, type EarnAction, type EarnDraft } from "../application/earn.js";
import { commonCopy } from "../copy/common.js";
import { earnCopy as copy, mobileEarnCopy } from "../copy/earn.js";
import { errorsCopy } from "../copy/errors.js";
import { networkCostCopy } from "../copy/networkCost.js";
import { portfolioCopy } from "../copy/portfolio.js";
import { smallestAmount } from "../domain/amount.js";
import type { AppPlatform } from "../domain/appPlatform.js";
import { symbolAmount, usd } from "../domain/format.js";
import type { ReadFreshness } from "../domain/freshness.js";
import type { NetworkCost } from "../domain/networkCost.js";
import { balancesView, type Figure, type UnavailableView } from "./freshness.js";
import { networkCostView, type NetworkCostView } from "./networkCost.js";

export type EarnRateRead = { apy: number; supplyApy: number; rewardsApy: number };
type Rate = EarnRateRead;
export type EarnPositionRead = { deposited: number; earnedSinceDeposit: number | null };
type Position = EarnPositionRead;

const CASH = "USDC";

export type EarnSheetState = {
  action: EarnAction;
  draft: EarnDraft;
  portfolioLabel: string;
  archived: boolean;
  /** Whether Earn is offered on this network. */
  available: boolean;
  /** Whether the portfolio's position and the action's needs have been read. */
  positionKnown: boolean;
  needsKnown: boolean;
  apy: number | undefined;
  cost: NetworkCost | null;
  pending: { blocked: boolean };
  busy: boolean;
  /** How current the app's balance read is: nothing is confirmed against a balance never read. */
  balances: ReadFreshness;
};

type EarnSheetView = {
  title: string;
  lead: string;
  amountLabel: string;
  /** The most that can move. Null until balances have been read once. */
  available: Figure;
  /** Why nothing can be confirmed while balances have never loaded. */
  balanceUnavailable: string | null;
  estimate: string | null;
  mainnetOnly: string | null;
  networkCostLine: string | null;
  networkCost: NetworkCostView | null;
  beforeDeposit: { title: string; body: string } | null;
  confirm: { label: string; disabled: boolean };
};

/** The Earn deposit or withdrawal review, and whether it can be confirmed. */
export function earnSheetView(state: EarnSheetState): EarnSheetView {
  const { action, draft, apy, cost } = state;
  const depositing = action === "deposit";
  const networkCost = networkCostView({
    cost,
    pending: state.pending,
    submitting: state.busy,
    withdrawing: !depositing,
  });
  const showsCost = state.available && cost !== null;
  const balances = balancesView(state.balances);
  return {
    title: copy.sheetTitle(action, state.portfolioLabel),
    lead: copy.sheetLead(action),
    amountLabel: copy.amountLabel,
    available: balances.known ? commonCopy.available(usd(draft.max)) : null,
    balanceUnavailable: balances.reason,
    estimate:
      depositing && draft.valid && apy !== undefined
        ? copy.yearEstimate(usd((draft.amount * apy) / 100), apy.toFixed(2))
        : null,
    mainnetOnly: state.available ? null : copy.mainnetOnly,
    networkCostLine: showsCost ? networkCostCopy.line(networkCost.value) : null,
    networkCost: showsCost ? networkCost : null,
    beforeDeposit: depositing ? { title: copy.beforeDepositTitle, body: copy.beforeDeposit } : null,
    confirm: {
      label: state.busy ? copy.submitting : copy.confirm(action),
      disabled:
        !draft.valid ||
        state.archived ||
        !state.available ||
        !state.positionKnown ||
        !state.needsKnown ||
        !balances.known ||
        networkCost.confirmDisabled,
    },
  };
}

type EarnPortfolioView = {
  /** Null until balances have been read once. */
  cash: Figure;
  cashAvailable: Figure;
  inEarn: string;
  earned: string;
  /** Only once the venue has reported it. */
  earnedLine: string | null;
  archived: string | null;
  restore: string | null;
  canDeposit: boolean;
  canWithdraw: boolean;
};

/** One portfolio's row on the Earn screen. */
export function earnPortfolioView(state: {
  archived: boolean;
  available: boolean;
  cash: number;
  position: Position | null;
  /** How current the app's balance read is: the cash is a figure only once it has been read. */
  balances: ReadFreshness;
}): EarnPortfolioView {
  const { archived, available, cash, position } = state;
  const earned = position?.earnedSinceDeposit;
  const hasEarned = earned !== null && earned !== undefined;
  const { known } = balancesView(state.balances);
  return {
    cash: known ? usd(cash) : null,
    cashAvailable: known ? commonCopy.readyToInvest(usd(cash)) : null,
    inEarn: position ? usd(position.deposited) : commonCopy.unavailable,
    earned: hasEarned ? usd(earned) : commonCopy.unavailable,
    earnedLine: hasEarned ? copy.earnedSinceDeposit(usd(earned)) : null,
    archived: archived ? commonCopy.archived : null,
    restore: archived ? copy.restoreToMove : null,
    canDeposit: known && !archived && available && position !== null && cash > 0,
    canWithdraw: known && !archived && available && !!position?.deposited,
  };
}

type EarnSummaryView = {
  apy: string;
  supplyApy: string;
  rewardsApy: string;
  total: string;
  couldEarn: string;
  breakdown: string | null;
};

/** The rate and the total at the top of the Earn screen. */
export function earnSummaryView(state: {
  available: boolean;
  rate: Rate | null;
  /** What each portfolio has in Earn, null where it could not be read. */
  deposits: readonly (number | null | undefined)[];
}): EarnSummaryView {
  const { rate } = state;
  const percent = (value: number) => copy.percent(value.toFixed(2));
  const allRead = state.deposits.every((deposit) => deposit !== null && deposit !== undefined);
  return {
    apy: state.available && rate ? percent(rate.apy) : commonCopy.unavailable,
    supplyApy: rate ? percent(rate.supplyApy) : commonCopy.unavailable,
    rewardsApy: rate ? percent(rate.rewardsApy) : commonCopy.unavailable,
    total: allRead
      ? usd(state.deposits.reduce<number>((sum, deposit) => sum + (deposit ?? 0), 0))
      : commonCopy.unavailable,
    couldEarn: rate ? copy.couldEarn(rate.apy.toFixed(2)) : copy.noRate,
    breakdown: rate
      ? copy.rateBreakdown(rate.supplyApy.toFixed(2), rate.rewardsApy.toFixed(2))
      : null,
  };
}

/** One portfolio as the Earn screens read it. */
export type EarnPortfolio = {
  id: string;
  label: string;
  archived: boolean;
  cash: number;
  /** Undefined while it is read, null when it could not be. */
  position: EarnPositionRead | null | undefined;
};

export type EarnRowView = {
  id: string;
  label: string;
  /** What is ready to invest. Null until balances have been read once. */
  cash: Figure;
  inEarn: string | null;
  earned: string | null;
  archived: string | null;
  restore: string | null;
  announcement: string;
  /** What choosing the row opens, or null when it cannot be chosen. */
  opens: EarnAction | null;
};

export type EarnScreenView = {
  /** "Earn", and nothing else: the header names no one. */
  title: string;
  /**
   * Earn does not run on this network. The one line the screen shows, at
   * the top; the rate, the actions, the total and the rows are all left out.
   */
  notHere: string | null;
  /** Balances have never been read, and nothing has failed: the screen waits. */
  loading: boolean;
  /**
   * Balances have never been read and the read failed: the one line, with
   * its retry. Nothing can be added or withdrawn until they load.
   */
  unavailable: UnavailableView | null;
  rateLabel: string;
  /** Null while the rate is read, and where Earn does not run. */
  rate: { value: string; unavailable: boolean; announcement: string } | null;
  couldEarn: string | null;
  breakdown: string | null;
  /** "Add to Earn". Null where Earn does not run. */
  deposit: { label: string; disabled: boolean; reason: string | null } | null;
  withdraw: { label: string; disabled: boolean } | null;
  portfoliosTitle: string;
  inEarn: string;
  /** What every portfolio has in Earn together, or "Unavailable" until each has been read. Null where Earn does not run. */
  total: { label: string; value: string } | null;
  rows: readonly EarnRowView[];
  riskLine: string;
  readRisks: string;
  /** Behind "Read the risks": the lending risks, and who the USDC is lent through, named once. */
  risks: { title: string; lines: string[] };
  empty: { title: string; detail: string; action: string } | null;
};

const lent = (portfolio: EarnPortfolio) => portfolio.position?.deposited ?? 0;

/** Whether `portfolio` can be chosen for `action`. */
export function earnQualifies(portfolio: EarnPortfolio, action: EarnAction): boolean {
  if (portfolio.archived || !portfolio.position) return false;
  return action === "deposit" ? portfolio.cash > 0 : portfolio.position.deposited > 0;
}

/** The Earn screen: the rate, what each portfolio has in it, and whether anything can move. */
export function earnScreenView(state: {
  available: boolean;
  online: boolean;
  venue: string;
  /** Undefined while it is read, null when it could not be. */
  rate: EarnRateRead | null | undefined;
  portfolios: readonly EarnPortfolio[];
  platform: AppPlatform;
  /** How current the app's balance read is. */
  balances: ReadFreshness;
}): EarnScreenView {
  const { available, online, rate, portfolios } = state;
  const balances = balancesView(state.balances);
  const mobile = state.platform === "mobile";
  const summary = earnSummaryView({
    available,
    rate: rate ?? null,
    deposits: portfolios.map((portfolio) => portfolio.position?.deposited ?? null),
  });
  const live = available && rate;
  const reading = rate === undefined && available;
  const anyCash = portfolios.some((portfolio) => earnQualifies(portfolio, "deposit"));
  const anyLent = portfolios.some((portfolio) => lent(portfolio) > 0);
  const inert = !online || !available || !balances.known;
  const restore = mobile ? mobileEarnCopy.restore : copy.restoreToMove;
  const rateLabel = mobile ? mobileEarnCopy.rateLabel : copy.currentApy;
  const risks = {
    title: copy.readRisks,
    lines: [copy.risksShort, copy.venueLine(state.venue)],
  };
  if (!available) {
    return {
      title: copy.title,
      notHere: copy.mainnetOnly,
      loading: false,
      unavailable: null,
      rateLabel,
      rate: null,
      couldEarn: null,
      breakdown: null,
      deposit: null,
      withdraw: null,
      portfoliosTitle: copy.portfolios,
      inEarn: copy.inEarn,
      total: null,
      rows: [],
      riskLine: copy.riskLine,
      readRisks: copy.readRisks,
      risks,
      empty: null,
    };
  }
  return {
    title: copy.title,
    notHere: null,
    loading: balances.loading,
    unavailable: balances.unavailable,
    rateLabel,
    rate: reading
      ? null
      : {
          value: summary.apy,
          unavailable: !live,
          announcement: live ? copy.rateAnnouncement(rate.apy.toFixed(2)) : summary.apy,
        },
    couldEarn: reading ? null : live ? summary.couldEarn : copy.noRate,
    breakdown: live ? summary.breakdown : null,
    deposit: {
      label: copy.deposit,
      disabled: inert || !anyCash,
      // "Move money in first" is a claim about the cash: said only once the cash is known.
      reason: !balances.known ? balances.reason : anyCash ? null : copy.noMoney,
    },
    withdraw: anyLent ? { label: copy.withdraw, disabled: inert } : null,
    portfoliosTitle: copy.portfolios,
    inEarn: copy.inEarn,
    total: { label: copy.totalInEarn, value: summary.total },
    rows: portfolios.map((portfolio) => {
      const row = earnPortfolioView({
        archived: portfolio.archived,
        available,
        cash: portfolio.cash,
        position: portfolio.position ?? null,
        balances: state.balances,
      });
      const inEarn = portfolio.position === undefined ? null : row.inEarn;
      const opens = earnQualifies(portfolio, "deposit")
        ? "deposit"
        : earnQualifies(portfolio, "withdraw")
          ? "withdraw"
          : null;
      return {
        id: portfolio.id,
        label: portfolio.label,
        cash: row.cashAvailable,
        inEarn,
        earned: row.earnedLine,
        archived: portfolio.archived ? commonCopy.archived : null,
        restore: portfolio.archived ? restore : null,
        announcement: [
          portfolio.label,
          ...(row.cashAvailable === null ? [] : [row.cashAvailable]),
          `${inEarn ?? commonCopy.checking} ${copy.inEarn}`,
        ].join(", "),
        opens: inert ? null : opens,
      };
    }),
    riskLine: copy.riskLine,
    readRisks: copy.readRisks,
    risks,
    empty:
      portfolios.length === 0
        ? {
            title: copy.noPortfolio,
            detail: copy.noPortfolioDetail,
            action: portfolioCopy.home.newPortfolio,
          }
        : null,
  };
}

/** The first step of a deposit or a withdrawal: the portfolios that can take it. */
export function earnChoiceView(
  action: EarnAction,
  portfolios: readonly EarnPortfolio[],
  chosen: string | null,
) {
  const choosable = portfolios.filter((portfolio) => earnQualifies(portfolio, action));
  const picked = choosable.find((portfolio) => portfolio.id === chosen);
  return {
    title: action === "deposit" ? copy.deposit : copy.withdraw,
    rows: choosable.map((portfolio) => ({
      id: portfolio.id,
      label: portfolio.label,
      detail:
        action === "deposit"
          ? copy.ready(usd(portfolio.cash))
          : copy.lent(usd(portfolio.position?.deposited ?? 0)),
    })),
    next: {
      label: picked ? copy.continueWith(picked.label) : commonCopy.continue,
      disabled: !picked,
    },
  };
}

const feeOf = (cost: NetworkCost | null) => (cost?.kind === "relayer" ? cost.fee : 0);

/** How much: with the most this portfolio can really move, and what is wrong with what was typed. */
export function earnAmountView(state: {
  action: EarnAction;
  draft: EarnDraft;
  portfolioLabel: string;
  amountText: string;
  /** Null while the network cost is worked out. */
  cost: NetworkCost | null;
  apy: number | undefined;
  online: boolean;
}) {
  const { action, draft, cost } = state;
  const typed = state.amountText.trim() !== "";
  const tooSmall =
    action === "withdraw" && draft.valid && cost !== null && draft.amount <= feeOf(cost);
  const validation = !typed
    ? null
    : draft.tooPrecise
      ? commonCopy.tooPrecise(`${smallestAmount(EARN_CASH_DECIMALS)} ${CASH}`)
      : !Number.isFinite(draft.amount) || draft.amount <= 0
        ? errorsCopy.amountAboveZero
        : draft.amount > draft.max
          ? copy.moreThanAvailable
          : tooSmall
            ? copy.smallerThanCost
            : null;
  return {
    lead: copy.leadFor[action](state.portfolioLabel),
    amountLabel: copy.amountLabel,
    placeholder: commonCopy.amountPlaceholder,
    max: commonCopy.max,
    available: { label: copy.available, value: symbolAmount(CASH, draft.max) },
    estimate:
      action === "deposit" && draft.valid && state.apy !== undefined
        ? copy.yearEstimate(usd((draft.amount * state.apy) / 100), state.apy.toFixed(2))
        : null,
    validation,
    review: {
      label: cost === null ? commonCopy.checking : copy.review,
      disabled: cost === null || !draft.valid || tooSmall || !state.online,
    },
  };
}

/** The amount "Max" fills: exactly the maximum. */
export const earnMaxText = (draft: EarnDraft) => String(draft.max);

/**
 * The review of a deposit or a withdrawal before it is confirmed: what
 * leaves where, what arrives where, the network cost and its reasons, and
 * whether Confirm can be pressed. A step of its own, separate from
 * `earnSheetView`, so a screen that reviews in the same step it asks for the
 * amount is unchanged.
 */
export function earnReviewView(state: {
  action: EarnAction;
  amount: number;
  portfolioLabel: string;
  cost: NetworkCost;
  pending: { blocked: boolean };
  online: boolean;
  /**
   * What the last attempt answered, with the action and the amount it was
   * for. It is shown only on a review of that same action and amount: once
   * either changes, it was about another review and is gone.
   */
  failure?: { text: string; action: EarnAction; amount: number } | null;
}) {
  const { action, amount, portfolioLabel, cost, failure } = state;
  const depositing = action === "deposit";
  const network = networkCostView({
    cost,
    pending: state.pending,
    submitting: false,
    withdrawing: !depositing,
  });
  const fee = feeOf(cost);
  const figure = (value: number) => symbolAmount(CASH, value);
  return {
    title: copy.reviewTitle,
    terms: depositing
      ? [
          { label: copy.terms.leaves(portfolioLabel), value: figure(amount) },
          { label: copy.terms.intoEarn, value: figure(amount) },
          { label: network.label, value: network.value },
        ]
      : [
          { label: copy.terms.leavesEarn, value: figure(amount) },
          { label: network.label, value: network.value },
        ],
    total: depositing
      ? { label: copy.terms.totalLeaving(portfolioLabel), value: figure(amount + fee) }
      : { label: copy.terms.arrives(portfolioLabel), value: figure(amount - fee) },
    reasons: [
      ...(cost.kind === "relayer" && cost.opens ? [copy.openingReason] : []),
      ...(!depositing && cost.kind === "relayer" ? [copy.fromProceeds] : []),
    ],
    notNow:
      network.tone === "warning" && network.explanation.length > 0 ? network.explanation[0] : null,
    needsCash: network.moveMoney
      ? { text: network.moveMoney.before.trim(), action: network.moveMoney.link }
      : null,
    risk: depositing ? { line: copy.depositRisk, link: copy.readRisks } : null,
    error: failure && failure.action === action && failure.amount === amount ? failure.text : null,
    confirm: {
      label: copy.confirmAmount[action](figure(amount)),
      disabled: network.confirmDisabled || !state.online,
    },
  };
}

/** The steps of a deposit or a withdrawal under way. */
export function earnProgressView(action: EarnAction, amount: number) {
  const [sending, confirming, reading] = copy.steps;
  return {
    title: copy.progress[action](symbolAmount(CASH, amount)),
    steps: [
      { key: "send", title: sending, status: "current" as const },
      { key: "confirm", title: confirming, status: "waiting" as const },
      { key: "read", title: reading, status: "waiting" as const },
    ],
  };
}

/** How it ended. A withdrawal states what arrived after its cost. */
export function earnResultView(state: {
  action: EarnAction;
  outcome: "landed" | "unknown";
  amount: number;
  fee: number;
  portfolioLabel: string;
  /** It landed, and the new balances could not be read back yet. */
  balancesUnread?: boolean;
}) {
  const { action, portfolioLabel } = state;
  if (state.outcome === "unknown") {
    return {
      title: copy.unknownTitle,
      body: copy.unknownBody(portfolioLabel),
      close: commonCopy.close,
    };
  }
  const moved = action === "deposit" ? state.amount : state.amount - state.fee;
  return {
    title: copy.landed[action](symbolAmount(CASH, moved)),
    body: state.balancesUnread
      ? `${copy.landedBody[action](portfolioLabel)} ${commonCopy.balancesUpdateShortly}`
      : copy.landedBody[action](portfolioLabel),
    close: commonCopy.done,
  };
}
