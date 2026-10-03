import type { NetworkCost, Opens } from "../domain/networkCost.js";
import type { RelayerQuote } from "./ports.js";
import { readWithRetries } from "./retries.js";

/**
 * Every action has a network cost, charged by the network in SOL. Nobody
 * using this app should have to know that, hold SOL or go and fetch any, so
 * a portfolio's cost is met in one of three ways and the review states which,
 * with the amount:
 *
 * - NoirWire's relayer pays the network and the portfolio pays it back in
 *   USDC, a few cents, inside the same transaction. That is how every action
 *   the app builds itself is paid for, sends, Earn and opening a token
 *   account, whether or not the portfolio holds SOL.
 * - The venue pays, for a trade it builds a paid-for order for. Nothing is
 *   charged apart from the trade's own fee.
 * - The portfolio pays out of SOL it happens to hold, only when neither of
 *   the others does, and the review says so and what it comes to: SOL is the
 *   user's money like any other, and is not spent without being shown.
 *
 * There is no fourth way. When none of the three applies the action cannot
 * be done at that moment and the review says so, plainly, with nothing
 * charged. The funding wallet never pays: a fee it paid would name both
 * addresses in one transaction.
 */

/** What a confirmed action tells the run about the review it was confirmed on. */
export type CostAgreed = {
  /** The fee that review showed, when it showed the relayer paying. */
  relayerFeeRaw?: bigint;
  onStep?: (step: "covering" | "acting") => void;
};

/** The terms a confirmation carries from the cost its review showed. */
export function costAgreed(cost: NetworkCost | null): { relayerFeeRaw?: bigint } {
  return cost?.kind === "relayer" ? { relayerFeeRaw: cost.feeRaw } : {};
}

/** What working out a cost reads from the chain about the portfolio's own SOL. */
export type CostChain = {
  /** The portfolio's SOL balance, in lamports. */
  balance(owner: string): Promise<number>;
  /** The lamports it would need to pay `lamportsOut` itself, or null when it already can. */
  shortfall(balance: number, lamportsOut: number): Promise<{ required: number } | null>;
};

type Need = {
  /** The paying portfolio's address. */
  owner: string;
  /** What the action takes from the portfolio's own balance when it pays the network itself. */
  lamportsNeeded: number;
  /** Cash the portfolio has left once the action has taken its own. */
  cashFree: number;
  /** Dollars per SOL from this site's price index, for stating a cost the portfolio pays in SOL. */
  solPrice?: number;
  /**
   * Prices the action with the fee relayer, for the actions it pays for.
   * Left out, or failing for any reason, the action is not available.
   */
  relayer?: {
    quote: () => Promise<RelayerQuote>;
    opens: Opens;
    /** True when the action brings in the cash that pays the relayer: a withdrawal. It then needs none beforehand. */
    paidFromProceeds?: boolean;
    /** How many transactions the relayer pays for. One unless said otherwise. */
    count?: number;
  };
};

const CASH_UNIT = 1_000_000;

const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * Works out, before the review is shown, how the action's network cost is
 * met. The relayer is asked first, whatever the portfolio holds. Only when
 * it cannot be used does a portfolio's own SOL pay, and only when there is a
 * live price to state that cost in dollars with: a cost that cannot be shown
 * is not charged. Each read is asked for again on a busy moment; nothing here
 * signs or sends.
 */
export async function planNetworkCost(need: Need, chain: CostChain): Promise<NetworkCost> {
  const { owner, lamportsNeeded, cashFree, relayer, solPrice } = need;
  if (lamportsNeeded <= 0) return { kind: "covered" };

  const quoted = relayer ? await readWithRetries(relayer.quote).catch(() => null) : null;
  if (quoted && relayer) {
    const count = relayer.count ?? 1;
    const fee = (Number(quoted.feeRaw) * count) / CASH_UNIT;
    // Half a raw unit of slack: `cashFree` is a difference of two rounded display amounts.
    if (!relayer.paidFromProceeds && cashFree + 0.5 / CASH_UNIT < fee) {
      return { kind: "needsCash", cash: fee, free: Math.max(cashFree, 0) };
    }
    return {
      kind: "relayer",
      fee,
      feeRaw: quoted.feeRaw,
      opens: quoted.opensAccount ? relayer.opens : null,
      count,
    };
  }

  const balance = await readWithRetries(() => chain.balance(owner));
  const shortfall = await readWithRetries(() => chain.shortfall(balance, lamportsNeeded));
  if (shortfall !== null || !solPrice) {
    return { kind: "unavailable" };
  }
  return { kind: "ownSol", usd: (lamportsNeeded / LAMPORTS_PER_SOL) * solPrice };
}

/**
 * The network cost of a send, and the amount that will really be sent.
 *
 * Cash that is sent cannot also pay the cost. A send of everything the
 * portfolio has in cash, when the relayer's fee has to come out of that
 * cash, is therefore a send of the rest, and the review says so before
 * anything is confirmed. Any other amount is left as typed: one that leaves
 * too little to spare is answered with `needsCash`, not quietly reduced.
 */
export async function planSendCost(
  send: {
    owner: string;
    lamportsNeeded: number;
    /** Whether the asset sent is the cash the cost is paid from. */
    isCash: boolean;
    amount: number;
    /** What the portfolio holds of the asset sent, and of cash. */
    held: number;
    cashHeld: number;
    decimals: number;
    solPrice?: number;
    /** Prices the send with the fee relayer. Asked at most once, however often the cost is worked out. */
    relayerQuote?: () => Promise<RelayerQuote>;
  },
  chain: CostChain,
): Promise<{ cost: NetworkCost; amount: number }> {
  const { owner, lamportsNeeded, isCash, amount, held, relayerQuote } = send;
  let quoted: Promise<RelayerQuote> | undefined;
  const relayer = relayerQuote && {
    quote: () => (quoted ??= relayerQuote()),
    opens: "recipient" as const,
  };
  const costOf = (sent: number) =>
    planNetworkCost(
      {
        owner,
        lamportsNeeded,
        cashFree: isCash ? held - sent : send.cashHeld,
        solPrice: send.solPrice,
        relayer,
      },
      chain,
    );
  const cost = await costOf(amount);
  if (cost.kind !== "needsCash" || !isCash || amount !== held || held <= cost.cash) {
    return { cost, amount };
  }
  const unit = 10 ** send.decimals;
  const rest = Math.round((held - cost.cash) * unit) / unit;
  return { cost: await costOf(rest), amount: rest };
}
