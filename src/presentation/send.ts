import { FUNDING } from "../application/pendingActions.js";
import type { ScreenReads } from "../application/screenReads.js";
import type { SendDraft } from "../application/send.js";
import { commonCopy } from "../copy/common.js";
import { mobileFundingCopy } from "../copy/funding.js";
import { mobileSendCopy as mobileCopy, sendCopy as copy } from "../copy/send.js";
import { smallestAmount } from "../domain/amount.js";
import type { AppPlatform } from "../domain/appPlatform.js";
import { symbolAmount, usd } from "../domain/format.js";
import type { ReadFreshness } from "../domain/freshness.js";
import type { NetworkCost } from "../domain/networkCost.js";
import type { RecipientClass, Unsendable } from "../domain/recipients.js";
import type { Wallet } from "../domain/wallet.js";
import { balancesView, type Figure } from "./freshness.js";
import { groupsOfFour } from "./importFindings.js";
import { networkCostView, type NetworkCostView } from "./networkCost.js";
import { addressSegments } from "./receive.js";

const CASH = "USDC";

/** A stored amount of `symbol` in shown units, or "Unavailable" while those are not known. */
function amountOf(symbol: string, unitsPerHeld: number | undefined, held: number) {
  return unitsPerHeld === undefined
    ? commonCopy.unavailable
    : symbolAmount(symbol, held * unitsPerHeld);
}

export type SendFormState = {
  /** The asset's decimals, named in the message for an amount typed with too many. */
  decimals?: number;
  draft: SendDraft;
  symbol: string;
  heldRaw: number;
  unitsPerHeld: number | undefined;
  destination: string;
  ownAddress: string;
  offCurve: boolean;
  /** What the address check says about an address no key can sign for. */
  offCurveMessage: string;
  recipientTouched: boolean;
  amountTouched: boolean;
  archived: boolean;
  submitting: boolean;
  preparing: boolean;
  network: string;
  /** The words of the platform the form is drawn on. The web's when absent. */
  platform?: AppPlatform;
  /** Nothing is reviewed while the device is offline. Online when absent. */
  online?: boolean;
  /** Whether pasted text held characters that cannot be part of an address. */
  pastedForeign?: boolean;
  /** What the network said the recipient is, when it cannot receive. */
  unsendable?: Unsendable | null;
  /** The recipient could not be checked with the network. */
  recipientUnreadable?: boolean;
  /** How current the app's balance read is: nothing is sent from a balance never read. */
  balances: ReadFreshness;
  /**
   * Set when the send leaves the main wallet (`sendSourceView` hands it
   * over): the addresses of this wallet's own portfolios, which it reaches
   * through Move to portfolio and never by a send.
   */
  funding?: { ownPortfolios: readonly string[] };
};

type SendFormView = {
  recipientError: string | null;
  /** The amount typed against what is held. Null until balances have been read once. */
  amountLine: Figure;
  /** Why nothing can be reviewed: the token's balance cannot be shown, or balances never loaded. */
  balanceUnavailable: string | null;
  amountError: string | null;
  canReview: boolean;
  reviewLabel: string;
  explainer: string;
  recipientLabel: string;
  recipientPlaceholder: string;
  pasteWarning: string | null;
  /** Why the recipient cannot receive, or could not be checked. */
  refusal: string | null;
  amountLabel: string;
  amountPlaceholder: string;
  /** What is held. Its value is null until balances have been read once. */
  available: { label: string; value: Figure };
  review: { label: string; disabled: boolean };
};

/** The form a send starts from: what is wrong with what was typed, and whether it can be reviewed. */
export function sendFormView(state: SendFormState): SendFormView {
  const { draft, symbol, unitsPerHeld } = state;
  const mainWallet = state.funding ? copy.mainWallet : null;
  // The main wallet's own portfolios are reached through Move to portfolio,
  // which keeps them apart from it in public. A send to one is never reviewed.
  const toOwnPortfolio = Boolean(state.funding?.ownPortfolios.includes(state.destination));
  const recipientError = !state.recipientTouched
    ? null
    : toOwnPortfolio
      ? copy.mainWallet.useMove
      : draft.validRecipient
        ? null
        : state.destination === state.ownAddress
          ? (mainWallet?.ownAddress ?? copy.ownAddress)
          : state.offCurve
            ? state.offCurveMessage
            : copy.invalidAddress;
  const mobile = state.platform === "mobile";
  const words = mobile ? { ...copy, ...mobileCopy } : copy;
  const amountWrong = state.amountTouched && (!draft.validAmount || draft.amount > draft.held);
  const balances = balancesView(state.balances);
  const canReview =
    balances.known &&
    !toOwnPortfolio &&
    draft.validRecipient &&
    draft.validAmount &&
    draft.amount <= draft.held &&
    draft.multiplierKnown &&
    !state.archived &&
    !state.submitting &&
    !state.preparing;
  const reviewLabel = state.preparing ? commonCopy.checking : copy.review;
  return {
    recipientError,
    amountLine: balances.known
      ? copy.amountLine(
          amountOf(symbol, unitsPerHeld, draft.rawAmount),
          amountOf(symbol, unitsPerHeld, state.heldRaw),
        )
      : null,
    balanceUnavailable: !balances.known
      ? balances.reason
      : draft.multiplierKnown
        ? null
        : commonCopy.balanceUnavailable,
    // "More than you hold" is a claim about the balance: said only once it is known.
    amountError:
      balances.known && draft.multiplierKnown && amountWrong
        ? draft.tooPrecise && state.decimals !== undefined
          ? commonCopy.tooPrecise(`${smallestAmount(state.decimals)} ${symbol}`)
          : draft.amount > draft.held
            ? (mainWallet?.moreThanHeld ?? words.moreThanHeld)
            : words.invalidAmount
        : null,
    canReview,
    reviewLabel,
    explainer: mainWallet
      ? mainWallet.explainer(mobile ? commonCopy.solana : state.network)
      : mobile
        ? mobileCopy.explainer
        : copy.explainer(state.network, symbol),
    recipientLabel: words.recipientLabel,
    recipientPlaceholder: words.recipientPlaceholder,
    pasteWarning: state.pastedForeign ? words.pasteWarning : null,
    refusal: state.unsendable
      ? copy.unsendable[state.unsendable]
      : state.recipientUnreadable
        ? copy.recipientUnreadable
        : null,
    amountLabel: copy.amountLabel(symbol),
    amountPlaceholder: commonCopy.amountPlaceholder,
    available: {
      label: mobileCopy.available,
      value: balances.known ? amountOf(symbol, unitsPerHeld, state.heldRaw) : null,
    },
    review: { label: reviewLabel, disabled: !canReview || !(state.online ?? true) },
  };
}

/**
 * Why a review of a send cannot go ahead because of who it is to: the
 * recipient cannot receive, could not be checked, or is one of the person's
 * own portfolios and the send is from the main wallet. Null for a wallet. A
 * screen shows this in place of the review, whatever the cost says.
 */
export function sendRecipientRefusal(review: {
  recipient: Unsendable | "unreadable" | "ownPortfolio" | null;
}): string | null {
  if (review.recipient === null) return null;
  if (review.recipient === "ownPortfolio") return copy.mainWallet.useMove;
  return review.recipient === "unreadable"
    ? copy.recipientUnreadable
    : copy.unsendable[review.recipient];
}

export type SendSourceView = {
  title: string;
  /** The name it goes by in `sendResultView`: the portfolio's, or "your main wallet". */
  name: string;
  /** Its own address, which it cannot send to. */
  ownAddress: string;
  /** An archived portfolio sends nothing. */
  archived: boolean;
  /** What it can send, the first choice first, each with what it holds of it as stored. */
  assets: readonly { symbol: string; label: string; held: number }[];
  /** Said in place of the form when there is nothing in it to send. */
  empty: string;
  /** Set for the main wallet: what `sendFormView` takes as `funding`. */
  funding?: { ownPortfolios: readonly string[] };
};

/**
 * Where a send leaves from, by the id its sheet was opened with: a
 * portfolio's, or `FUNDING` for the main wallet. The main wallet is for
 * money: it sends its USDC and its SOL, and nothing else that may sit at its
 * address. Null when the id names neither.
 */
export function sendSourceView(
  reads: Pick<ScreenReads, "isPosition">,
  wallet: Wallet,
  sourceId: string,
  platform: AppPlatform = "web",
): SendSourceView | null {
  if (sourceId === FUNDING) {
    const { funding } = wallet;
    return {
      title: copy.mainWallet.title,
      name: copy.mainWallet.name,
      ownAddress: funding.address,
      archived: false,
      assets: [
        { symbol: CASH, label: commonCopy.cash, held: funding.tokens[CASH] ?? 0 },
        { symbol: "SOL", label: "SOL", held: funding.sol },
      ].filter((asset) => asset.held > 0),
      empty: mobileFundingCopy.empty,
      funding: { ownPortfolios: wallet.portfolios.map((portfolio) => portfolio.address) },
    };
  }
  const portfolio = wallet.portfolios.find((entry) => entry.id === sourceId);
  if (!portfolio) return null;
  return {
    title: platform === "mobile" ? mobileCopy.title(portfolio.label) : copy.title,
    name: portfolio.label,
    ownAddress: portfolio.address,
    archived: portfolio.archivedAt !== null,
    assets: sendAssets(portfolio.holdings, reads.isPosition).map((asset) => ({
      ...asset,
      held: portfolio.holdings.find((holding) => holding.symbol === asset.symbol)?.amount ?? 0,
    })),
    empty: copy.empty,
  };
}

/** What can be sent from a portfolio: its cash, then one choice per tracker held. */
export function sendAssets(
  holdings: readonly { symbol: string; amount: number }[],
  isTracker: (symbol: string) => boolean,
): { symbol: string; label: string }[] {
  const held = holdings.filter((holding) => holding.amount > 0);
  return [
    ...held
      .filter((holding) => holding.symbol === CASH)
      .map(() => ({ symbol: CASH, label: commonCopy.cash })),
    ...held
      .filter((holding) => isTracker(holding.symbol))
      .map((holding) => ({ symbol: holding.symbol, label: holding.symbol })),
  ];
}

/** What "Max" fills: the exact amount held. For cash the review then takes the network cost out of it. */
export function maxAmountText(draft: SendDraft): string {
  return String(draft.held);
}

/** The review's answers to the checks it asks for. */
type SendChecks = {
  checkedAddress: boolean;
  acceptedLink: boolean;
  lastFour: string;
};

export type SendReviewState = {
  draft: SendDraft;
  canReview: boolean;
  symbol: string;
  unitsPerHeld: number | undefined;
  destination: string;
  /** The amount that will really leave, which the cost can make smaller than typed. */
  sendAmount: number;
  cost: NetworkCost;
  /** Dollars per stored unit, or null without a live price. */
  pricePerHeld: number | null;
  recipient: RecipientClass;
  checks: SendChecks;
  pending: { blocked: boolean };
  submitting: boolean;
  network: string;
  /** The network fee of a SOL send, in SOL. */
  solFee: number;
  /** The words of the platform the review is drawn on. The web's when absent. */
  platform?: AppPlatform;
  /** Nothing is confirmed while the device is offline. Online when absent. */
  online?: boolean;
  /** The send leaves the main wallet, which pays its own network cost. A portfolio when absent. */
  fromFunding?: boolean;
};

type Term = { label: string; value: string };

type SendReviewView = {
  title: string;
  recipient: { label: string; aria: string; head: string; middle: string; tail: string };
  terms: readonly Term[];
  cashNote: string | null;
  networkCost: NetworkCostView;
  linkWarning: { title: string; body: string; accept: string } | null;
  firstTime: string | null;
  lookalike: {
    title: string;
    previous: string;
    address: string;
    check: string;
    confirm: string;
  } | null;
  lastFour: { label: string; aria: string } | null;
  irreversible: string;
  back: string;
  confirm: { label: string; disabled: boolean };
  /** The address in groups of four, its first and last six characters marked to stand out. */
  segments: readonly { text: string; strong: boolean }[];
  /** Why the network cost is what it is, while it can be met. */
  costReason: readonly string[];
  /** Why it cannot be met right now. */
  costNotNow: string | null;
  /**
   * The sender needs more cash for the network cost, and the action that gets
   * money in: "Move to portfolio" for a portfolio, "Add money" for the main wallet.
   */
  needsCash: { text: string; action: string } | null;
  /** What is still to do before Send can be pressed. */
  reason: string | null;
};

/** A send over this many dollars asks for the last characters of the address. */
const LARGE_SEND_USD = 1000;

/** The review of a send, and whether it can be confirmed. */
export function sendReviewView(state: SendReviewState): SendReviewView {
  const { draft, symbol, unitsPerHeld, destination, sendAmount, recipient, checks } = state;
  const liveValue = state.pricePerHeld === null ? null : sendAmount * state.pricePerHeld;
  // Without a live price the value is unknown, which is not the same as small.
  const largeSend =
    liveValue === null || liveValue > LARGE_SEND_USD || draft.amount > draft.held / 2;
  const networkCost = networkCostView({
    cost: state.cost,
    pending: state.pending,
    submitting: state.submitting,
    fromFunding: state.fromFunding,
  });
  const mobile = state.platform === "mobile";
  const solFee = String(state.solFee);
  const lastFourMissing = largeSend && checks.lastFour !== destination.slice(-4);
  const canSend =
    state.canReview &&
    !networkCost.confirmDisabled &&
    (recipient.kind !== "lookalike" || checks.checkedAddress) &&
    (recipient.kind !== "own" || checks.acceptedLink) &&
    !lastFourMissing;
  const reason =
    recipient.kind === "own" && !checks.acceptedLink
      ? copy.reasons.acceptLink
      : recipient.kind === "lookalike" && !checks.checkedAddress
        ? copy.reasons.checkAddress
        : lastFourMissing
          ? copy.reasons.lastFour
          : null;
  return {
    title: mobile ? mobileCopy.reviewTitle : copy.reviewTitle,
    recipient: {
      label: copy.recipientAddress,
      aria: mobile
        ? mobileCopy.recipientAria(groupsOfFour(destination).join(" "))
        : copy.recipientAria(destination),
      head: destination.slice(0, 6),
      middle: destination.slice(6, -6),
      tail: destination.slice(-6),
    },
    terms: [
      !mobile || symbol === "SOL"
        ? { label: copy.asset, value: symbol }
        : symbol === CASH
          ? { label: mobileCopy.cash, value: CASH }
          : { label: mobileCopy.tracker, value: symbol },
      { label: copy.amount, value: amountOf(symbol, unitsPerHeld, sendAmount) },
      ...(liveValue === null
        ? []
        : [{ label: mobile ? mobileCopy.value : copy.usdValue, value: usd(liveValue) }]),
      ...(mobile ? [] : [{ label: copy.network, value: state.network }]),
      {
        label: copy.networkCost,
        value:
          symbol !== "SOL"
            ? networkCost.value
            : draft.sendingAll
              ? copy.solFeeFromAmount(solFee)
              : copy.solFeeOnTop(solFee),
      },
    ],
    cashNote:
      sendAmount < draft.rawAmount
        ? (state.fromFunding ? copy.mainWallet.cashPaysCost : copy.cashPaysCost)(
            amountOf(symbol, unitsPerHeld, draft.rawAmount - sendAmount),
            amountOf(symbol, unitsPerHeld, sendAmount),
            amountOf(symbol, unitsPerHeld, draft.rawAmount),
          )
        : null,
    networkCost,
    linkWarning:
      recipient.kind === "own"
        ? {
            title: copy.linksTitle,
            body: copy.linksBody(
              recipient.which === "funding"
                ? copy.fundingWallet
                : copy.otherPortfolio(recipient.label),
            ),
            accept: copy.acceptLink,
          }
        : null,
    firstTime: recipient.kind === "new" ? copy.firstTime : null,
    lookalike:
      recipient.kind === "lookalike"
        ? {
            title: copy.lookalikeTitle,
            previous: recipient.label
              ? copy.lookalikeLabel(recipient.label)
              : copy.previousRecipient,
            address: recipient.address,
            check: copy.checkEveryCharacter,
            confirm: copy.checkedAddress,
          }
        : null,
    lastFour: largeSend
      ? { label: copy.lastFour(liveValue !== null), aria: copy.lastFourLabel }
      : null,
    irreversible: copy.irreversible,
    back: commonCopy.back,
    confirm: {
      label: state.submitting ? copy.sending : copy.send,
      disabled: !canSend || !(state.online ?? true),
    },
    segments: addressSegments(destination),
    costReason: networkCost.tone === "neutral" ? networkCost.explanation : [],
    costNotNow:
      networkCost.tone === "warning" && networkCost.explanation.length > 0
        ? networkCost.explanation[0]
        : null,
    needsCash: networkCost.moveMoney
      ? { text: networkCost.moveMoney.before.trim(), action: networkCost.moveMoney.link }
      : null,
    reason,
  };
}

export type SendStage = "checking" | "sending";

/** The steps of a send under way, by how far it has got. */
export function sendProgressView(stage: SendStage, amount: string) {
  const [checking, sending, confirming] = copy.steps;
  const sendingNow = stage === "sending";
  return {
    title: copy.sendingAmount(amount),
    steps: [
      {
        key: "check",
        title: checking,
        status: sendingNow ? ("done" as const) : ("current" as const),
      },
      {
        key: "send",
        title: sending,
        status: sendingNow ? ("current" as const) : ("waiting" as const),
      },
      { key: "confirm", title: confirming, status: "waiting" as const },
    ],
  };
}

/**
 * How a send ended: it landed, or it was sent and not confirmed. A send that
 * landed while its new balance could not be read back (`balancesUnread`) is
 * still sent, and says the balances will follow.
 */
export function sendResultView(
  outcome: "landed" | "unknown",
  amount: string,
  portfolio: string,
  balancesUnread = false,
) {
  const sentBody = copy.sentBody(portfolio);
  return outcome === "landed"
    ? {
        title: copy.sent(amount),
        body: balancesUnread ? `${sentBody} ${commonCopy.balancesUpdateShortly}` : sentBody,
        close: commonCopy.done,
      }
    : { title: copy.unknownTitle, body: copy.unknownBody(portfolio), close: commonCopy.close };
}
