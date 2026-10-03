import { withChainAmount } from "../domain/holdings.js";
import { ageBand, countBand, tradeBand } from "../domain/usageEvents.js";
import {
  MAX_ACTIVITY_ENTRIES,
  type Activity,
  type Holding,
  type Portfolio,
  type Wallet,
} from "../domain/wallet.js";
import type { PriceReader } from "./ports.js";

/** How every use case reads and changes the wallet record, without touching the chain. */

export const positive = (value: number) => Number.isFinite(value) && value > 0;

export function randomId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** The newest `MAX_ACTIVITY_ENTRIES` of `activity`, newest first. A list within the limit is left as it is. */
function newestKept(activity: Activity[]): Activity[] {
  if (activity.length <= MAX_ACTIVITY_ENTRIES) return activity;
  return [...activity].sort((a, b) => b.at - a.at).slice(0, MAX_ACTIVITY_ENTRIES);
}

/**
 * Adds an entry to the activity log. A stock amount is also recorded as it is
 * shown today, so a later dividend or split cannot rewrite what was traded.
 * The list is newest first and keeps `MAX_ACTIVITY_ENTRIES`: the oldest are
 * dropped as new ones are written. Only this list is cut. A portfolio's
 * pending action, and the entry it will write if it lands, are not in it.
 */
export function logged(
  wallet: Wallet,
  entry: Omit<Activity, "id" | "at" | "shown">,
  prices: Pick<PriceReader, "isPosition" | "shownUnits">,
): Wallet {
  const shown = prices.isPosition(entry.symbol)
    ? prices.shownUnits(entry.symbol, entry.amount)
    : undefined;
  return {
    ...wallet,
    activity: newestKept([
      { ...entry, ...(shown === undefined ? {} : { shown }), id: randomId("act"), at: Date.now() },
      ...wallet.activity,
    ]),
  };
}

export function mapPortfolio(
  wallet: Wallet,
  id: string,
  change: (portfolio: Portfolio) => Portfolio,
) {
  return {
    ...wallet,
    portfolios: wallet.portfolios.map((portfolio) =>
      portfolio.id === id ? change(portfolio) : portfolio,
    ),
  };
}

export function activePortfolio(wallet: Wallet, id: string): Portfolio | undefined {
  return wallet.portfolios.find((entry) => entry.id === id && entry.archivedAt === null);
}

export function hasFunds(funding: Wallet["funding"]) {
  return funding.sol > 0 || Object.values(funding.tokens).some((amount) => amount > 0);
}

/** Puts `next` in place of the portfolio's holding of the same symbol, or adds it. */
export function setHolding(portfolio: Portfolio, next: Holding) {
  const holdings = portfolio.holdings.some((holding) => holding.symbol === next.symbol)
    ? portfolio.holdings.map((holding) => (holding.symbol === next.symbol ? next : holding))
    : [...portfolio.holdings, next];
  return { ...portfolio, holdings };
}

export function holdingIn(portfolio: Portfolio, symbol: string): Holding {
  return (
    portfolio.holdings.find((holding) => holding.symbol === symbol) ?? {
      symbol,
      amount: 0,
      cost: 0,
    }
  );
}

/**
 * Writes a just-read on-chain balance, deciding what happens to the cost
 * basis by what kind of asset it is.
 *
 * Cash and SOL are marked to their own value, so they read as neither a gain
 * nor a loss - there is no meaningful "buy price" for a deposit, and folding
 * one in would report a profit every time the wallet was topped up.
 *
 * A position keeps the cost it already has. A background balance refresh is
 * not a trade and must not silently reprice what was paid; only the buy and
 * sell paths, which know the cash that actually changed hands, move it. What
 * the chain holds beyond what was bought here has no cost on record, and is
 * kept apart as such instead of being read as bought for nothing (see
 * `withChainAmount`).
 */
export function setRealHolding(
  prices: Pick<PriceReader, "price" | "isPosition">,
  portfolio: Portfolio,
  symbol: string,
  amount: number,
) {
  if (!prices.isPosition(symbol)) {
    return setHolding(portfolio, { symbol, amount, cost: amount * prices.price(symbol) });
  }
  return setHolding(portfolio, withChainAmount(holdingIn(portfolio, symbol), amount));
}

/**
 * The addresses a relayer-paid transaction of `portfolio` must not name: the
 * funding wallet and every other portfolio, archived ones included, because
 * one transaction naming two of them joins them on chain. A recipient the
 * user chose among them is left out; the review warns about that link and
 * has it acknowledged.
 */
export function othersOf(wallet: Wallet, portfolio: Portfolio, recipient?: string): string[] {
  return [wallet.funding.address, ...wallet.portfolios.map((entry) => entry.address)].filter(
    (address) => address !== portfolio.address && address !== recipient,
  );
}

/**
 * The wallet's state at unlock, in bands and yes/no answers: how old it is,
 * how much it has been organised, whether money and investments are in it,
 * and whether this browser's own history shows it funding or trading before
 * (a wallet imported here after doing either elsewhere reads as "no").
 * This is what shows who came back and who converted, without an event
 * marking when any transaction happened.
 */
export function walletUsage(wallet: Wallet, prices: Pick<PriceReader, "isPosition">) {
  const active = wallet.portfolios.filter((portfolio) => portfolio.archivedAt === null);
  const holdings = active.flatMap((portfolio) => portfolio.holdings);
  const did = (...kinds: string[]) => wallet.activity.some((entry) => kinds.includes(entry.kind));
  const funded = hasFunds(wallet.funding) || holdings.some((holding) => holding.amount > 0);
  const invested = holdings.some(
    (holding) => prices.isPosition(holding.symbol) && holding.amount > 0,
  );
  const yesNo = (value: boolean) => (value ? "yes" : "no");
  return {
    age: ageBand(wallet.createdAt, Date.now()),
    accounts: countBand(active.length),
    pies: countBand(active.filter((portfolio) => portfolio.pie).length),
    trades: tradeBand(wallet.activity.filter((e) => e.kind === "buy" || e.kind === "sell").length),
    funded: yesNo(funded),
    invested: yesNo(invested),
    has_funded: yesNo(funded || did("fund")),
    has_traded: yesNo(invested || did("buy", "sell")),
  } as const;
}
