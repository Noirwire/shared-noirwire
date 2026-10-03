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
};

export type NetworkCostView = {
  label: string;
  /** The one figure a review's list of terms shows. */
  value: string;
  tone: "neutral" | "warning";
  /** Said under the terms: why the cost is as large as it is, or why it cannot be met. */
  explanation: readonly string[];
  /** A cost the portfolio's cash cannot cover: the sentence around the way to move money in. */
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

function figure(cost: NetworkCost | null): string {
  if (cost === null) return copy.checking;
  if (cost.kind === "covered") return copy.covered;
  if (cost.kind === "relayer") return feeFigure(cost.fee);
  if (cost.kind === "ownSol") {
    return copy.fromOwnSol(cost.usd < ONE_CENT ? null : cost.usd.toFixed(2));
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
    body: `${copy.relayer.paysBack(cost.fee.toFixed(6))}${withdrawing ? copy.relayer.fromWithdrawal : copy.relayer.fromCash}${after}${copy.relayer.movesWithMarket}`,
  };
}

function notes(
  cost: NetworkCost | null,
  withdrawing: boolean,
): Pick<NetworkCostView, "explanation" | "moveMoney" | "details"> {
  const none = { explanation: [], moveMoney: null, details: null };
  if (cost === null || cost.kind === "covered" || cost.kind === "ownSol") return none;
  switch (cost.kind) {
    case "relayer":
      return {
        explanation: openingReason(cost.opens, cost.count),
        moveMoney: null,
        details: relayerDetails(cost, withdrawing),
      };
    case "needsCash":
      return {
        ...none,
        moveMoney: {
          before: copy.needsCash(
            feeFigure(cost.cash),
            cost.cash < ONE_CENT,
            symbolAmount("USDC", cost.free),
          ),
          link: copy.moveMoneyHere,
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
}: NetworkCostState): NetworkCostView {
  const canPay = cost !== null && payable(cost);
  return {
    label: copy.label,
    value: figure(cost),
    tone: cost === null || canPay ? "neutral" : "warning",
    ...notes(cost, withdrawing),
    confirmDisabled: !canPay || pending.blocked || submitting,
  };
}
