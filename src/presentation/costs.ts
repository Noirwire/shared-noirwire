import { TRADE_CASH_DECIMALS } from "../application/trade.js";
import { settingsCopy } from "../copy/settings.js";
import { usd } from "../domain/format.js";
import { PRIVACY_FEE_BPS, privateTransferCosts } from "../domain/privateTransfer.js";

/**
 * What a private move costs, as it is said everywhere: its share of the
 * amount plus its flat fee, "0.1% + $0.20". Both figures are read from the
 * constants the review charges by, so the sentence cannot drift from the charge.
 */
export function privateMoveCostText(): string {
  const flat = privateTransferCosts(0, TRADE_CASH_DECIMALS).relayFee;
  return `${PRIVACY_FEE_BPS / 100}% + ${usd(flat)}`;
}

export type CostsView = { title: string; lines: string[] };

/**
 * What things cost, for the Costs row in Settings and wherever "What does it
 * cost?" leads. `tradeFeeBps` is the trading fee the app is set up with, the
 * figure the trade review itself shows; where none is set there is no number
 * to state, and the line says where the fee is shown.
 */
export function costsView(state: { tradeFeeBps: number }): CostsView {
  const copy = settingsCopy.costs;
  return {
    title: copy.title,
    lines: [
      state.tradeFeeBps > 0 ? copy.trade(String(state.tradeFeeBps / 100)) : copy.tradeAtReview,
      copy.move(privateMoveCostText()),
      copy.network,
      copy.gettingUsdc,
      copy.exact,
    ],
  };
}
