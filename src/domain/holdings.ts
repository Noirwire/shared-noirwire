import type { Holding } from "./wallet.js";

/**
 * How a tracker holding follows the chain. The chain is the truth for how
 * much is held. What it cannot say is what was paid: a tracker that arrived
 * from outside, or one found by a wallet restored on a new device, was never
 * seen being bought here. That part is recorded as `uncosted`, so nothing
 * downstream can read a missing price as a price of zero and report the
 * whole value as profit.
 */

/** The part of a holding's amount with no recorded cost. Never more than the amount itself. */
export function uncostedOf(holding: Holding): number {
  return Math.min(holding.uncosted ?? 0, holding.amount);
}

function holdingOf(symbol: string, amount: number, cost: number, uncosted: number): Holding {
  return uncosted > 0 ? { symbol, amount, cost, uncosted } : { symbol, amount, cost };
}

/**
 * A holding set to the amount just read from the chain, when no trade here
 * explains the difference. More than was recorded arrived from somewhere
 * this browser did not see, so it is uncosted. Less than was recorded left
 * the same way: the uncosted part is taken to go first, and once that is
 * gone the recorded cost shrinks in proportion to what is left of the part
 * it was paid for.
 */
export function withChainAmount(holding: Holding, amount: number): Holding {
  const uncosted = uncostedOf(holding);
  if (amount >= holding.amount) {
    return holdingOf(holding.symbol, amount, holding.cost, uncosted + (amount - holding.amount));
  }
  const uncostedLeft = Math.max(uncosted - (holding.amount - amount), 0);
  const costedBefore = holding.amount - uncosted;
  const costedLeft = amount - uncostedLeft;
  const cost = costedBefore > 0 ? holding.cost * (costedLeft / costedBefore) : 0;
  return holdingOf(holding.symbol, amount, cost, uncostedLeft);
}

/**
 * A tracker holding after a trade this browser placed, given the balance the
 * chain shows afterwards. A buy adds the cash that left to the cost. A sell
 * takes the sold share off the cost and off the uncosted part alike, since
 * there is no telling which tokens were the ones sold.
 */
export function afterTrade(
  before: Holding,
  trade: { side: "buy" | "sell"; spend: number },
  balance: number,
): Holding {
  if (balance <= 0) return holdingOf(before.symbol, 0, 0, 0);
  const uncosted = uncostedOf(before);
  if (trade.side === "buy") {
    return holdingOf(
      before.symbol,
      balance,
      before.cost + trade.spend,
      Math.min(uncosted, balance),
    );
  }
  const kept = before.amount > 0 ? 1 - Math.min(trade.spend / before.amount, 1) : 0;
  return holdingOf(
    before.symbol,
    balance,
    Math.max(before.cost * kept, 0),
    Math.min(uncosted * kept, balance),
  );
}

/**
 * The stored holdings brought into line with what the chain holds of each
 * tracker in `chain`, which names every tracker that was read. One the chain
 * holds and the record lacks appears, uncosted. One the record holds and the
 * chain does not is removed. Anything `chain` does not name (cash, SOL) is
 * left as it is.
 */
export function reconcileTrackers(holdings: Holding[], chain: Record<string, number>): Holding[] {
  const recorded = new Set(holdings.map((holding) => holding.symbol));
  const kept = holdings.flatMap((holding) => {
    const amount = chain[holding.symbol];
    if (amount === undefined) return [holding];
    return amount > 0 ? [withChainAmount(holding, amount)] : [];
  });
  const arrived = Object.entries(chain)
    .filter(([symbol, amount]) => amount > 0 && !recorded.has(symbol))
    .map(([symbol, amount]) => holdingOf(symbol, amount, 0, amount));
  return [...kept, ...arrived];
}

/** Whether the holdings of the trackers named in `chain` are the same in both lists. */
export function sameTrackerAmounts(
  a: Holding[],
  b: Holding[],
  chain: Record<string, number>,
): boolean {
  const amounts = (holdings: Holding[]) =>
    holdings
      .filter((holding) => holding.symbol in chain && holding.amount > 0)
      .map((holding) => `${holding.symbol}:${holding.amount}`)
      .sort()
      .join();
  return amounts(a) === amounts(b);
}
