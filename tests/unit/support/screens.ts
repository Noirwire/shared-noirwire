import { createCatalog, type LivePrice } from "../../../src/application/catalog.js";
import { createScreenReads } from "../../../src/application/screenReads.js";
import type { Activity, Holding, Portfolio, Wallet } from "../../../src/domain/wallet.js";
import { ALL_STOCKS } from "../../../src/infrastructure/solana/tokenRegistry.js";

/** The live prices a screen test reads; a tracker's multiplier is 1. */
export const TEST_PRICES: Record<string, LivePrice> = {
  NVDAx: { usd: 100, change24h: 2 },
  SPYx: { usd: 500, change24h: -1 },
  TSLAx: { usd: 200, change24h: 0 },
};

/** When the test prices were read. Any number will do: only null means "no live price". */
export const UPDATED_AT = 1_750_000_000_000;

/** A read that came back whole at `UPDATED_AT`. */
export const READ = { succeededAt: UPDATED_AT, lastAttemptFailed: false };

/** Everything a screen shows was read just now. */
export const FRESH = { now: UPDATED_AT, balances: READ, prices: READ, chart: READ };

/** The screen reads over the real stock list, with `TEST_PRICES` as the live feed. */
export function testReads(prices: Record<string, LivePrice> = TEST_PRICES) {
  return createScreenReads(
    createCatalog({
      stocks: ALL_STOCKS,
      livePrice: (symbol) => prices[symbol],
      stockMultiplier: () => 1,
    }),
  );
}

export const FUNDING_ADDRESS = "Fund1111111111111111111111111111111111111111";
export const PORTFOLIO_ADDRESS = "Port1111111111111111111111111111111111111111";

export function holding(symbol: string, amount: number, cost = 0): Holding {
  return { symbol, amount, cost };
}

/** Sets one holding of a portfolio, adding it when absent. */
export function withHolding(portfolio: Portfolio, entry: Holding): Portfolio {
  const others = portfolio.holdings.filter((item) => item.symbol !== entry.symbol);
  return { ...portfolio, holdings: [...others, entry] };
}

let nextId = 0;

export function activity(
  entry: Partial<Activity> & Pick<Activity, "portfolioId" | "kind">,
): Activity {
  nextId += 1;
  return { id: `act-${nextId}`, at: Date.now(), symbol: "USDC", amount: 100, usd: 100, ...entry };
}

/** A wallet with one empty, active portfolio named "Investing", changed by `shape`. */
export function testWallet(shape: (wallet: Wallet) => Wallet = (wallet) => wallet): Wallet {
  return shape({
    createdAt: 1_750_000_000_000,
    derivationScheme: "app",
    funding: { address: FUNDING_ADDRESS, sol: 0, tokens: {} },
    portfolios: [
      {
        id: "acc_1",
        label: "Investing",
        address: PORTFOLIO_ADDRESS,
        derivationIndex: 1,
        createdAt: new Date(2026, 8, 3).getTime(),
        archivedAt: null,
        holdings: [],
      },
    ],
    activity: [],
    watchlist: [],
  });
}

/** The wallet with its first portfolio changed by `shape`. */
export function withFirst(shape: (first: Portfolio) => Portfolio, extra: Partial<Wallet> = {}) {
  return testWallet((wallet) => ({
    ...wallet,
    ...extra,
    portfolios: [shape(wallet.portfolios[0]), ...wallet.portfolios.slice(1)],
  }));
}
