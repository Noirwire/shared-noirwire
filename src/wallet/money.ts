import { PublicKey, type Keypair } from "@solana/web3.js";
import type { ActionDeps } from "../application/actions/common.js";
import type { EarnChain } from "../application/actions/earn.js";
import type { PrivateToken } from "../application/actions/fundPrivately.js";
import type { HoldingsChain } from "../application/actions/pieOrder.js";
import {
  createBalanceRefresh,
  type BalanceRefresh,
} from "../application/actions/refreshBalances.js";
import type { SendableAsset, SendChain } from "../application/actions/send.js";
import type { TradeChain } from "../application/actions/trade.js";
import type { CostChain } from "../application/networkCost.js";
import {
  createPendingActions,
  type PendingActions,
  type PendingActionsDeps,
} from "../application/pendingActions.js";
import { readWithRetries } from "../application/retries.js";
import { errorsCopy } from "../copy/errors.js";
import { failureReason } from "../domain/usageEvents.js";
import { checkRecipient, isRecipientAddress } from "../infrastructure/solana/address.js";
import { assetHandle } from "../infrastructure/solana/assets.js";
import { getCashBalances, getPortfolioBalances } from "../infrastructure/solana/balances.js";
import { connection } from "../infrastructure/solana/client.js";
import { isMainnet } from "../infrastructure/solana/config.js";
import {
  EARN_FIRST_DEPOSIT_LAMPORTS,
  EARN_NETWORK_FEE_LAMPORTS,
  jupiterLend,
  relayedEarnDraft,
} from "../infrastructure/solana/earn/jupiterLend.js";
import type { EarnPosition, EarnRate } from "../infrastructure/solana/earn/types.js";
import { NETWORK_FEE_LAMPORTS, shortfallFor } from "../infrastructure/solana/fees.js";
import { shuffled } from "../infrastructure/solana/import.js";
import { confirmNetwork } from "../infrastructure/solana/networkIdentity.js";
import { settle } from "../infrastructure/solana/pending.js";
import { nudgeSettlement, sendPrivateTransfer } from "../infrastructure/solana/private-payments.js";
import { quoteRelayed, runRelayed } from "../infrastructure/solana/relayer.js";
import { guardSigningWith } from "../infrastructure/solana/signerAccounts.js";
import { lamportsToSol } from "../infrastructure/solana/sol.js";
import {
  executeTrade,
  planTrade,
  tradingAvailable,
} from "../infrastructure/solana/swap/execute.js";
import type { TradePlan } from "../infrastructure/solana/swap/execute.js";
import { gaslessFromUsd, isBuilt } from "../infrastructure/solana/swap/jupiter.js";
import {
  QUOTE_TOKEN,
  stockBySymbol,
  tokenBySymbol,
  type TokenDefinition,
} from "../infrastructure/solana/tokenRegistry.js";
import {
  ataFor,
  getTokenBalance,
  relayedOpenDraft,
  relayedSendDraft,
  tokenSendLamports,
} from "../infrastructure/solana/tokens.js";
import { getPlatform } from "../platform.js";
import { failureAccount } from "../presentation/actionResult.js";
import { pendingWords } from "../presentation/pendingAction.js";
import { catalog } from "./market.js";
import { unlockedSession } from "./session.js";
import {
  getSnapshot,
  isUnlocked,
  serialised,
  subscribe,
  syncFromStorage,
  updateWallet,
} from "./store.js";

/** The lending venue as the Earn screens read it. */
export type EarnVenue = {
  name: string;
  rate(): Promise<EarnRate>;
  position(address: string): Promise<EarnPosition>;
  /** What the portfolio's own network cost would be, before the relayer is asked to pay it. */
  lamportsNeeded(position: EarnPosition): number;
};

/**
 * Every money action's ports, wired once for the app: the one pending-action
 * store, the use cases' dependencies, the balance refresh and each chain
 * client. Nothing here decides anything; it only says which client answers
 * each question a use case asks.
 */
export type Money = {
  pending: PendingActions;
  deps: ActionDeps<Keypair>;
  refresh: BalanceRefresh;
  /** What moves an asset from the funding wallet in public, and out of a portfolio. */
  asset(symbol: string): SendableAsset<Keypair> | undefined;
  privateToken(symbol: string): PrivateToken<Keypair> | undefined;
  sendChain: SendChain<Keypair>;
  tradeChain: TradeChain<Keypair, TradePlan>;
  holdingsChain: HoldingsChain<Keypair, TokenDefinition>;
  earnChain: EarnChain<Keypair>;
  earnVenue: EarnVenue;
  /** Reads the recipient from the network: why it cannot receive, or null for a wallet. */
  checkRecipient: typeof checkRecipient;
  /** The cash every cost is paid in. */
  cashSymbol: string;
};

/** The locks that tell a live reservation from one whose owner has gone. */
export type MoneyLocks = PendingActionsDeps["locks"];

const address = (value: string) => new PublicKey(value);

const store = { snapshot: getSnapshot, update: updateWallet, isUnlocked, serialised };

/** Asked for at the moment of each event, so the platform installed at boot is the one counted with. */
const track: ActionDeps<Keypair>["track"] = (name, data) =>
  (getPlatform().track as (name: string, data?: object) => void)(name, data);

async function balanceOf(owner: string, symbol: string): Promise<number> {
  const handle = assetHandle(symbol);
  if (!handle) throw new Error(errorsCopy.unknownAsset(symbol));
  return handle.getBalance(address(owner));
}

const cost: CostChain = {
  balance: (owner) => connection.getBalance(address(owner)),
  shortfall: shortfallFor,
};

function asset(symbol: string): SendableAsset<Keypair> | undefined {
  const handle = assetHandle(symbol);
  if (!handle) return undefined;
  const token = tokenBySymbol(handle.symbol);
  return {
    symbol: handle.symbol,
    balance: (owner) => handle.getBalance(address(owner)),
    ensureAccount: handle.ensureAccount,
    deposit: handle.deposit,
    withdraw: (owner, funder, amount, to, stillUnlocked) =>
      handle.withdraw(owner, funder, amount, address(to), stillUnlocked),
    ...(token && {
      sendRelayed: ({ owner, to, amount, reviewedFeeRaw, keepOut, stillUnlocked }) =>
        runRelayed({
          owner,
          reviewedFeeRaw,
          keepOut: keepOut.map(address),
          stillUnlocked,
          build: (terms) =>
            relayedSendDraft({ ...token, owner: owner.publicKey, to: address(to), amount }, terms),
        }),
    }),
  };
}

function privateToken(symbol: string): PrivateToken<Keypair> | undefined {
  const token = tokenBySymbol(symbol);
  if (!token) return undefined;
  return {
    symbol: token.symbol,
    balance: (owner) => getTokenBalance(token.mint, token.decimals, address(owner)),
    sendPrivately: ({ sender, to, amount, keepOut, stillUnlocked }) =>
      sendPrivateTransfer({
        sender,
        to: address(to),
        mint: token.mint,
        decimals: token.decimals,
        amount,
        keepOut: keepOut.map(address),
        stillUnlocked,
      }),
    nudgeSettlement: () => nudgeSettlement(token.mint),
  };
}

const sendChain: SendChain<Keypair> = {
  asset,
  token(symbol) {
    const token = tokenBySymbol(symbol);
    if (!token) return undefined;
    return {
      symbol: token.symbol,
      decimals: token.decimals,
      sendLamports: (to) => tokenSendLamports(token.mint, address(to), token.programId),
      quoteRelayed: (owner, to, amount) =>
        quoteRelayed(address(owner), (terms) =>
          relayedSendDraft({ ...token, owner: address(owner), to: address(to), amount }, terms),
        ),
    };
  },
  isRecipientAddress,
  cashSymbol: QUOTE_TOKEN.symbol,
  networkFeeSol: lamportsToSol(NETWORK_FEE_LAMPORTS),
  cost,
};

/** The relayer opens `owner`'s own account for `stock`, unless it is already there. */
async function openHolding(input: {
  owner: Keypair;
  stock: TokenDefinition;
  reviewedFeeRaw: bigint;
  keepOut: string[];
  stillUnlocked: () => boolean;
}): Promise<string | null> {
  const { owner, stock } = input;
  const holding = ataFor(stock.mint, owner.publicKey, stock.programId);
  if (await connection.getAccountInfo(holding)) return null;
  return runRelayed({
    owner,
    reviewedFeeRaw: input.reviewedFeeRaw,
    keepOut: input.keepOut.map(address),
    stillUnlocked: input.stillUnlocked,
    build: (terms) => relayedOpenDraft({ ...stock, owner: owner.publicKey }, terms),
  });
}

const tradeChain: TradeChain<Keypair, TradePlan> = {
  available: tradingAvailable,
  isStock: (symbol) => Boolean(stockBySymbol(symbol)),
  plan: planTrade,
  isBuilt: (plan) => isBuilt(plan.quote),
  execute: executeTrade,
  get gaslessFromUsd() {
    return gaslessFromUsd();
  },
  cashSymbol: QUOTE_TOKEN.symbol,
  holdingOpen: async (owner, stock) =>
    Boolean(await connection.getAccountInfo(ataFor(stock.mint, address(owner), stock.programId))),
  quoteOpenHolding: (owner, stock) =>
    quoteRelayed(address(owner), (terms) =>
      relayedOpenDraft({ ...stock, owner: address(owner) }, terms),
    ),
  openHolding,
  tradeBalances: (owner, stock) =>
    Promise.all([
      getTokenBalance(stock.mint, stock.decimals, address(owner), stock.programId),
      getTokenBalance(
        QUOTE_TOKEN.mint,
        QUOTE_TOKEN.decimals,
        address(owner),
        QUOTE_TOKEN.programId,
      ),
    ]),
  balanceOf,
  cost,
};

const holdingsChain: HoldingsChain<Keypair, TokenDefinition> = {
  stock: stockBySymbol,
  openHolding,
};

const earnChain: EarnChain<Keypair> = {
  available: isMainnet,
  move: (action, owner, amount, stillUnlocked) =>
    action === "deposit"
      ? jupiterLend.deposit(owner, amount, stillUnlocked)
      : jupiterLend.withdraw(owner, amount, stillUnlocked),
  moveRelayed: ({ action, owner, amount, reviewedFeeRaw, keepOut, stillUnlocked }) =>
    runRelayed({
      owner,
      reviewedFeeRaw,
      keepOut: keepOut.map(address),
      stillUnlocked,
      build: (terms) => relayedEarnDraft(action, owner.publicKey, amount, terms),
    }),
  quoteRelayed: (action, owner, amount) =>
    quoteRelayed(address(owner), (terms) =>
      relayedEarnDraft(action, address(owner), amount, terms),
    ),
  cashSymbol: QUOTE_TOKEN.symbol,
  cost,
};

const earnVenue: EarnVenue = {
  name: jupiterLend.name,
  rate: () => readWithRetries(() => jupiterLend.rate()),
  position: (owner) => readWithRetries(() => jupiterLend.position(address(owner))),
  lamportsNeeded: (position) =>
    EARN_NETWORK_FEE_LAMPORTS + (position.hasReceiptAccount ? 0 : EARN_FIRST_DEPOSIT_LAMPORTS),
};

let installed: Money | null = null;

/**
 * Wires every money action, once per app, after the platform is installed:
 * one pending-action store for the whole device, kept in the encrypted
 * wallet record, and the one signing guard, which checks the network's
 * identity before each signature and writes each signed transaction into
 * that store's reservation before it may be sent. `locks` tell a live
 * reservation from one whose owner has gone: `processLocks()` from
 * `@noirwire/shared/application` for an app that runs as one process, the
 * browser's own locks for a web app with tabs.
 *
 * A second call is refused: two stores would compete for the one signing
 * guard, and each would take the other's live reservations for abandoned.
 */
export function installMoney(locks: MoneyLocks): Money {
  if (installed) throw new Error("Money actions are already wired. Wire them once, at boot.");
  const pending = createPendingActions({
    store: { ...store, sync: syncFromStorage, subscribe },
    locks,
    settle,
    prices: catalog,
  });
  guardSigningWith({
    confirmNetwork,
    record: (record) => pending.recordSigned({ ...record, signer: record.signer.toBase58() }),
  });
  installed = {
    pending,
    deps: {
      session: unlockedSession,
      store,
      prices: catalog,
      track,
      failureBand: (result) => failureReason(failureAccount(result)),
      pending: { reserve: pending.reserve },
      words: pendingWords(catalog.shownUnits),
    },
    refresh: createBalanceRefresh({
      store,
      chain: {
        balanceOf,
        portfolioBalances: (owner) => getPortfolioBalances(address(owner)),
        cashBalances: (owner) => getCashBalances(address(owner)),
      },
      prices: catalog,
      track,
      shuffle: shuffled,
    }),
    asset,
    privateToken,
    sendChain,
    tradeChain,
    holdingsChain,
    earnChain,
    earnVenue,
    checkRecipient,
    cashSymbol: QUOTE_TOKEN.symbol,
  };
  return installed;
}

/** The money wiring `installMoney` made. Throws when it has not been made yet. */
export function money(): Money {
  if (!installed) throw new Error("Money actions are not wired yet. Call installMoney at boot.");
  return installed;
}
