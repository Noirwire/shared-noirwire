import type { Attempt } from "../application/result.js";
import type { ScreenReads } from "../application/screenReads.js";
import type { Denomination, TradeDraft } from "../application/trade.js";
import { commonCopy } from "../copy/common.js";
import { errorsCopy } from "../copy/errors.js";
import { networkCostCopy } from "../copy/networkCost.js";
import { portfolioCopy } from "../copy/portfolio.js";
import { mobileTradeCopy, tradeCopy as copy } from "../copy/trade.js";
import { smallestAmount } from "../domain/amount.js";
import type { AppPlatform } from "../domain/appPlatform.js";
import { shares, symbolAmount, usd } from "../domain/format.js";
import type { ReadFreshness } from "../domain/freshness.js";
import type { NetworkCost } from "../domain/networkCost.js";
import type { PricedOrder, Side } from "../domain/order.js";
import { resolvePortfolioIcon, type PortfolioIcon } from "../domain/portfolioIcon.js";
import type { Portfolio, Wallet } from "../domain/wallet.js";
import { describeFailure } from "./actionResult.js";
import { balancesView, type Figure } from "./freshness.js";
import type { HomeTarget } from "./home.js";
import { networkCostView, type NetworkCostView } from "./networkCost.js";
import type { ProgressStep } from "./progress.js";

export type TradeFormState = {
  draft: TradeDraft;
  side: Side;
  denom: Denomination;
  symbol: string;
  cash: number;
  /** Whether a live display price is there to estimate with. */
  displayLive: boolean;
  quoting: boolean;
  /** How current the app's balance read is: nothing is bought or sold against a balance never read. */
  balances: ReadFreshness;
};

type TradeFormView = {
  portfolioLabel: string;
  denominations: readonly { denom: Denomination; label: string; disabled: boolean }[];
  amountLabel: string;
  maxLabel: string;
  estimate: string;
  /** The cash to buy with, or what is held to sell. Null until balances have been read once. */
  available: Figure;
  estimateBasis: string;
  overCap: string | null;
  /** The amount was typed with more decimals than what it is typed in has. */
  tooPrecise: string | null;
  /** Why nothing can be reviewed: the token's balance cannot be shown, or balances never loaded. */
  balanceUnavailable: string | null;
  /**
   * Buying with no cash at all leads to adding money instead of a review.
   * "No cash" is only said of cash that has been read.
   */
  action:
    { kind: "addMoney"; label: string } | { kind: "review"; label: string; disabled: boolean };
};

const DENOMINATIONS: readonly Denomination[] = ["cash", "units"];

/** The form a trade starts from. */
export function tradeFormView(state: TradeFormState): TradeFormView {
  const { draft, side, denom, symbol, cash, displayLive } = state;
  const buying = side === "buy";
  const balances = balancesView(state.balances);
  const { known } = balances;
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
    available: known
      ? copy.available(buying ? usd(cash) : `${shares(draft.held)} ${symbol}`)
      : null,
    estimateBasis: copy.estimateBasis(displayLive),
    overCap: known && draft.overCap ? (buying ? copy.moreThanReady : copy.moreThanHeld) : null,
    tooPrecise:
      draft.tooPrecise && draft.decimals !== undefined
        ? commonCopy.tooPrecise(
            `${smallestAmount(draft.decimals)} ${denom === "cash" ? "USDC" : symbol}`,
          )
        : null,
    balanceUnavailable: !known
      ? balances.reason
      : draft.multiplierKnown
        ? null
        : commonCopy.balanceUnavailable,
    action:
      known && buying && cash <= 0
        ? { kind: "addMoney", label: copy.addMoney }
        : {
            kind: "review",
            label: state.quoting ? copy.gettingPrice : copy.review(side),
            disabled:
              !known || !draft.valid || draft.overCap || state.quoting || !draft.multiplierKnown,
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
  /** The words of the platform the review is drawn on. The web's when absent. */
  platform?: AppPlatform;
  /** The order's network cost was already paid on an earlier attempt. */
  costPaid?: boolean;
  /** Nothing is confirmed while the device is offline. Online when absent. */
  online?: boolean;
  /** A replaced review holds Confirm back for a moment, so it is never pressed under a changed price. */
  settling?: boolean;
  /** The relayer could not be used for this order, so it cannot go ahead now. */
  relayerDown?: boolean;
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
  /** The order in two sentences: what leaves the portfolio, and the least that comes back. */
  headline: readonly [string, string];
  /** How long the price is held, or that it expired; null for a price with no expiry. */
  countdown: string | null;
  /** What the order takes from or leaves in the portfolio's cash, with the relayer's fee. */
  total: { label: string; value: string };
  /** Why the network cost is what it is. */
  reasons: readonly string[];
  costDetails: { summary: string; body: string } | null;
  feeUnverified: string | null;
  /** What a buy says about the tracker it buys, or null for a sale. */
  trackerLine: string | null;
  readRisks: string;
  /** Behind "Read the risks" on a buy: what kind of certificate the tracker is and where it is not offered. */
  risks: { title: string; lines: string[] };
  publicLine: string;
  offline: string | null;
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
  const mobile = state.platform === "mobile";
  const online = state.online ?? true;
  const costPaid = state.costPaid ?? false;
  const networkFigure = costPaid
    ? copy.alreadyPaid
    : mobile && state.cost.kind === "covered"
      ? copy.includedInFee
      : networkCost.value;
  const relayerFee = state.cost.kind === "relayer" && !costPaid ? state.cost.fee : 0;
  const seconds = expiresAt ? Math.ceil((expiresAt - state.now) / 1000) : null;
  const confirmDisabled =
    networkCost.confirmDisabled || !online || !!state.settling || !!state.relayerDown;
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
      { label: copy.terms.networkCost, value: mobile ? networkFigure : networkCost.value },
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
            disabled: confirmDisabled,
          },
    headline: buying
      ? [
          copy.headline.spend(usd(order.spend), state.portfolioLabel),
          copy.headline.receiveAtLeast(tracker(order.receiveAtLeast)),
        ]
      : [
          copy.headline.sell(tracker(order.spend), state.portfolioLabel),
          copy.headline.receiveAtLeast(usd(order.receiveAtLeast)),
        ],
    countdown: seconds === null ? null : seconds <= 0 ? copy.expired : copy.heldFor(seconds),
    total: buying
      ? { label: copy.totalCost, value: symbolAmount("USDC", order.spend + relayerFee) }
      : {
          label: copy.totalReceive,
          value: symbolAmount("USDC", Math.max(order.receiveAtLeast - relayerFee, 0)),
        },
    reasons: costPaid ? [copy.alreadyPaidReason] : networkCost.explanation,
    costDetails: networkCost.details
      ? { summary: copy.whatIsCost, body: networkCost.details.body }
      : null,
    feeUnverified: feeBps === undefined ? copy.feeUnverified : null,
    trackerLine: buying ? copy.trackerLine(symbol) : null,
    readRisks: copy.readRisks,
    risks: {
      title: copy.readRisks,
      lines: buying ? [copy.tracker.what([symbol]), copy.tracker.notOffered] : [],
    },
    publicLine: copy.publicLine,
    offline: online ? null : mobileTradeCopy.offline,
  };
}

export type PortfolioChoice = {
  id: string;
  label: string;
  icon: PortfolioIcon;
  /** Its cash, or what it holds of the tracker. Null until balances have been read once. */
  caption: Figure;
};

function shownHeld(reads: Pick<ScreenReads, "shownUnits">, portfolio: Portfolio, symbol: string) {
  const raw = portfolio.holdings.find((holding) => holding.symbol === symbol)?.amount ?? 0;
  const shown = reads.shownUnits(symbol, raw);
  return shown === undefined ? copy.feeUnknown : `${shares(shown)} ${symbol}`;
}

/** The portfolios that can take part: any active one to buy, only those holding the tracker to sell. */
export function portfolioChoices(
  reads: ScreenReads,
  wallet: Wallet,
  side: Side,
  symbol: string | null,
  balances: ReadFreshness,
): PortfolioChoice[] {
  const { known } = balancesView(balances);
  return reads
    .activePortfolios(wallet)
    .filter(
      (portfolio) =>
        side === "buy" ||
        portfolio.holdings.some((holding) => holding.symbol === symbol && holding.amount > 0),
    )
    .map((portfolio) => ({
      id: portfolio.id,
      label: portfolio.label,
      icon: resolvePortfolioIcon(portfolio.icon),
      caption: !known
        ? null
        : side === "buy" || symbol === null
          ? copy.cashAvailable(symbolAmount("USDC", reads.cashOf(portfolio)))
          : copy.held(shownHeld(reads, portfolio, symbol)),
    }));
}

export type NoMoneyView = {
  title: string;
  detail: string;
  action: { label: string; target: Extract<HomeTarget, { to: "fund" | "addMoney" }> };
};

/**
 * Buying with nothing to invest, said on the first tap and not three steps
 * in. `portfolioId` is the portfolio the buy starts from, or null when it
 * starts from a tracker's page with none chosen yet: then it is said only
 * when no active portfolio has anything to invest. Null when there is money
 * to buy with. With USDC waiting in the funding wallet the way on is to move
 * it in; with none, to add money. Null too while balances have never been
 * read: "nothing to invest" is said only of money that is known.
 */
export function noMoneyView(
  reads: ScreenReads,
  wallet: Wallet,
  portfolioId: string | null,
  balances: ReadFreshness,
): NoMoneyView | null {
  if (!balancesView(balances).known) return null;
  const active = reads.activePortfolios(wallet);
  const chosen = active.find((portfolio) => portfolio.id === portfolioId);
  if ((chosen ? [chosen] : active).some((portfolio) => reads.cashOf(portfolio) > 0)) return null;
  const waiting = (wallet.funding.tokens.USDC ?? 0) > 0;
  return {
    title: chosen ? copy.noMoney : copy.noMoneyAnywhere,
    detail: waiting ? copy.noMoneyDetail : portfolioCopy.home.moneyArrives,
    action: waiting
      ? {
          label: portfolioCopy.detail.moveToPortfolio,
          target: chosen ? { to: "fund", portfolioId: chosen.id } : { to: "fund" },
        }
      : { label: copy.addMoney, target: { to: "addMoney" } },
  };
}

/** The order's floor on the amount step: whether Review is held back for being under the smallest order. */
export function amountFloor(state: {
  /** The typed amount in dollars, or 0 when it cannot be worked out. */
  dollars: number;
  valid: boolean;
  smallest: number;
}) {
  const smallest = state.smallest.toFixed(0);
  const below = state.valid && state.dollars > 0 && state.dollars < state.smallest;
  return {
    caption: copy.smallestOrder(smallest),
    below: below ? copy.belowSmallest(smallest) : null,
  };
}

/** Where a trade under way has got: starting, opening its holding, or placing the order. */
export type TradePhase = "starting" | "covering" | "acting";

/** The progress list in plain words: a first buy opens the holding, then prices and places the order. */
export function tradeProgressSteps(state: {
  firstBuy: boolean;
  symbol: string;
  phase: TradePhase;
}): ProgressStep[] {
  const p = copy.progress;
  if (!state.firstBuy) {
    return [
      { key: "placing", title: p.placing, status: "current" },
      { key: "reading", title: p.reading, status: "waiting" },
    ];
  }
  const opened = state.phase === "acting";
  return [
    {
      key: "opening",
      title: p.opening(state.symbol),
      status: opened ? "done" : "current",
      ...(opened ? { caption: p.opened } : {}),
    },
    { key: "pricing", title: p.pricing, status: opened ? "current" : "waiting" },
    { key: "placing", title: p.placing, status: "waiting" },
    { key: "reading", title: p.reading, status: "waiting" },
  ];
}

export type TradeResultView = {
  tone: "success" | "warning" | "error";
  headline: string;
  body: string;
  primary: string;
  /** Offered only after an order failed with its holding already open. */
  newPrice: string | null;
};

export type TradeOutcome<Order> =
  | { kind: "result"; view: TradeResultView }
  | {
      kind: "review";
      notice: { tone: "danger" | "warning"; text: string };
      replacement?: Order;
      reviewAgain?: "relayer" | "other";
      costPaid?: boolean;
      relayerDown?: boolean;
    };

const endsWithState = (text: string) =>
  /Nothing (was|is) (traded|sent|charged)|Not signed/.test(text);

/** What the trade sheet does with an attempt's answer: a result step, or back to the review with a reason. */
export function tradeOutcome<Order extends Pick<PricedOrder, "spend" | "receive">>(
  result: Attempt<Order>,
  context: {
    side: Side;
    symbol: string;
    portfolioLabel: string;
    reviewed: Order;
    unitsPerHeld: number | undefined;
    platform: AppPlatform;
  },
): TradeOutcome<Order> {
  const r = copy.result;
  const { side, symbol, portfolioLabel, reviewed } = context;
  const completed = "completed" in result && result.completed.length > 0;
  const resultStep = (view: TradeResultView): TradeOutcome<Order> => ({ kind: "result", view });
  if (result.kind === "confirmed") {
    if (result.settlement === "balancesEstimated") {
      return resultStep({
        tone: "success",
        headline: r.placed,
        body: r.placedUnread,
        primary: r.done,
        newPrice: null,
      });
    }
    const tokens = side === "buy" ? reviewed.receive : reviewed.spend;
    const amount =
      context.unitsPerHeld === undefined
        ? symbol
        : `${shares(tokens * context.unitsPerHeld)} ${symbol}`;
    return resultStep({
      tone: "success",
      headline: side === "buy" ? r.bought(amount) : r.sold(amount),
      body:
        side === "buy"
          ? r.boughtFor(usd(reviewed.spend), portfolioLabel)
          : r.soldFor(usd(reviewed.receive), portfolioLabel),
      primary: r.done,
      newPrice: null,
    });
  }
  if (result.kind === "unknown") {
    return resultStep({
      tone: "warning",
      headline: r.unknown,
      body: r.unknownBody(portfolioLabel),
      primary: r.close,
      newPrice: null,
    });
  }
  const orderNotPlaced =
    completed &&
    (result.kind === "failed" ||
      (result.kind === "needsReview" && result.change.because === "priceMoved"));
  if (orderNotPlaced) {
    return resultStep({
      tone: "error",
      headline: r.notPlaced,
      body: r.notPlacedBody,
      primary: r.close,
      newPrice: r.reviewNewPrice,
    });
  }
  if (result.kind === "needsReview") {
    const { change } = result;
    if (change.because === "priceMoved") {
      return {
        kind: "review",
        notice: { tone: "warning", text: copy.priceMovedReview },
        replacement: change.replacement,
      };
    }
    if (change.because === "networkCostRose") {
      return {
        kind: "review",
        notice: { tone: "warning", text: errorsCopy.chain.networkCostRose },
        reviewAgain: "relayer",
        costPaid: completed,
      };
    }
    return {
      kind: "review",
      notice: { tone: "warning", text: networkCostCopy.notNow },
      reviewAgain: "other",
      relayerDown: true,
      costPaid: completed,
    };
  }
  const failure = describeFailure(result, context.platform);
  const text =
    endsWithState(failure.error) || completed
      ? failure.error
      : `${failure.error} ${copy.nothingTraded}`;
  return {
    kind: "review",
    notice: { tone: "danger", text },
    ...(failure.reviewAgain ? { reviewAgain: failure.reviewAgain } : {}),
    ...(failure.costCovered ? { costPaid: true } : {}),
  };
}
