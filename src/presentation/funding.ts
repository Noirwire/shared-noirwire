import type { FundingDraft } from "../application/funding.js";
import { commonCopy } from "../copy/common.js";
import { fundingCopy as copy } from "../copy/funding.js";
import { symbolAmount } from "../domain/format.js";
import { PRIVACY_FEE_BPS, SETTLEMENT_DELAY_MS } from "../domain/privateTransfer.js";

/** A fee down to the token's last decimal: the review states what leaves exactly, not rounded to cents. */
function exactAmount(asset: string, amount: number): string {
  return `${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ${asset}`;
}

const PRIVACY_FEE_PERCENT = PRIVACY_FEE_BPS / 100;

/** The dialog's title follows the asset: only the private route may be called private. */
export function fundingTitle(asset: string, privateRoute: boolean): string {
  return privateRoute ? copy.titlePrivate : copy.titlePublic(asset);
}

/** What happens to a private transfer, step by step, as the progress screen lists it. */
export const PRIVATE_STAGES: readonly { title: string; detail: string }[] = [
  copy.stages.enqueue,
  {
    title: copy.stages.settle.title,
    detail: copy.stages.settle.detail(
      SETTLEMENT_DELAY_MS.min / 1000,
      SETTLEMENT_DELAY_MS.max / 1000,
    ),
  },
  copy.stages.arrive,
];

export type FundingAmountState = {
  draft: FundingDraft;
  asset: string;
  privateRoute: boolean;
  fundingBalance: number;
  amountText: string;
  presets: readonly number[];
  pending: { blocked: boolean };
};

export type FundingAmountView = {
  lead: string;
  noPrivateRoute: string | null;
  presets: readonly { value: number; label: string; disabled: boolean }[];
  otherAmount: string;
  next: { label: string; disabled: boolean };
  invalid: string | null;
  unaffordable: string | null;
  empty: { before: string; link: string; after: string } | null;
  costs: string | null;
};

/** The first step of moving money in: which asset, how much, and what that costs. */
export function fundingAmountView(state: FundingAmountState): FundingAmountView {
  const { draft, asset, privateRoute, fundingBalance } = state;
  const available = symbolAmount(asset, fundingBalance);
  return {
    lead: privateRoute ? copy.leadPrivate(asset, available) : copy.leadPublic(asset, available),
    noPrivateRoute: privateRoute ? null : copy.noPrivateRoute(asset),
    presets: state.presets.map((value) => ({
      value,
      label: symbolAmount(asset, value),
      disabled: !draft.affordable(value),
    })),
    otherAmount: copy.otherAmount(asset),
    next: { label: commonCopy.continue, disabled: !draft.canFund || state.pending.blocked },
    invalid: state.amountText.trim() !== "" && !draft.amountValid ? copy.invalidAmount : null,
    unaffordable:
      draft.amountValid && !draft.affordable(draft.customAmount)
        ? draft.customAmount < draft.minimum
          ? copy.belowMinimum(symbolAmount(asset, draft.minimum))
          : copy.overBalance(symbolAmount(asset, draft.leaving(draft.customAmount)))
        : null,
    empty:
      fundingBalance <= 0
        ? { before: copy.emptyBefore(asset), link: copy.depositLink, after: copy.emptyAfter }
        : null,
    costs: privateRoute
      ? copy.privateCosts(
          PRIVACY_FEE_PERCENT,
          symbolAmount(asset, draft.costsOf(0).relayFee),
          asset,
          symbolAmount(asset, draft.minimum),
        )
      : null,
  };
}

export type FundingReviewView = {
  lead: string;
  terms: readonly { label: string; value: string }[];
  noSolNeeded: string;
  back: string;
  confirm: { label: string; disabled: boolean };
};

/** The review of a private transfer: everything that leaves the funding wallet. */
export function fundingReviewView(state: {
  draft: FundingDraft;
  asset: string;
  amount: number;
  portfolioLabel: string;
  pending: { blocked: boolean };
}): FundingReviewView {
  const { asset, amount } = state;
  const costs = state.draft.costsOf(amount);
  return {
    lead: copy.reviewLead(state.portfolioLabel),
    terms: [
      { label: copy.terms.arrives(state.portfolioLabel), value: exactAmount(asset, amount) },
      {
        label: copy.terms.privacyFee(PRIVACY_FEE_PERCENT),
        value: exactAmount(asset, costs.privacyFee),
      },
      { label: copy.terms.relayFee, value: exactAmount(asset, costs.relayFee) },
      { label: copy.terms.total, value: exactAmount(asset, costs.total) },
    ],
    noSolNeeded: copy.noSolNeeded,
    back: commonCopy.back,
    confirm: { label: commonCopy.confirm, disabled: state.pending.blocked },
  };
}

export type StageStatus = "pending" | "running" | "done";

function stageStatus(index: number, completed: number): StageStatus {
  if (index < completed) return "done";
  return index === completed ? "running" : "pending";
}

export type FundingProgressView = {
  title: string;
  stages: readonly { title: string; detail: string; status: StageStatus }[];
};

/** Each stage of a transfer under way, by how many have completed. */
export function fundingProgressView(state: {
  asset: string;
  amount: number;
  portfolioLabel: string;
  completed: number;
}): FundingProgressView {
  return {
    title: copy.moving(symbolAmount(state.asset, state.amount), state.portfolioLabel),
    stages: PRIVATE_STAGES.map((stage, index) => ({
      ...stage,
      status: stageStatus(index, state.completed),
    })),
  };
}

type FundingOutcomeView = {
  title: string;
  body: string;
  observerLink: string | null;
  close: string;
  alert: boolean;
};

/** How a move of money ended, as far as this screen can tell. */
export function fundingOutcomeView(state: {
  outcome: "done" | "unknown" | "pending";
  asset: string;
  privateRoute: boolean;
  /** What was asked to move. */
  amount: number;
  /** What was read back as arrived. */
  arrived: number;
  /** The fees a private transfer charged on top. */
  fee: number;
  portfolioLabel: string;
}): FundingOutcomeView {
  const { asset, portfolioLabel } = state;
  switch (state.outcome) {
    case "done":
      return {
        title: copy.arrivedTitle,
        body: `${copy.arrived(symbolAmount(asset, state.arrived), portfolioLabel)}${
          state.privateRoute && state.fee > 0 ? copy.feesCharged(exactAmount(asset, state.fee)) : ""
        }`,
        observerLink: state.privateRoute ? copy.observerLink : null,
        close: commonCopy.done,
        alert: false,
      };
    case "unknown":
      return {
        title: copy.unknownTitle,
        body: copy.unknown(symbolAmount(asset, state.amount), asset, portfolioLabel),
        observerLink: null,
        close: commonCopy.close,
        alert: true,
      };
    case "pending":
      return {
        title: copy.settlingTitle,
        body: copy.settling,
        observerLink: null,
        close: commonCopy.close,
        alert: false,
      };
  }
}

/** What the footer says the route does and does not hide. */
export function fundingFooter(privateRoute: boolean): string {
  return privateRoute ? copy.footerPrivate : copy.footerPublic;
}
