import { networkCostCopy } from "./networkCost.js";

/** What a money action is answered with when it is refused before anything is signed. */
export const refusalCopy = {
  actionPending:
    "Your last action from this portfolio was sent and is not confirmed yet. Nothing more can be confirmed here until that is known. This takes about a minute.",
  costUnavailable: networkCostCopy.notNow,
} as const;
