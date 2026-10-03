import type { Denomination, TradeDraft } from "../application/trade.js";
import { commonCopy } from "../copy/common.js";
import { tradeCopy as copy } from "../copy/trade.js";
import { shares, symbolAmount, usd } from "../domain/format.js";
import type { NetworkCost } from "../domain/networkCost.js";
import type { PricedOrder, Side } from "../domain/order.js";
import { networkCostView, type NetworkCostView } from "./networkCost.js";

export type TradeFormState = {
  draft: TradeDraft;
  side: Side;
  denom: Denomination;
  symbol: string;
  cash: number;
  /** Whether a live display price is there to estimate with. */
  displayLive: boolean;
  quoting: boolean;
};

type TradeFormView = {
  portfolioLabel: string;
  denominations: readonly { denom: Denomination; label: string; disabled: boolean }[];
  amountLabel: string;
  maxLabel: string;
  estimate: string;
  available: string;
  estimateBasis: string;
  overCap: string | null;
  balanceUnavailable: string | null;
  /** Buying with no cash at all leads to adding money instead of a review. */
  action:
    { kind: "addMoney"; label: string } | { kind: "review"; label: string; disabled: boolean };
};

const DENOMINATIONS: readonly Denomination[] = ["cash", "units"];

/** The form a trade starts from. */
export function tradeFormView(state: TradeFormState): TradeFormView {
  const { draft, side, denom, symbol, cash, displayLive } = state;
  const buying = side === "buy";
  return {
    portfolioLabel: copy.portfolioLabel(side),
    denominations: DENOMINATIONS.map((option) => ({
      denom: option,
      label: option === "cash" ? copy.inDollars : copy.inTokens(symbol),
      disabled: !displayLive && (buying ? option === "units" : option === "cash"),
    })),
    amountLabel:
      denom === "cash" ? (buying ? copy.spend : copy.receiveAbout) : copy.inTokens(symbol),
    maxLabel: buying ? commonCopy.max : copy.sellAll,
    estimate: copy.estimate(
      displayLive ? (buying ? `${shares(draft.units)} ${symbol}` : usd(draft.value)) : null,
    ),
    available: copy.available(buying ? usd(cash) : `${shares(draft.held)} ${symbol}`),
    estimateBasis: copy.estimateBasis(displayLive),
    overCap: draft.overCap ? (buying ? copy.moreThanCash : copy.moreThanHeld) : null,
    balanceUnavailable: draft.multiplierKnown ? null : commonCopy.balanceUnavailable,
    action:
      buying && cash <= 0
        ? { kind: "addMoney", label: copy.addMoney }
        : {
            kind: "review",
            label: state.quoting ? copy.gettingPrice : copy.review(side),
            disabled: !draft.valid || draft.overCap || state.quoting || !draft.multiplierKnown,
          },
  };
}

export type TradeReviewState = {
  order: PricedOrder;
  symbol: string;
  unitsPerHeld: number | undefined;
  portfolioLabel: string;
  cost: NetworkCost;
  /** What the order needs from the portfolio for the network, in lamports. */
  lamports: number;
  /** Whether the venue has built a firm order behind the price, rather than a price alone. */
  built: boolean;
  /** NoirWire's own share of the fee, in basis points. */
  noirwireFeeBps: number;
  now: number;
  pending: { blocked: boolean };
  submitting: boolean;
  covering: boolean;
};

type TradeReviewView = {
  lead: string;
  terms: readonly { label: string; value: string }[];
  stopsBelowMinimum: string;
  priceUnchecked: string | null;
  fees: { title: string; body: string; noFundingFee: string };
  networkCost: NetworkCostView;
  notFirm: string | null;
  /** The trackers a buy has to say what they are, or null for a sale. */
  trackers: readonly string[] | null;
  expiry: string | null;
  back: string;
  /** An expired price, or one whose fee could not be verified, is priced again instead of confirmed. */
  action:
    { kind: "newPrice"; label: string } | { kind: "confirm"; label: string; disabled: boolean };
};

function shownAmount(symbol: string, unitsPerHeld: number | undefined, held: number) {
  return unitsPerHeld === undefined
    ? commonCopy.unavailable
    : symbolAmount(symbol, held * unitsPerHeld);
}

function feeExplanation(order: PricedOrder, lamports: number) {
  if (order.quote.feeBps === undefined) return copy.feeUnverified;
  if (order.quote.gasless && lamports === 0) return copy.feeCoversNetwork;
  return order.quote.gasless ? copy.feeOpeningSeparate : copy.feeNetworkSeparate;
}

/** The review of one live quote, and whether it can be confirmed. */
export function tradeReviewView(state: TradeReviewState): TradeReviewView {
  const { order, symbol, unitsPerHeld } = state;
  const buying = order.side === "buy";
  const feeBps = order.quote.feeBps;
  const { expiresAt } = order.quote;
  const expired = !!expiresAt && state.now >= expiresAt;
  const tracker = (amount: number) => shownAmount(symbol, unitsPerHeld, amount);
  const dollars = (amount: number) => copy.usdc(usd(amount));
  const networkCost = networkCostView({
    cost: state.cost,
    pending: state.pending,
    submitting: state.submitting,
  });
  return {
    lead: copy.reviewLead(state.portfolioLabel),
    terms: [
      { label: copy.terms.youPay, value: buying ? dollars(order.spend) : tracker(order.spend) },
      {
        label: copy.terms.youReceive,
        value: buying ? tracker(order.receive) : dollars(order.receive),
      },
      {
        label: copy.terms.price,
        value: copy.perToken(usd(order.unitPrice / (unitsPerHeld ?? 1)), symbol),
      },
      {
        label: copy.terms.fee,
        value:
          feeBps === undefined
            ? copy.feeUnknown
            : copy.feeTotal(
                (feeBps / 100).toFixed(2),
                usd(((buying ? order.spend : order.receive) * feeBps) / 10_000),
              ),
      },
      ...(state.noirwireFeeBps > 0
        ? [
            {
              label: copy.terms.ofWhichNoirWire,
              value: copy.percent((state.noirwireFeeBps / 100).toFixed(2)),
            },
          ]
        : []),
      { label: copy.terms.networkCost, value: networkCost.value },
      { label: copy.terms.quotedBy, value: order.venue },
      {
        label: copy.terms.minimum,
        value: buying ? tracker(order.receiveAtLeast) : dollars(order.receiveAtLeast),
      },
    ],
    stopsBelowMinimum: copy.stopsBelowMinimum,
    priceUnchecked: order.priceChecked ? null : copy.priceUnchecked,
    fees: {
      title: copy.feesTitle,
      body: feeExplanation(order, state.lamports),
      noFundingFee: copy.noFundingFee,
    },
    networkCost,
    notFirm: state.built ? null : copy.notFirm,
    trackers: buying ? [symbol] : null,
    expiry: expiresAt
      ? expired
        ? copy.expired
        : copy.expiresAt(new Date(expiresAt).toLocaleTimeString())
      : null,
    back: commonCopy.back,
    action:
      expired || feeBps === undefined
        ? { kind: "newPrice", label: copy.newPrice }
        : {
            kind: "confirm",
            label: state.covering
              ? copy.openingAccount
              : state.submitting
                ? copy.submitting
                : copy.confirm(order.side),
            disabled: networkCost.confirmDisabled,
          },
  };
}
