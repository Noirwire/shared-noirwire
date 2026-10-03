import type { EarnAction, EarnDraft } from "../application/earn.js";
import { commonCopy } from "../copy/common.js";
import { earnCopy as copy } from "../copy/earn.js";
import { networkCostCopy } from "../copy/networkCost.js";
import { usd } from "../domain/format.js";
import type { NetworkCost } from "../domain/networkCost.js";
import { networkCostView, type NetworkCostView } from "./networkCost.js";

type Rate = { apy: number; supplyApy: number; rewardsApy: number };
type Position = { deposited: number; earnedSinceDeposit: number | null };

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
  venue: string;
  apy: number | undefined;
  cost: NetworkCost | null;
  pending: { blocked: boolean };
  busy: boolean;
};

type EarnSheetView = {
  title: string;
  lead: string;
  amountLabel: string;
  available: string;
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
  return {
    title: copy.sheetTitle(action, state.portfolioLabel),
    lead: copy.sheetLead(action),
    amountLabel: copy.amountLabel,
    available: commonCopy.available(usd(draft.max)),
    estimate:
      depositing && draft.valid && apy !== undefined
        ? copy.yearEstimate(usd((draft.amount * apy) / 100), apy.toFixed(2))
        : null,
    mainnetOnly: state.available ? null : copy.mainnetOnly,
    networkCostLine: showsCost ? networkCostCopy.line(networkCost.value) : null,
    networkCost: showsCost ? networkCost : null,
    beforeDeposit: depositing
      ? { title: copy.beforeDepositTitle, body: copy.beforeDeposit(state.venue) }
      : null,
    confirm: {
      label: state.busy ? copy.submitting : copy.confirm(action),
      disabled:
        !draft.valid ||
        state.archived ||
        !state.available ||
        !state.positionKnown ||
        !state.needsKnown ||
        networkCost.confirmDisabled,
    },
  };
}

type EarnPortfolioView = {
  cash: string;
  cashAvailable: string;
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
}): EarnPortfolioView {
  const { archived, available, cash, position } = state;
  const earned = position?.earnedSinceDeposit;
  const hasEarned = earned !== null && earned !== undefined;
  return {
    cash: usd(cash),
    cashAvailable: commonCopy.cashAvailable(usd(cash)),
    inEarn: position ? usd(position.deposited) : commonCopy.unavailable,
    earned: hasEarned ? usd(earned) : commonCopy.unavailable,
    earnedLine: hasEarned ? copy.earnedSinceDeposit(usd(earned)) : null,
    archived: archived ? commonCopy.archived : null,
    restore: archived ? copy.restoreToMove : null,
    canDeposit: !archived && available && position !== null && cash > 0,
    canWithdraw: !archived && available && !!position?.deposited,
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
