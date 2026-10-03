import { tooPrecise, typedAmount } from "../domain/amount.js";
import type { NetworkCost } from "../domain/networkCost.js";

export type EarnAction = "deposit" | "withdraw";

/**
 * An amount this portfolio could really move, which is all the relayer needs
 * to price an Earn action: its cost does not depend on the amount.
 */
export function earnSample(action: EarnAction, cash: number, deposited: number | undefined) {
  return Math.min(action === "deposit" ? cash : (deposited ?? 0), 1);
}

/** The decimals of the cash Earn lends, USDC. */
export const EARN_CASH_DECIMALS = 6;

/** What an Earn deposit or withdrawal of the typed amount can move. */
export function earnDraft(input: {
  action: EarnAction;
  amountText: string;
  cash: number;
  /** What the portfolio has in Earn, or undefined while it is not known. */
  deposited: number | undefined;
  cost: NetworkCost | null;
}) {
  const { action, cost } = input;
  const precise = tooPrecise(input.amountText, EARN_CASH_DECIMALS);
  const amount = precise ? 0 : typedAmount(input.amountText);
  // Cash that pays the network cost cannot also be lent.
  const kept = cost?.kind === "relayer" && action === "deposit" ? cost.fee : 0;
  const max = action === "deposit" ? Math.max(input.cash - kept, 0) : (input.deposited ?? 0);
  const valid = amount > 0 && amount <= max;
  return { amount, max, valid, tooPrecise: precise };
}

export type EarnDraft = ReturnType<typeof earnDraft>;
