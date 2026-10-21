import type { Side } from "../order.js";

/**
 * Whether an order should offer to move funds to the spot balance, rather
 * than let a spot buy fail for an empty spot balance. True only when there
 * is somewhere to move funds from: a separate collateral balance that holds
 * some. `collateralAvailable` is null where there is one balance only.
 */
export function needsSpotTransfer(params: {
  isPerp: boolean;
  side: Side;
  hasWallet: boolean;
  canTransfer: boolean;
  spotAvailable: number;
  collateralAvailable: number | null;
}): boolean {
  if (params.isPerp || params.side !== "buy" || !params.hasWallet || !params.canTransfer) {
    return false;
  }
  if (params.collateralAvailable === null) return false;
  return params.spotAvailable <= 0 && params.collateralAvailable > 0;
}
