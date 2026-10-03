import { reconcileTrackers, sameTrackerAmounts } from "../../domain/holdings.js";
import { activePortfolios } from "../portfolio.js";
import type { PriceReader, Track, WalletStore } from "../ports.js";
import { hasFunds, mapPortfolio, setRealHolding } from "../walletRecord.js";
import type { Refresh } from "./common.js";

/** What re-reading balances asks of the chain. Reading needs only an address; nothing is signed. */
export type BalanceChain = {
  /** One real balance of `symbol` held by `address`. Rejects for a symbol with no asset behind it. */
  balanceOf(address: string, symbol: string): Promise<number>;
  /** Everything one portfolio holds, in a single request: its cash and SOL, and every tracker. */
  portfolioBalances(
    address: string,
  ): Promise<{ cash: Record<string, number>; trackers: Record<string, number> }>;
  /** The funding wallet's SOL and cash. */
  cashBalances(address: string): Promise<Record<string, number>>;
};

export type BalanceDeps = {
  store: WalletStore;
  chain: BalanceChain;
  prices: Pick<PriceReader, "price" | "isPosition">;
  track: Track;
  /** The portfolios in an order that says nothing about when each was created. */
  shuffle<T>(items: T[]): T[];
};

/**
 * Keeps the stored balances in step with the chain. A read that comes back
 * after another tab swapped the wallet is dropped, and a refresh of every
 * portfolio asked for while one is running joins it.
 */
export function createBalanceRefresh(deps: BalanceDeps) {
  const { store, chain, prices } = deps;
  let refreshingAll: Promise<void> | null = null;

  /**
   * Re-reads the funding wallet's real balance of `symbol` and stores it, in
   * case it drifted (e.g. an external deposit). Dropped if another tab swapped
   * the wallet while the read was in flight.
   */
  async function funding(address: string, symbol: string): Promise<number> {
    const balance = await chain.balanceOf(address, symbol);
    const before = store.snapshot()?.funding;
    if (before?.address === address && !hasFunds(before) && balance > 0) {
      deps.track("deposit_detected");
    }
    store.update((wallet) =>
      wallet.funding.address !== address
        ? wallet
        : symbol === "SOL"
          ? { ...wallet, funding: { ...wallet.funding, sol: balance } }
          : {
              ...wallet,
              funding: {
                ...wallet.funding,
                tokens: { ...wallet.funding.tokens, [symbol]: balance },
              },
            },
    );
    return balance;
  }

  /** Re-reads one portfolio's real balance of `symbol` and stores it under that symbol's holding. */
  async function portfolioAsset(id: string, address: string, symbol: string): Promise<number> {
    const balance = await chain.balanceOf(address, symbol);
    store.update((wallet) =>
      mapPortfolio(wallet, id, (entry) =>
        entry.address === address ? setRealHolding(prices, entry, symbol, balance) : entry,
      ),
    );
    return balance;
  }

  /**
   * Re-reads everything one portfolio holds (SOL, cash and every tracker) in a
   * single request and stores it. The chain decides which trackers are held
   * and how much of each; see `reconcileTrackers` for what happens to cost.
   * False when the read failed, so a caller about to size orders can stop.
   */
  async function portfolioCash(id: string, address: string): Promise<boolean> {
    const seen = store.snapshot()?.portfolios.find((entry) => entry.id === id)?.holdings ?? [];
    const balances = await chain.portfolioBalances(address).catch(() => null);
    if (!balances) return false;
    const { cash, trackers } = balances;
    store.update((wallet) =>
      mapPortfolio(wallet, id, (entry) => {
        if (entry.address !== address) return entry;
        const withCash = Object.entries(cash).reduce(
          (next, [symbol, amount]) => setRealHolding(prices, next, symbol, amount),
          entry,
        );
        // A trade recorded while the read was on its way knows what it bought
        // and for how much. A read from before it would undo that, so the
        // trackers wait for the next refresh.
        if (!sameTrackerAmounts(seen, entry.holdings, trackers)) return withCash;
        return { ...withCash, holdings: reconcileTrackers(withCash.holdings, trackers) };
      }),
    );
    return true;
  }

  /**
   * Re-reads every active portfolio from the chain: one request each, one
   * after another and in no particular order, so no request names two
   * portfolios and the order they arrive in does not spell out the order they
   * were created in. A refresh asked for while one is running joins it.
   */
  function allPortfolios(): Promise<void> {
    refreshingAll ??= (async () => {
      const wallet = store.snapshot();
      for (const portfolio of wallet ? deps.shuffle(activePortfolios(wallet)) : []) {
        if (!store.isUnlocked()) return;
        await portfolioCash(portfolio.id, portfolio.address);
      }
    })().finally(() => {
      refreshingAll = null;
    });
    return refreshingAll;
  }

  /**
   * Re-reads the funding wallet's SOL and cash balances and stores them, in
   * case they drifted (an external deposit). Reading needs only the address,
   * so nothing is derived from the phrase.
   */
  async function fundingBalances(): Promise<void> {
    const current = store.snapshot();
    if (!current) return;
    const { address } = current.funding;
    const balances = await chain.cashBalances(address).catch(() => null);
    if (!balances) return;
    const { SOL: sol, ...tokens } = balances;
    if (!hasFunds(current.funding) && Object.values(balances).some((amount) => amount > 0)) {
      deps.track("deposit_detected");
    }
    store.update((wallet) =>
      wallet.funding.address !== address
        ? wallet
        : {
            ...wallet,
            funding: { ...wallet.funding, sol, tokens: { ...wallet.funding.tokens, ...tokens } },
          },
    );
  }

  /**
   * Re-reads one portfolio's SOL, cash and tracker balances and stores them.
   * Returns the portfolio as it now stands, or undefined unless every read
   * succeeded - a caller sizing orders from the result must not size them
   * from a stale one.
   */
  async function portfolioBalances(id: string) {
    const portfolio = store.snapshot()?.portfolios.find((entry) => entry.id === id);
    if (!portfolio || !(await portfolioCash(id, portfolio.address))) return undefined;
    return store.snapshot()?.portfolios.find((entry) => entry.id === id);
  }

  const refresh: Refresh = { funding, portfolioAsset, portfolioCash };
  return { ...refresh, allPortfolios, fundingBalances, portfolioBalances };
}

export type BalanceRefresh = ReturnType<typeof createBalanceRefresh>;
