import type { SendDraft } from "../application/send.js";
import { commonCopy } from "../copy/common.js";
import { sendCopy as copy } from "../copy/send.js";
import { symbolAmount, usd } from "../domain/format.js";
import type { NetworkCost } from "../domain/networkCost.js";
import type { RecipientClass } from "../domain/recipients.js";
import { networkCostView, type NetworkCostView } from "./networkCost.js";

/** A stored amount of `symbol` in shown units, or "Unavailable" while those are not known. */
function amountOf(symbol: string, unitsPerHeld: number | undefined, held: number) {
  return unitsPerHeld === undefined
    ? commonCopy.unavailable
    : symbolAmount(symbol, held * unitsPerHeld);
}

export type SendFormState = {
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
};

type SendFormView = {
  recipientError: string | null;
  amountLine: string;
  balanceUnavailable: string | null;
  amountError: string | null;
  canReview: boolean;
  reviewLabel: string;
  explainer: string;
};

/** The form a send starts from: what is wrong with what was typed, and whether it can be reviewed. */
export function sendFormView(state: SendFormState): SendFormView {
  const { draft, symbol, unitsPerHeld } = state;
  const recipientError =
    !state.recipientTouched || draft.validRecipient
      ? null
      : state.destination === state.ownAddress
        ? copy.ownAddress
        : state.offCurve
          ? state.offCurveMessage
          : copy.invalidAddress;
  const amountWrong = state.amountTouched && (!draft.validAmount || draft.amount > draft.held);
  return {
    recipientError,
    amountLine: copy.amountLine(
      amountOf(symbol, unitsPerHeld, draft.rawAmount),
      amountOf(symbol, unitsPerHeld, state.heldRaw),
    ),
    balanceUnavailable: draft.multiplierKnown ? null : commonCopy.balanceUnavailable,
    amountError:
      draft.multiplierKnown && amountWrong
        ? draft.amount > draft.held
          ? copy.moreThanHeld
          : copy.invalidAmount
        : null,
    canReview:
      draft.validRecipient &&
      draft.validAmount &&
      draft.amount <= draft.held &&
      draft.multiplierKnown &&
      !state.archived &&
      !state.submitting &&
      !state.preparing,
    reviewLabel: state.preparing ? commonCopy.checking : copy.review,
    explainer: copy.explainer(state.network, symbol),
  };
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
  });
  const solFee = String(state.solFee);
  const canSend =
    state.canReview &&
    !networkCost.confirmDisabled &&
    (recipient.kind !== "lookalike" || checks.checkedAddress) &&
    (recipient.kind !== "own" || checks.acceptedLink) &&
    (!largeSend || checks.lastFour === destination.slice(-4));
  return {
    title: copy.reviewTitle,
    recipient: {
      label: copy.recipientAddress,
      aria: copy.recipientAria(destination),
      head: destination.slice(0, 6),
      middle: destination.slice(6, -6),
      tail: destination.slice(-6),
    },
    terms: [
      { label: copy.asset, value: symbol },
      { label: copy.amount, value: amountOf(symbol, unitsPerHeld, sendAmount) },
      ...(liveValue === null ? [] : [{ label: copy.usdValue, value: usd(liveValue) }]),
      { label: copy.network, value: state.network },
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
        ? copy.cashPaysCost(
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
    confirm: { label: state.submitting ? copy.sending : copy.send, disabled: !canSend },
  };
}
