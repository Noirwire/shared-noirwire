import type { FundingDraft } from "../application/funding.js";
import { commonCopy } from "../copy/common.js";
import { fundingCopy as copy, mobileFundingCopy as mobileCopy } from "../copy/funding.js";
import { smallestAmount } from "../domain/amount.js";
import type { AppPlatform } from "../domain/appPlatform.js";
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

/** The chips under the amount on the phone, in USDC. */
export const FUND_PRESETS = [10, 25, 50, 100] as const;

type Term = { label: string; value: string };

/** What a private transfer of `amount` takes, term by term, in the platform's words. */
function privateTerms(
  draft: FundingDraft,
  asset: string,
  amount: number,
  portfolioLabel: string,
  platform: AppPlatform,
  figure: (asset: string, amount: number) => string,
): { terms: Term[]; total: Term } {
  const costs = draft.costsOf(amount);
  const mobile = platform === "mobile";
  const words = mobile ? { ...copy.terms, ...mobileCopy.terms } : copy.terms;
  const fee = (value: number) => (mobile ? `+ ${figure(asset, value)}` : figure(asset, value));
  return {
    terms: [
      { label: words.arrives(portfolioLabel), value: figure(asset, amount) },
      { label: words.privacyFee(PRIVACY_FEE_PERCENT), value: fee(costs.privacyFee) },
      { label: words.relayFee, value: fee(costs.relayFee) },
    ],
    total: {
      label: mobile ? mobileCopy.terms.leaves : copy.terms.total,
      value: figure(asset, costs.total),
    },
  };
}

export type FundingAmountState = {
  draft: FundingDraft;
  asset: string;
  privateRoute: boolean;
  /** Null until the funding wallet has been read on opening. */
  fundingBalance: number | null;
  amountText: string;
  /**
   * Whether the person has typed in the amount field yet. False shows no
   * error under it, whatever it holds. Taken as typed when absent.
   */
  touched?: boolean;
  /** The asset's decimals, named in the message for an amount typed with too many. */
  decimals?: number;
  presets: readonly number[];
  pending: { blocked: boolean };
  /** The words of the platform the step is drawn on. The web's when absent. */
  platform?: AppPlatform;
  /** The portfolio the money moves into, named in the phone's lead and terms. */
  portfolioLabel?: string;
  /** Nothing is reviewed while the device is offline. Online when absent. */
  online?: boolean;
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
  /** What the funding wallet holds; its value is null until it has been read. */
  available: { label: string; value: string | null };
  amountLabel: string;
  placeholder: string;
  /** The typed amount, its fees and what leaves the funding wallet. */
  terms: readonly Term[];
  total: Term;
  /** What is wrong with the typed amount, if anything. */
  validation: string | null;
  footer: string;
  /** The phone's notice for an empty funding wallet, with the action that shows its address. */
  emptyNotice: { title: string; detail: string; action: string } | null;
};

/** The first step of moving money in: which asset, how much, and what that costs. */
export function fundingAmountView(state: FundingAmountState): FundingAmountView {
  const { draft, asset, privateRoute } = state;
  const platform = state.platform ?? "web";
  const mobile = platform === "mobile";
  const read = state.fundingBalance !== null;
  const fundingBalance = state.fundingBalance ?? 0;
  const available = symbolAmount(asset, fundingBalance);
  const portfolioLabel = state.portfolioLabel ?? "";
  const typed = Number.isFinite(draft.customAmount) && draft.customAmount > 0;
  const shown = (state.touched ?? true) && state.amountText.trim() !== "";
  const invalid = !shown
    ? null
    : draft.tooPrecise && state.decimals !== undefined
      ? commonCopy.tooPrecise(`${smallestAmount(state.decimals)} ${asset}`)
      : !draft.amountValid
        ? copy.invalidAmount
        : null;
  const unaffordable =
    shown && draft.amountValid && !draft.affordable(draft.customAmount)
      ? draft.customAmount < draft.minimum
        ? copy.belowMinimum(symbolAmount(asset, draft.minimum))
        : copy.overBalance(symbolAmount(asset, draft.leaving(draft.customAmount)))
      : null;
  const empty = read && fundingBalance <= 0;
  const { terms, total } = privateTerms(
    draft,
    asset,
    typed ? draft.customAmount : 0,
    portfolioLabel,
    platform,
    symbolAmount,
  );
  return {
    lead: mobile
      ? mobileCopy.lead(portfolioLabel)
      : privateRoute
        ? copy.leadPrivate(asset, available)
        : copy.leadPublic(asset, available),
    noPrivateRoute: privateRoute ? null : copy.noPrivateRoute(asset),
    presets: state.presets.map((value) => ({
      value,
      label: mobile ? String(value) : symbolAmount(asset, value),
      disabled: !draft.affordable(value) || !read,
    })),
    otherAmount: copy.otherAmount(asset),
    next: {
      label: mobile ? mobileCopy.review : commonCopy.continue,
      disabled: !draft.canFund || state.pending.blocked || !(state.online ?? true) || !read,
    },
    invalid,
    unaffordable,
    empty: empty
      ? { before: copy.emptyBefore(asset), link: copy.depositLink, after: copy.emptyAfter }
      : null,
    costs: !privateRoute
      ? null
      : mobile
        ? mobileCopy.costs(symbolAmount(asset, draft.minimum))
        : copy.privateCosts(
            PRIVACY_FEE_PERCENT,
            symbolAmount(asset, draft.costsOf(0).relayFee),
            asset,
            symbolAmount(asset, draft.minimum),
          ),
    available: {
      label: mobileCopy.available,
      value: read ? available : null,
    },
    amountLabel: mobile ? mobileCopy.amountLabel : copy.otherAmount(asset),
    placeholder: commonCopy.amountPlaceholder,
    terms,
    total,
    validation: invalid ?? unaffordable,
    footer: mobile ? mobileCopy.footer : fundingFooter(privateRoute),
    emptyNotice:
      mobile && empty
        ? {
            title: mobileCopy.empty,
            detail: mobileCopy.emptyDetail,
            action: mobileCopy.showAddress,
          }
        : null,
  };
}

export type FundingReviewView = {
  title: string;
  lead: string;
  /** What arrives and each fee. */
  terms: readonly Term[];
  /** Everything that leaves the funding wallet, to the token's last non-zero decimal. */
  total: Term;
  /** How a screen reader says the total: "Leaves your funding wallet, 100 point 30 USDC". */
  totalSpoken: string;
  /** What happens if the transfer would take more than the total. */
  note: string;
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
  /** The words of the platform the step is drawn on. The web's when absent. */
  platform?: AppPlatform;
  /** Nothing is confirmed while the device is offline. Online when absent. */
  online?: boolean;
}): FundingReviewView {
  const { asset, amount } = state;
  const mobile = state.platform === "mobile";
  const { terms, total } = privateTerms(
    state.draft,
    asset,
    amount,
    state.portfolioLabel,
    "web",
    exactAmount,
  );
  return {
    title: mobile ? mobileCopy.reviewTitle : copy.titlePrivate,
    lead: copy.reviewLead(state.portfolioLabel),
    terms,
    total,
    totalSpoken: mobileCopy.totalSpoken(total.label, total.value),
    note: mobile ? mobileCopy.notSignedAbove : copy.noSolNeeded,
    back: commonCopy.back,
    confirm: {
      label: commonCopy.confirm,
      disabled: state.pending.blocked || !(state.online ?? true),
    },
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
  /** Said once a transfer takes longer than it usually does. */
  stillWorking: string | null;
};

/** The phone's names for the stages, which say where the money is rather than what the code does. */
function mobileStages(portfolioLabel: string) {
  const [sent, queue, arrived] = mobileCopy.stages;
  return [
    { title: sent.title, detail: sent.caption },
    {
      title: queue.title,
      detail: queue.caption(SETTLEMENT_DELAY_MS.min / 1000, SETTLEMENT_DELAY_MS.max / 1000),
    },
    { title: arrived.title(portfolioLabel), detail: arrived.caption },
  ];
}

/** Each stage of a transfer under way, by how many have completed. */
export function fundingProgressView(state: {
  asset: string;
  amount: number;
  portfolioLabel: string;
  completed: number;
  /** The words of the platform the step is drawn on. The web's when absent. */
  platform?: AppPlatform;
  /** Whether it has taken longer than a transfer usually does. */
  slow?: boolean;
}): FundingProgressView {
  const stages = state.platform === "mobile" ? mobileStages(state.portfolioLabel) : PRIVATE_STAGES;
  return {
    title: copy.moving(symbolAmount(state.asset, state.amount), state.portfolioLabel),
    stages: stages.map((stage, index) => ({
      ...stage,
      status: stageStatus(index, state.completed),
    })),
    stillWorking: state.slow ? mobileCopy.stillWorking : null,
  };
}

type FundingOutcomeView = {
  title: string;
  body: string;
  /** The link to what an outside observer can see of the portfolio now. */
  observerLink: string | null;
  close: string;
  alert: boolean;
  tone: "success" | "warning";
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
  /** The money moved, and the portfolio's balance could not be read back yet. */
  balancesUnread?: boolean;
  /** The words of the platform the step is drawn on. The web's when absent. */
  platform?: AppPlatform;
}): FundingOutcomeView {
  const { asset, portfolioLabel } = state;
  const mobile = state.platform === "mobile";
  switch (state.outcome) {
    case "done":
      return {
        title: copy.arrivedTitle,
        body: `${(state.balancesUnread ? copy.movedUnread : mobile ? mobileCopy.arrived : copy.arrived)(symbolAmount(asset, state.balancesUnread ? state.amount : state.arrived), portfolioLabel)}${
          state.privateRoute && state.fee > 0 ? copy.feesCharged(exactAmount(asset, state.fee)) : ""
        }`,
        observerLink: !state.privateRoute
          ? null
          : mobile
            ? mobileCopy.seePublicView
            : copy.observerLink,
        close: commonCopy.done,
        alert: false,
        tone: "success",
      };
    case "unknown":
      return {
        title: copy.unknownTitle,
        body: copy.unknown(symbolAmount(asset, state.amount), asset, portfolioLabel),
        observerLink: null,
        close: commonCopy.close,
        alert: true,
        tone: "warning",
      };
    case "pending":
      return {
        title: copy.settlingTitle,
        body: copy.settling,
        observerLink: null,
        close: commonCopy.close,
        alert: false,
        tone: "warning",
      };
  }
}

/** What the footer says the route does and does not hide. */
export function fundingFooter(privateRoute: boolean): string {
  return privateRoute ? copy.footerPrivate : copy.footerPublic;
}

export type ChoosePortfolioView = {
  title: string;
  rows: readonly { id: string; label: string; cash: string }[];
  next: { label: string; disabled: boolean };
};

/** The step before the amount, when moving money in starts with more than one portfolio to fund. */
export function choosePortfolioView(state: {
  portfolios: readonly { id: string; label: string; cash: number }[];
  chosen: string | null;
}): ChoosePortfolioView {
  const chosen = state.portfolios.find((portfolio) => portfolio.id === state.chosen);
  return {
    title: mobileCopy.chooseTitle,
    rows: state.portfolios.map((portfolio) => ({
      id: portfolio.id,
      label: portfolio.label,
      cash: mobileCopy.cash(symbolAmount("USDC", portfolio.cash)),
    })),
    next: {
      label: chosen ? mobileCopy.continueWith(chosen.label) : commonCopy.continue,
      disabled: !chosen,
    },
  };
}

/** The funding wallet's row in Settings: its cash as stored, or nothing until it has been read. */
export function fundingWalletRow(balance: number | undefined) {
  return {
    section: mobileCopy.settingsSection,
    label: mobileCopy.settingsRow,
    value: balance === undefined ? undefined : symbolAmount("USDC", balance),
  };
}

/** The funding wallet's own page: what is waiting to be moved, and where to send more. */
export function fundingWalletView(state: {
  /** Null until the first read on opening has answered. */
  balance: number | null;
  readFailed: boolean;
}) {
  const page = mobileCopy.page;
  const { balance } = state;
  const empty = balance !== null && balance <= 0;
  const shown = balance === null ? null : symbolAmount("USDC", balance);
  return {
    title: page.title,
    waiting: page.waiting,
    balance: shown,
    balanceLabel: shown === null ? null : page.balanceLabel(shown),
    lead: empty ? page.empty : page.lead,
    readFailed: state.readFailed ? page.readFailed : null,
    move: { label: page.move, quiet: empty, disabled: empty || balance === null },
    showAddress: page.showAddress,
  };
}
