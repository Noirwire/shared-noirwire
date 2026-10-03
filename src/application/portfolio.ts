import type { Catalog } from "./catalog.js";
import { uncostedOf } from "../domain/holdings.js";
import type { Portfolio, Holding, Wallet } from "../domain/wallet.js";

/** The USDC balance available to spend on a buy. */
export function cashOf(portfolio: Portfolio) {
  return portfolio.holdings.find((holding) => holding.symbol === "USDC")?.amount ?? 0;
}

export function activePortfolios(wallet: Wallet) {
  return wallet.portfolios.filter((portfolio) => portfolio.archivedAt === null);
}

export function archivedPortfolios(wallet: Wallet) {
  return wallet.portfolios.filter((portfolio) => portfolio.archivedAt !== null);
}

/** What a wallet's portfolios are worth and how they moved, by the prices `catalog` reads. */
export function createPortfolioReads(
  catalog: Pick<Catalog, "asset" | "isLivePrice" | "price" | "isPosition">,
) {
  const { asset, isLivePrice, price, isPosition } = catalog;

  /** Weighted 24h move of a flat list of holdings, unconditional on live-ness. */
  function weightedDayChange(holdings: Holding[]) {
    let weighted = 0;
    let base = 0;
    for (const holding of holdings) {
      const entry = asset(holding.symbol);
      if (!entry || entry.kind === "cash") continue;
      const value = holdingValue(holding);
      base += value;
      weighted += value * (entry.change24h / 100);
    }
    return { usd: weighted, percent: base > 0 ? (weighted / base) * 100 : 0 };
  }

  function portfoliosHaveLivePrices(portfolios: Portfolio[], updatedAt: number | null) {
    return (
      updatedAt !== null &&
      portfolios.every((portfolio) =>
        portfolio.holdings.every(
          (holding) =>
            holding.amount <= 0 || holding.symbol === "USDC" || isLivePrice(holding.symbol),
        ),
      )
    );
  }

  function portfoliosHaveInvestments(portfolios: Portfolio[]) {
    return portfolios.some((portfolio) =>
      portfolio.holdings.some((holding) => holding.amount > 0 && holding.symbol !== "USDC"),
    );
  }

  function holdingValue(holding: Holding) {
    return holding.amount * price(holding.symbol);
  }

  /** Every held position, which is what the investing surfaces care about. Cash is not a position. */
  function investedHoldings(portfolio: Portfolio) {
    return portfolio.holdings.filter((holding) => isPosition(holding.symbol) && holding.amount > 0);
  }

  function portfolioValue(portfolio: Portfolio) {
    return portfolio.holdings.reduce((sum, holding) => sum + holdingValue(holding), 0);
  }

  function totalValue(wallet: Wallet) {
    return activePortfolios(wallet).reduce((sum, portfolio) => sum + portfolioValue(portfolio), 0);
  }

  /**
   * The weighted 24h move for a set of portfolios, or null unless every price
   * across them is live and at least one of them actually holds an investment.
   * Shared by the Home total (portfolioOverview's `day`) and each portfolio's
   * own line, so both read the same "only while live" rule.
   */
  function dayChangeFor(portfolios: Portfolio[], updatedAt: number | null) {
    if (
      !portfoliosHaveLivePrices(portfolios, updatedAt) ||
      !portfoliosHaveInvestments(portfolios)
    ) {
      return null;
    }
    return weightedDayChange(portfolios.flatMap((portfolio) => portfolio.holdings));
  }

  /**
   * One portfolio's 24h move for the portfolio list, by the same rule as the
   * Home total, or null when it holds no tracker at all: cash on its own, or
   * the SOL kept for network fees, is not a position to report a day on.
   */
  function portfolioDayChange(portfolio: Portfolio, updatedAt: number | null) {
    return investedHoldings(portfolio).length > 0 ? dayChangeFor([portfolio], updatedAt) : null;
  }

  function portfolioOverview(wallet: Wallet, updatedAt: number | null) {
    const portfolios = activePortfolios(wallet);
    const positions = new Map<string, number>();
    let cash = 0;
    let invested = 0;
    let hasInvestments = false;
    for (const portfolio of portfolios) {
      cash += cashOf(portfolio);
      for (const holding of portfolio.holdings) {
        if (holding.amount > 0 && holding.symbol !== "USDC") hasInvestments = true;
        if (!isPosition(holding.symbol) || holding.amount <= 0) continue;
        invested += holdingValue(holding);
        positions.set(holding.symbol, (positions.get(holding.symbol) ?? 0) + holding.amount);
      }
    }
    return {
      portfolios,
      positions,
      cash,
      invested,
      total: totalValue(wallet),
      valued: hasCurrentValuation(wallet, updatedAt),
      hasInvestments,
      /** The day's move of everything that is not cash, only while every price is live. */
      day: dayChangeFor(portfolios, updatedAt),
    };
  }

  /** The same holding can sit in several portfolios; the markets view needs it summed. */
  function positionAcross(wallet: Wallet, symbol: string) {
    let amount = 0;
    let cost = 0;
    let uncosted = 0;
    for (const portfolio of activePortfolios(wallet)) {
      for (const holding of portfolio.holdings) {
        if (holding.symbol !== symbol) continue;
        amount += holding.amount;
        cost += holding.cost;
        uncosted += uncostedOf(holding);
      }
    }
    // `cost` covers `amount - uncosted` only; the rest was never seen bought.
    return { amount, cost, uncosted, value: amount * price(symbol) };
  }

  /** A dollar total needs a current price for every non-cash asset it includes. */
  function hasCurrentValuation(wallet: Wallet, updatedAt: number | null): boolean {
    if (updatedAt === null) {
      return activePortfolios(wallet).every((portfolio) =>
        portfolio.holdings.every((holding) => holding.amount <= 0 || holding.symbol === "USDC"),
      );
    }
    return activePortfolios(wallet).every((portfolio) =>
      portfolio.holdings.every((holding) => holding.amount <= 0 || isLivePrice(holding.symbol)),
    );
  }

  return {
    holdingValue,
    investedHoldings,
    portfolioValue,
    totalValue,
    dayChangeFor,
    portfolioDayChange,
    portfolioOverview,
    positionAcross,
  };
}
