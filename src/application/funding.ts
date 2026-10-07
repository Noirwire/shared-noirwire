import { tooPrecise, typedAmount } from "../domain/amount.js";
import { maxPrivateTransfer, privateTransferCosts } from "../domain/privateTransfer.js";

export type FundingInput = {
  /** Whether the asset moves by the private route, rather than as a public transfer. */
  privateRoute: boolean;
  /** The decimals of the asset's token. */
  decimals: number;
  /** What the place the money leaves holds of the asset. */
  fundingBalance: number;
  amountText: string;
};

/** What a move of money into a portfolio would take, and whether the typed amount can go. */
export function fundingDraft(input: FundingInput) {
  const { privateRoute, decimals, fundingBalance } = input;
  const precise = tooPrecise(input.amountText, decimals);
  const customAmount = precise ? 0 : typedAmount(input.amountText);
  const costsOf = (amount: number) => privateTransferCosts(amount, decimals);
  const minimum = privateRoute ? costsOf(0).minimum : 0;
  /** What leaves the funding wallet for `value`: on the private route, the fees come on top. */
  const leaving = (value: number) => (privateRoute ? costsOf(value).total : value);
  const affordable = (value: number) => value >= minimum && leaving(value) <= fundingBalance;
  const amountValid = customAmount > 0 && customAmount <= fundingBalance;
  return {
    customAmount,
    /** The amount was typed with more decimals than the asset has. */
    tooPrecise: precise,
    amountValid,
    minimum,
    leaving,
    affordable,
    canFund: amountValid && affordable(customAmount),
    /** The most that can move: on the private route, what is left once the fees are paid on top. */
    max: privateRoute ? maxPrivateTransfer(fundingBalance, decimals) : Math.max(fundingBalance, 0),
    costsOf,
  };
}

export type FundingDraft = ReturnType<typeof fundingDraft>;
