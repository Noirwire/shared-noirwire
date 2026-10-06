import { networkCostCopy as copy } from "../copy/networkCost.js";
import { symbolAmount } from "../domain/format.js";
import type { NetworkCost, Opens } from "../domain/networkCost.js";

/** Everything that decides the network cost of a review and whether it can be confirmed. */
export type NetworkCostState = {
  /** Null while the cost is still being worked out. */
  cost: NetworkCost | null;
  /** Whether the portfolio's last action still holds confirming back. */
  pending: { blocked: boolean };
  /** True from the press of Confirm until the action answers. */
  submitting: boolean;
  /** An Earn withdrawal, which pays out of the USDC it returns. */
  withdrawing?: boolean;
  /** The main wallet pays, for a send of its own. A portfolio when absent. */
  fromFunding?: boolean;
};

export type NetworkCostView = {
  label: string;
  /** The one figure a review's list of terms shows. */
  value: string;
  tone: "neutral" | "warning";
  /** Said under the terms: why the cost is as large as it is, or why it cannot be met. */
  explanation: readonly string[];
  /**
   * A cost the payer's cash cannot cover: the sentence around the way to get
   * money in. Its link is "Move to portfolio" for a portfolio and "Add money"
   * for the main wallet.
   */
  moveMoney: { before: string; link: string; after: string } | null;
  /** A cost the relayer pays: what it is, behind a disclosure. */
  details: { summary: string; body: string } | null;
  confirmDisabled: boolean;
};

const ONE_CENT = 0.01;

/**
 * A cost as money, to the cent. Most are a fraction of one, and a figure
 * rounded to "0.00" would read as nothing to pay, so anything under a cent is
 * said to be exactly that.
 */
function feeFigure(fee: number): string {
  return fee < ONE_CENT ? copy.underOneCent : symbolAmount("USDC", fee);
}

function payable(cost: NetworkCost): boolean {
  return cost.kind === "covered" || cost.kind === "relayer" || cost.kind === "ownSol";
}

/** The sentences that name who pays: a portfolio, or the main wallet for a send of its own. */
const PAYER = {
  portfolio: {
    fromOwnSol: copy.fromOwnSol,
    needsCash: copy.needsCash,
    moveMoney: copy.moveToPortfolio,
    paysBack: copy.relayer.paysBack,
    movesWithMarket: copy.relayer.movesWithMarket,
  },
  funding: {
    fromOwnSol: copy.mainWallet.fromOwnSol,
    needsCash: copy.mainWallet.needsCash,
    moveMoney: copy.mainWallet.addMoney,
    paysBack: copy.mainWallet.paysBack,
    movesWithMarket: copy.mainWallet.movesWithMarket,
  },
} as const;

type Payer = (typeof PAYER)[keyof typeof PAYER];

function figure(cost: NetworkCost | null, payer: Payer): string {
  if (cost === null) return copy.checking;
  if (cost.kind === "covered") return copy.covered;
  if (cost.kind === "relayer") return feeFigure(cost.fee);
  if (cost.kind === "ownSol") {
    return payer.fromOwnSol(cost.usd < ONE_CENT ? null : cost.usd.toFixed(2));
  }
  return copy.notAvailable;
}

function openingReason(opens: Opens | null, count: number): readonly string[] {
  if (!opens) return [];
  return [count > 1 ? copy.openingSeveral(count) : copy.opening[opens]];
}

function relayerDetails(
  cost: Extract<NetworkCost, { kind: "relayer" }>,
  withdrawing: boolean,
  payer: Payer,
): NetworkCostView["details"] {
  const several = cost.count > 1;
  const after =
    cost.opens === "holding"
      ? several
        ? copy.relayer.openedFirstSeveral
        : copy.relayer.openedFirst
      : copy.relayer.sameTransaction;
  return {
    summary: copy.relayer.summary(feeFigure(cost.fee)),
    body: `${payer.paysBack(cost.fee.toFixed(6))}${withdrawing ? copy.relayer.fromWithdrawal : copy.relayer.fromCash}${after}${payer.movesWithMarket}`,
  };
}

function notes(
  cost: NetworkCost | null,
  withdrawing: boolean,
  payer: Payer,
): Pick<NetworkCostView, "explanation" | "moveMoney" | "details"> {
  const none = { explanation: [], moveMoney: null, details: null };
  if (cost === null || cost.kind === "covered" || cost.kind === "ownSol") return none;
  switch (cost.kind) {
    case "relayer":
      return {
        explanation: openingReason(cost.opens, cost.count),
        moveMoney: null,
        details: relayerDetails(cost, withdrawing, payer),
      };
    case "needsCash":
      return {
        ...none,
        moveMoney: {
          before: payer.needsCash(
            feeFigure(cost.cash),
            cost.cash < ONE_CENT,
            symbolAmount("USDC", cost.free),
          ),
          link: payer.moveMoney,
          after: copy.orSmaller,
        },
      };
    case "tooSmall":
      return { ...none, explanation: [copy.tooSmall(symbolAmount("USDC", cost.smallest))] };
    case "noPrice":
      return { ...none, explanation: [copy.noPrice] };
    case "unavailable":
      return { ...none, explanation: [copy.notNow] };
  }
}

/**
 * The network cost of a money review, and whether its Confirm is enabled. A
 * component renders this and forwards the press; it decides nothing about
 * whether the action can go ahead.
 */
export function networkCostView({
  cost,
  pending,
  submitting,
  withdrawing = false,
  fromFunding = false,
}: NetworkCostState): NetworkCostView {
  const canPay = cost !== null && payable(cost);
  const payer = fromFunding ? PAYER.funding : PAYER.portfolio;
  return {
    label: copy.label,
    value: figure(cost, payer),
    tone: cost === null || canPay ? "neutral" : "warning",
    ...notes(cost, withdrawing, payer),
    confirmDisabled: !canPay || pending.blocked || submitting,
  };
}
