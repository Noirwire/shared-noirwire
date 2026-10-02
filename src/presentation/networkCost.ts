import { networkCostCopy as copy } from "../copy/networkCost.js";
import { symbolAmount } from "../domain/format.js";
import type { Opens } from "../domain/networkCost.js";

/** How the network cost of one action is met, as its review states it. */
export type NetworkCostInput =
  /** The venue pays it, or there is nothing to pay. */
  | { kind: "covered" }
  /** The portfolio pays it from its own SOL, worth about `usd` dollars. */
  | { kind: "ownSol"; usd: number }
  /** The relayer pays the network and is paid `fee` of the portfolio's cash, for `count` transactions. */
  | { kind: "relayer"; fee: number; opens: Opens | null; count: number }
  /** The fee has to come out of the portfolio's cash and it would not have enough. */
  | { kind: "needsCash"; cash: number; free: number }
  /** An order too small for the venue to pay for. `smallest` is about what it does pay for, in dollars. */
  | { kind: "tooSmall"; smallest: number }
  /** No venue is quoting an order it would pay for. */
  | { kind: "noPrice" }
  /** It cannot be met at this moment. */
  | { kind: "unavailable" };

export type NetworkCostView = {
  label: string;
  value: string;
  tone: "neutral" | "warning";
  explanation: readonly string[];
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

function payable(value: string, explanation: readonly string[] = []): NetworkCostView {
  return { label: copy.label, value, tone: "neutral", explanation, confirmDisabled: false };
}

function notPayable(reason: string): NetworkCostView {
  return {
    label: copy.label,
    value: copy.notAvailable,
    tone: "warning",
    explanation: [reason],
    confirmDisabled: true,
  };
}

function openingReason(opens: Opens | null, count: number): readonly string[] {
  if (!opens) return [];
  return [count > 1 ? copy.openingSeveral(count) : copy.opening[opens]];
}

export function networkCostView(cost: NetworkCostInput): NetworkCostView {
  switch (cost.kind) {
    case "covered":
      return payable(copy.covered);
    case "ownSol":
      return payable(copy.fromOwnSol(cost.usd < ONE_CENT ? null : cost.usd.toFixed(2)));
    case "relayer":
      return payable(feeFigure(cost.fee), openingReason(cost.opens, cost.count));
    case "needsCash":
      return notPayable(
        copy.needsCash(feeFigure(cost.cash), cost.cash < ONE_CENT, symbolAmount("USDC", cost.free)),
      );
    case "tooSmall":
      return notPayable(copy.tooSmall(symbolAmount("USDC", cost.smallest)));
    case "noPrice":
      return notPayable(copy.noPrice);
    case "unavailable":
      return notPayable(copy.notNow);
  }
}
