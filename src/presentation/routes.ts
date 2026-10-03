import { FUNDING } from "../application/pendingActions.js";
import type { Side } from "../domain/order.js";
import type { ReceiveTarget } from "./receive.js";

/**
 * How both apps write and read the parameters of a link, so a link built on
 * one screen means the same on the other platform:
 *
 * - `portfolio=<id>` on every sheet that acts for a portfolio (fund,
 *   receive, send, trade, pie order, pie builder);
 * - `portfolio=funding` where the sheet acts for the funding wallet;
 * - `view=public` on a portfolio's own screen, for its public view;
 * - `reveal=1` on the funding wallet's receive sheet, to open with the
 *   address shown.
 *
 * A route is logged, restored and shared in ways an app does not control, so
 * a parameter is only ever an id, a tracker symbol or one of these words.
 * Anything shaped like an address is refused when it is read.
 */

type Param = string | string[] | undefined;

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Whether a route parameter is a single value that cannot be an address. */
export function isAddressFreeParam(value: Param): value is string {
  return typeof value === "string" && value.length > 0 && !BASE58_ADDRESS.test(value);
}

/** The value of `portfolio=` for the funding wallet. */
export const FUNDING_PARAM = FUNDING;

/** `portfolio=<id>`, or `portfolio=funding` for the funding wallet. */
export function portfolioParams(portfolioId: string): { portfolio: string } {
  return { portfolio: portfolioId };
}

/** The funding wallet's receive sheet, opening with the address shown when `reveal`. */
export function fundingReceiveParams(reveal: boolean): { portfolio: string; reveal?: "1" } {
  return reveal ? { portfolio: FUNDING_PARAM, reveal: "1" } : { portfolio: FUNDING_PARAM };
}

/** A portfolio's own screen opened at its public view. */
export function publicViewParams(): { view: "public" } {
  return { view: "public" };
}

/** The trade sheet: which side, and optionally the tracker and the portfolio. */
export function tradeParams(input: { side: Side; symbol?: string; portfolioId?: string }): {
  side: Side;
  symbol?: string;
  portfolio?: string;
} {
  return {
    side: input.side,
    ...(input.symbol ? { symbol: input.symbol } : {}),
    ...(input.portfolioId ? { portfolio: input.portfolioId } : {}),
  };
}

/** The pie order sheet, investing or rebalancing one pie. */
export function pieOrderParams(
  portfolioId: string,
  mode: "invest" | "rebalance",
): { portfolio: string; mode: "invest" | "rebalance" } {
  return { portfolio: portfolioId, mode };
}

/** The portfolio a sheet acts for, or null when none is given or it is not a portfolio id. */
export function readPortfolioParam(value: Param): string | null {
  return isAddressFreeParam(value) && value !== FUNDING_PARAM ? value : null;
}

/** Whether a sheet was opened for the funding wallet. */
export function readsFunding(value: Param): boolean {
  return value === FUNDING_PARAM;
}

/** Whether a portfolio's screen was opened at its public view. */
export function readPublicView(value: Param): boolean {
  return value === "public";
}

/** The trade side a link asks for; anything else is a buy. */
export function readSide(value: Param): Side {
  return value === "sell" ? "sell" : "buy";
}

/** The pie order mode a link asks for; anything else is investing. */
export function readPieMode(value: Param): "invest" | "rebalance" {
  return value === "rebalance" ? "rebalance" : "invest";
}

/**
 * The receive sheet's target: the funding wallet unless a portfolio id is
 * given. A parameter shaped like an address is refused and falls back to
 * the funding wallet, masked.
 */
export function readReceiveTarget(params: { portfolio?: Param; reveal?: Param }): ReceiveTarget {
  const portfolio = readPortfolioParam(params.portfolio);
  if (portfolio) return { kind: "portfolio", id: portfolio };
  const funding = params.portfolio === undefined || readsFunding(params.portfolio);
  return { kind: "funding", reveal: params.reveal === "1" && funding };
}
