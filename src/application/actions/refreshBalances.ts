import { reconcileTrackers, sameTrackerAmounts } from "../../domain/holdings.js";
import type { Wallet } from "../../domain/wallet.js";
import { FUNDING } from "../pendingActions.js";
import { activePortfolios } from "../portfolio.js";
import type { PriceReader, Track, WalletStore } from "../ports.js";
import { readWithRetries } from "../retries.js";
import {
  anyActionPending,
  fundingBalance,
  hasFunds,
  logged,
  mapPortfolio,
  setRealHolding,
  withFundingBalance,
} from "../walletRecord.js";
import type { Refresh } from "./common.js";

/** The smallest amount of SOL, the finest unit of anything the funding wallet's read returns. */
const SOL_UNIT = 1_000_000_000;

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
  prices: PriceReader;
  track: Track;
  /** The portfolios in an order that says nothing about when each was created. */
  shuffle<T>(items: T[]): T[];
};

/**
 * Keeps the stored balances in step with the chain. A read that comes back
 * after another tab swapped the wallet is dropped, and a refresh of every
 * portfolio asked for while one is running joins it. Every read here is asked
 * for again on a busy moment before it counts as failed (`readWithRetries`).
 */
export function createBalanceRefresh(deps: BalanceDeps) {
  const { store, prices } = deps;
  const chain: BalanceChain = {
    balanceOf: (address, symbol) => readWithRetries(() => deps.chain.balanceOf(address, symbol)),
    portfolioBalances: (address) => readWithRetries(() => deps.chain.portfolioBalances(address)),
    cashBalances: (address) => readWithRetries(() => deps.chain.cashBalances(address)),
  };
  let refreshingAll: Promise<boolean> | null = null;

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
    // No arrival is written from here: this is the read an action makes
    // after it lands, and what it finds is that action's own doing.
    store.update((wallet) =>
      wallet.funding.address !== address ? wallet : withFundingBalance(wallet, symbol, balance),
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
   * Resolves to whether every read came back: a read that fails keeps the
   * stored values, and the screen still has to say they were not refreshed.
   */
  function allPortfolios(): Promise<boolean> {
    refreshingAll ??= (async () => {
      const wallet = store.snapshot();
      let read = true;
      for (const portfolio of wallet ? deps.shuffle(activePortfolios(wallet)) : []) {
        if (!store.isUnlocked()) return false;
        if (!(await portfolioCash(portfolio.id, portfolio.address))) read = false;
      }
      return read;
    })().finally(() => {
      refreshingAll = null;
    });
    return refreshingAll;
  }

  /**
   * What `balances` shows arrived in the funding wallet from outside: each
   * asset it now holds more of than was stored, by the difference. Nothing
   * for an asset whose stored balance changed while the read was on its way:
   * the read may be from before that change, and would undo it.
   */
  function arrivals(
    seen: Wallet["funding"],
    stored: Wallet["funding"],
    balances: Record<string, number>,
  ): { symbol: string; amount: number }[] {
    return Object.entries(balances).flatMap(([symbol, balance]) => {
      const held = fundingBalance(stored, symbol) ?? 0;
      if ((fundingBalance(seen, symbol) ?? 0) !== held || !(balance > held)) return [];
      return [{ symbol, amount: Math.round((balance - held) * SOL_UNIT) / SOL_UNIT }];
    });
  }

  /**
   * Re-reads the funding wallet's SOL and cash balances and stores them, in
   * case they drifted (an external deposit). Reading needs only the address,
   * so nothing is derived from the phrase. Resolves to whether the read came
   * back.
   *
   * More of an asset than was stored is written into Activity as money that
   * arrived, unless it could be this wallet's own doing or was there all
   * along: nothing is written while any action is reserved or unsettled, nor
   * from the first read of an imported wallet. A missed arrival is only a
   * missing line; a false one would report money that never came.
   */
  async function fundingBalances(): Promise<boolean> {
    const current = store.snapshot();
    if (!current) return false;
    const seen = current.funding;
    const { address } = seen;
    const quietBefore = !anyActionPending(current);
    const balances = await chain.cashBalances(address).catch(() => null);
    if (!balances) return false;
    const { SOL: sol, ...tokens } = balances;
    if (!hasFunds(seen) && Object.values(balances).some((amount) => amount > 0)) {
      deps.track("deposit_detected");
    }
    store.update((wallet) => {
      if (wallet.funding.address !== address) return wallet;
      const firstRead = wallet.imported === true && !wallet.funding.balancesRead;
      const read: Wallet = {
        ...wallet,
        funding: {
          ...wallet.funding,
          sol,
          tokens: { ...wallet.funding.tokens, ...tokens },
          ...(wallet.imported ? { balancesRead: true as const } : {}),
        },
      };
      if (firstRead || !quietBefore || anyActionPending(wallet)) return read;
      return arrivals(seen, wallet.funding, balances).reduce(
        (next, { symbol, amount }) =>
          logged(
            next,
            {
              portfolioId: FUNDING,
              kind: "deposit",
              symbol,
              amount,
              usd: amount * prices.price(symbol),
            },
            prices,
          ),
        read,
      );
    });
    return true;
  }

  /**
   * The funding wallet, then every active portfolio, one address per request.
   * Resolves to whether every read came back.
   */
  async function everything(): Promise<boolean> {
    const funded = await fundingBalances();
    const portfolios = await allPortfolios();
    return funded && portfolios;
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
  return { ...refresh, allPortfolios, everything, fundingBalances, portfolioBalances };
}

export type BalanceRefresh = ReturnType<typeof createBalanceRefresh>;
