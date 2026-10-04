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

/** The trading fee the app is set up with, in basis points. Unset, null or zero: NoirWire charges none. */
export type CostsState = { tradeFeeBps?: number | null };

/**
 * What things cost, for the Costs row in Settings and under "What does it
 * cost?" on the add-money sheet. `tradeFeeBps` is the trading fee the app is
 * set up with, the figure the trade review itself shows. Where none is set,
 * or it is zero, NoirWire takes no trading fee and the line says exactly that.
 */
export function costsView(state: CostsState): CostsView {
  const copy = settingsCopy.costs;
  const feeBps = state.tradeFeeBps ?? 0;
  return {
    title: copy.title,
    lines: [
      feeBps > 0 ? copy.trade(String(feeBps / 100)) : copy.tradeNoFee,
      copy.move(privateMoveCostText()),
      copy.network,
      copy.gettingUsdc,
      copy.exact,
    ],
  };
}
