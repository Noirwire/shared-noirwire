/**
 * Whose token account an action opens, which is what makes its cost larger:
 * the recipient's, or this portfolio's own for Earn, for a tracker it is
 * buying for the first time, or for the cash a withdrawal returns.
 */
export type Opens = "recipient" | "earn" | "holding" | "cash";

/** How the network cost of one action is met, as the review states it. */
export type NetworkCost =
  /** The venue pays it, or there is nothing to pay. */
  | { kind: "covered" }
  /** The portfolio pays it from its own SOL, worth about `usd` dollars at the current price. */
  | { kind: "ownSol"; usd: number }
  /**
   * NoirWire's relayer pays the network and is paid `fee` of the portfolio's
   * cash. `opens` says whose token account that includes opening, which is
   * most of the cost when it does. `feeRaw` is what each relayed transaction
   * carries: one, except for a pie, which opens `count` holdings in turn.
   */
  | { kind: "relayer"; fee: number; feeRaw: bigint; opens: Opens | null; count: number }
  /** The relayer's fee has to come out of the portfolio's cash and it would not have enough. */
  | { kind: "needsCash"; cash: number; free: number }
  /** An order too small for the venue to pay for. `smallest` is about what it does pay for, in dollars. */
  | { kind: "tooSmall"; smallest: number }
  /** No venue is quoting an order it would pay for. */
  | { kind: "noPrice" }
  /** It cannot be met at this moment. Nothing was charged; trying again later is all there is to do. */
  | { kind: "unavailable" };
