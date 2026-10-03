import { commonCopy } from "../copy/common.js";
import type { PieProblem } from "../application/pie.js";
import type { LegOutcome } from "../application/actions/pieOrder.js";
import { networkCostCopy } from "../copy/networkCost.js";
import { pieCopy } from "../copy/pie.js";
import { usd } from "../domain/format.js";
import type { NetworkCost } from "../domain/networkCost.js";
import { cashLeg, type PricedOrder, type Side } from "../domain/order.js";
import { shownAmountWith, type ShownUnits } from "./amount.js";
import { networkCostView, type NetworkCostView } from "./networkCost.js";

const copy = pieCopy.order;

/** What a pie's progress list says under one order: why it stopped, or that it was placed unread. */
export function legOutcomeView(outcome: LegOutcome): { error?: string; note?: string } {
  const { stop } = outcome;
  if (outcome.unread) return { note: copy.legUnread };
  if (!stop) return {};
  switch (stop.because) {
    case "feeUnknown":
      return { error: copy.legFeeUnknown };
    case "notAccepted":
      return { error: copy.legNotAccepted };
    case "refused":
      return { error: stop.error };
    case "threw":
      return { error: stop.detail ?? copy.legNotPlaced };
  }
}

/** What a person is told about why a mix cannot be saved. */
export function pieProblemMessage(problem: PieProblem): string {
  const problems = pieCopy.problems;
  switch (problem.reason) {
    case "empty":
      return problems.empty;
    case "tooMany":
      return problems.tooMany(problem.max);
    case "repeated":
      return problems.repeated;
    case "unlisted":
      return problems.unlisted;
    case "retired":
      return problems.retired(problem.symbol);
    case "weight":
      return problems.weight;
    case "total":
      return problems.total(problem.total);
  }
}

/** A priced order of a pie, with the stock it is for. */
export type PieOrder = PricedOrder & { symbol: string };

/** A stock's display name, or its symbol where it has none. */
type NameOf = (symbol: string) => string;

/** One order's terms on one line: what is paid or sold, what is expected, the floor and the fee. */
export function legTerms(order: PieOrder, shownUnits: ShownUnits): string {
  const shown = (amount: number) => shownAmountWith(shownUnits, order.symbol, amount);
  const fee =
    order.quote.feeBps === undefined
      ? copy.feeUnknown
      : copy.fee((order.quote.feeBps / 100).toFixed(2));
  return order.side === "buy"
    ? copy.legBuy(usd(order.spend), shown(order.receive), shown(order.receiveAtLeast), fee)
    : copy.legSell(shown(order.spend), usd(order.receive), usd(order.receiveAtLeast), fee);
}

type PieInvestView = {
  label: string;
  available: string;
  overCash: string | null;
  split: {
    title: string;
    legs: readonly { symbol: string; name: string; amount: string }[];
  } | null;
  waiting: string | null;
  review: { label: string; disabled: boolean };
};

/** The first step of investing in a pie: how much, and how it would split. */
export function pieInvestView(state: {
  amount: number;
  cash: number;
  preview: readonly { symbol: string; usd: number }[];
  priced: boolean;
  nameOf: NameOf;
}): PieInvestView {
  const { amount, cash, preview } = state;
  return {
    label: copy.investLabel,
    available: commonCopy.cashAvailable(usd(cash)),
    overCash: amount > cash ? copy.moreThanCash : null,
    split:
      preview.length > 0 && amount <= cash
        ? {
            title: copy.howItSplits,
            legs: preview.map((leg) => ({
              symbol: leg.symbol,
              name: state.nameOf(leg.symbol),
              amount: usd(leg.usd),
            })),
          }
        : null,
    waiting: state.priced ? null : copy.waitingForPrices,
    review: {
      label: copy.reviewOrders,
      disabled: !state.priced || amount <= 0 || amount > cash || preview.length === 0,
    },
  };
}

type PieRebalanceView = {
  lead: string;
  sells: readonly { symbol: string; label: string; amount: string }[];
  nothingToSell: string | null;
  price: { label: string; disabled: boolean };
};

/** The first step of a rebalance: what would be sold. */
export function pieRebalanceView(state: {
  sells: readonly { symbol: string; usd: number }[];
  priced: boolean;
  nameOf: NameOf;
}): PieRebalanceView {
  const { sells } = state;
  return {
    lead: copy.rebalanceLead,
    sells: sells.map((leg) => ({
      symbol: leg.symbol,
      label: copy.sellLeg(state.nameOf(leg.symbol)),
      amount: copy.about(usd(leg.usd)),
    })),
    nothingToSell: sells.length > 0 ? null : copy.nothingToSell,
    price: { label: copy.priceSells, disabled: !state.priced || sells.length === 0 },
  };
}

export type PieReviewState = {
  mode: "invest" | "rebalance";
  side: Side;
  orders: readonly PieOrder[];
  cost: NetworkCost;
  /** Cash offered that was too little to split, and stays as cash. */
  leftover: number;
  noirwireFeeBps: number;
  shownUnits: ShownUnits;
  nameOf: NameOf;
  pending: { blocked: boolean };
};

export type PieReviewView = {
  step: string | null;
  orders: readonly { symbol: string; name: string; amount: string; terms: string }[];
  totals: readonly { label: string; value: string }[];
  smallOrders: string | null;
  sequence: string;
  someUnchecked: string | null;
  networkCostLine: string;
  networkCost: NetworkCostView;
  /** The trackers a buy has to say what they are, or null for sales. */
  trackers: readonly string[] | null;
  quantityUnknown: string | null;
  feeUnverified: string | null;
  /** Going back from the buys of a rebalance keeps the cash the sells returned, and ends there. */
  back: { label: string; ends: boolean };
  confirm: { label: string; disabled: boolean };
};

/** A fee above this share of an order is called out: it is the network's cost showing through. */
const COSTLY_FEE_BPS = 100;

/** The review of a pie's orders, and whether they can be placed. */
export function pieReviewView(state: PieReviewState): PieReviewView {
  const { orders, shownUnits } = state;
  const buying = state.side === "buy";
  const cash = orders.reduce((sum, order) => sum + cashLeg(order), 0);
  const fees = orders.reduce(
    (sum, order) => sum + (cashLeg(order) * (order.quote.feeBps ?? 0)) / 10_000,
    0,
  );
  const expiries = orders.flatMap((order) => order.quote.expiresAt ?? []);
  const feesKnown = orders.every((order) => order.quote.feeBps !== undefined);
  // An order whose token quantity cannot be shown is not one anybody can review.
  const quantitiesKnown = orders.every((order) => shownUnits(order.symbol, 1) !== undefined);
  const networkCost = networkCostView({
    cost: state.cost,
    pending: state.pending,
    submitting: false,
  });
  const rebalancing = state.mode === "rebalance";
  const endsAtBuys = rebalancing && buying;
  return {
    step: rebalancing ? (buying ? copy.stepBuy : copy.stepSell) : null,
    orders: orders.map((order) => ({
      symbol: order.symbol,
      name: state.nameOf(order.symbol),
      amount: buying ? usd(order.spend) : shownAmountWith(shownUnits, order.symbol, order.spend),
      terms: legTerms(order, shownUnits),
    })),
    totals: [
      { label: buying ? copy.totalPay : copy.youReceive, value: copy.usdc(usd(cash)) },
      {
        label: copy.feesIncluded,
        value: copy.feesFigure(usd(fees), cash > 0 ? ((fees / cash) * 100).toFixed(2) : "0.00"),
      },
      ...(state.noirwireFeeBps > 0
        ? [
            {
              label: copy.ofWhichNoirWire,
              value: copy.percent((state.noirwireFeeBps / 100).toFixed(2)),
            },
          ]
        : []),
      ...(state.leftover > 0 ? [{ label: copy.leftover, value: usd(state.leftover) }] : []),
    ],
    smallOrders: orders.some((order) => (order.quote.feeBps ?? 0) > COSTLY_FEE_BPS)
      ? copy.smallOrders
      : null,
    sequence: `${copy.oneAtATime}${
      expiries.length > 0
        ? copy.firmUntil(new Date(Math.min(...expiries)).toLocaleTimeString())
        : ""
    }`,
    someUnchecked: orders.some((order) => !order.priceChecked) ? copy.someUnchecked : null,
    networkCostLine: networkCostCopy.line(networkCost.value),
    networkCost,
    trackers: buying ? orders.map((order) => order.symbol) : null,
    quantityUnknown: quantitiesKnown ? null : copy.quantityUnknown,
    feeUnverified: feesKnown ? null : copy.feeUnverified,
    back: { label: endsAtBuys ? copy.keepAsCash : commonCopy.back, ends: endsAtBuys },
    confirm: {
      label: copy.place(orders.length),
      disabled: !feesKnown || !quantitiesKnown || networkCost.confirmDisabled,
    },
  };
}

type PieProgressStep = { kind: "running"; side: Side; covering?: boolean } | { kind: "done" };

/** The headline over a pie's orders while they are placed and once they are. */
export function pieProgressHeadline(
  step: PieProgressStep,
  outcomes: readonly { status: string }[],
): string {
  if (step.kind === "running")
    return step.covering ? copy.openingAccounts : copy.placing(step.side);
  const placed = outcomes.filter((outcome) => outcome.status === "done").length;
  if (outcomes.length === 0) return copy.nonePlaced;
  return placed === outcomes.length
    ? copy.allPlaced(placed)
    : copy.somePlaced(placed, outcomes.length);
}

type PieApprovalView = {
  label: string;
  title: string;
  reviewed: string;
  now: string;
  paysOwnCost: string | null;
  stop: string;
  accept: string;
};

/** Asking whether to place an order at a new, worse price after its first one expired. */
export function pieApprovalView(state: {
  symbol: string;
  reviewed: PieOrder;
  replacement: PieOrder;
  shownUnits: ShownUnits;
  nameOf: NameOf;
}): PieApprovalView {
  const { reviewed, replacement } = state;
  return {
    label: copy.newPriceLabel,
    title: copy.newPriceWorse(state.nameOf(state.symbol)),
    reviewed: `${copy.reviewed}${legTerms(reviewed, state.shownUnits)}`,
    now: `${copy.now}${legTerms(replacement, state.shownUnits)}`,
    paysOwnCost: reviewed.quote.gasless && !replacement.quote.gasless ? copy.paysOwnCost : null,
    stop: copy.stopHere,
    accept: copy.acceptPrice,
  };
}
