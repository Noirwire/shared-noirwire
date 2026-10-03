import { vi } from "vitest";
import type { ActionDeps } from "../../../src/application/actions/common.js";
import { createPendingActions, FUNDING } from "../../../src/application/pendingActions.js";
import type { PriceReader, Session, Signer } from "../../../src/application/ports.js";
import type { Failed } from "../../../src/application/result.js";
import { failureReason } from "../../../src/domain/usageEvents.js";
import type { Portfolio, Wallet } from "../../../src/domain/wallet.js";
import { failureMessage } from "../../../src/presentation/actionResult.js";
import { pendingWords } from "../../../src/presentation/pendingAction.js";

/**
 * Fakes for the use cases of src/lib/application/actions: a wallet store in
 * memory, signers that are only their address, prices fixed per symbol, and
 * the real pending-action store over that memory, so the reservation rules
 * under test are the ones the app runs.
 */

export type FakeSigner = Signer & { address: string };

export const signer = (address: string): FakeSigner => ({
  address,
  publicKey: { toBase58: () => address },
});

export const FUNDING_ADDRESS = "Funding111";
export const OWN_ADDRESS = "Portfolio111";
export const OTHER_ADDRESS = "Portfolio222";
export const RECIPIENT = "Recipient111";

export function portfolio(over: Partial<Portfolio> = {}): Portfolio {
  return {
    id: "p1",
    label: "Main",
    address: OWN_ADDRESS,
    derivationIndex: 1,
    createdAt: 1,
    archivedAt: null,
    holdings: [
      { symbol: "SOL", amount: 0, cost: 0 },
      { symbol: "USDC", amount: 50, cost: 50 },
    ],
    ...over,
  };
}

export function wallet(over: Partial<Wallet> = {}): Wallet {
  return {
    createdAt: 1,
    derivationScheme: "app",
    funding: { address: FUNDING_ADDRESS, sol: 0, tokens: { USDC: 100 } },
    portfolios: [
      portfolio(),
      portfolio({
        id: "p2",
        label: "Old",
        address: OTHER_ADDRESS,
        derivationIndex: 2,
        archivedAt: 5,
      }),
    ],
    activity: [],
    watchlist: [],
    ...over,
  };
}

/** USDC is a dollar, SOL 100, SPYx 10. Only SPYx is a position. */
export const prices: PriceReader = {
  price: (symbol) => ({ USDC: 1, SOL: 100, SPYx: 10 })[symbol] ?? 0,
  isPosition: (symbol) => symbol === "SPYx",
  shownUnits: (_symbol, held) => held,
};

export function harness(initial: Wallet = wallet()) {
  let current: Wallet | null = initial;
  let locked = false;
  let mismatch = false;
  const listeners = new Set<() => void>();
  const store = {
    snapshot: () => current,
    async update(change: (wallet: Wallet) => Wallet) {
      if (!current) return false;
      current = change(current);
      listeners.forEach((listener) => listener());
      return true;
    },
    isUnlocked: () => !locked,
    serialised: <T>(_name: string, task: () => Promise<T>) => task(),
    sync: async () => current !== null,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  const settle = vi.fn(async () => "pending" as const);
  const pending = createPendingActions({
    store,
    locks: { hold: async () => () => undefined, ownerGone: async () => false },
    settle,
    prices,
  });
  const track = vi.fn();

  const session = (): Session<FakeSigner> | { refused: "walletLocked" } => {
    if (locked || !current) return { refused: "walletLocked" };
    const live = () => !locked;
    const own = (address: string) => (live() && !mismatch ? signer(address) : null);
    return {
      wallet: current,
      live,
      keyAt: (index) => (live() ? signer(`Derived${index}`) : null),
      fundingSigner: () => own(current!.funding.address),
      portfolioSigner: (entry) => own(entry.address),
      refusal: () => (live() ? "keyMismatch" : "walletLocked"),
    };
  };

  const deps: ActionDeps<FakeSigner> = {
    session,
    store,
    prices,
    track,
    failureBand: (result: Failed) => failureReason(failureMessage(result)),
    pending,
    words: pendingWords(prices.shownUnits),
  };

  return {
    deps,
    store,
    pending,
    settle,
    track,
    wallet: () => current!,
    holding: (id: string, symbol: string) =>
      current!.portfolios
        .find((entry) => entry.id === id)
        ?.holdings.find((h) => h.symbol === symbol),
    lock: () => {
      locked = true;
    },
    mismatchKeys: () => {
      mismatch = true;
    },
    /** Reserves `scope` as another confirm would, and leaves it running. */
    occupy: (scope = "p1", address = OWN_ADDRESS) => pending.reserve(scope, address, "earlier"),
    FUNDING,
  };
}

export type Harness = ReturnType<typeof harness>;
