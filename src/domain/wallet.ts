import type { PortfolioIcon } from "./portfolioIcon.js";

export type AssetKind = "cash" | "crypto" | "stock";

/** One asset held by a portfolio. `cost` is the total USD basis, which is what P&L is measured against. */
export type Holding = {
  symbol: string;
  amount: number;
  cost: number;
  /**
   * Trackers only: the part of `amount` this browser never saw bought, such
   * as tokens that arrived from outside or were found on chain after a
   * restore. `cost` says nothing about it, so no gain is worked out on it.
   * Absent when the whole amount was bought here.
   */
  uncosted?: number;
};

/**
 * What an activity entry records: money arriving in the funding wallet from
 * outside, money arriving in a portfolio, a send, a trade, or cash lent into
 * Earn and returned from it.
 */
export const ACTIVITY_KINDS = [
  "deposit",
  "fund",
  "send",
  "buy",
  "sell",
  "earnDeposit",
  "earnWithdraw",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/**
 * Which SLIP-0010 path convention a wallet's keypairs are derived under:
 * "app" is this app's own `m/44'/501'/{index}'/0'`, "walletDefault" is the
 * `m/44'/501'/{index}'` path several other Solana wallets default to. Fixed
 * per wallet at creation/import time so every later derivation agrees with
 * the first one. See src/infrastructure/solana/keys.ts.
 */
export type DerivationScheme = "app" | "walletDefault";

/** The fewest characters a wallet password may have. The strength check refuses anything shorter unasked. */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * The most activity entries the wallet's record keeps. Every entry is sealed
 * and written again with each change, so a list that only grew would make
 * every write and unlock slower until storage refused one. The oldest go
 * first; a pending action is kept apart from this list and is never dropped.
 */
export const MAX_ACTIVITY_ENTRIES = 500;

export type Activity = {
  id: string;
  /**
   * The portfolio it happened in, or "funding" for the funding wallet: money
   * that arrived there from outside, and a send out of it.
   */
  portfolioId: string;
  at: number;
  kind: ActivityKind;
  symbol: string;
  /** In the units the wallet holds: for a stock, raw tokens. */
  amount: number;
  /**
   * A stock amount as it was shown when this happened: the raw amount times
   * the multiplier of that day. Kept because the multiplier moves with every
   * dividend and split, and a past trade must go on reading as what it was.
   * Absent on entries from before this was recorded.
   */
  shown?: number;
  /** Dollar value at the time, or 0 when there was no live price to value it with. */
  usd: number;
  /**
   * What the action's network cost was, in USDC, when the portfolio paid it
   * out of its cash or out of what the action returned. Absent when nothing
   * was charged in cash, and on entries from before this was recorded.
   */
  networkCost?: number;
  /**
   * A send only: the address it went to, as the person entered it. Kept only
   * inside the encrypted record, so a screen can reveal it on request.
   */
  counterparty?: string;
};

/** One stock in a pie and its target share of the pie, in whole percent. */
export type PieSlice = {
  symbol: string;
  weight: number;
};

export type Portfolio = {
  id: string;
  label: string;
  /** The portfolio's real Solana pubkey, base58-encoded. */
  address: string;
  /** SLIP-0010 path index (m/44'/501'/{derivationIndex}'/0') this portfolio's keypair is derived at. */
  derivationIndex: number;
  createdAt: number;
  archivedAt: number | null;
  holdings: Holding[];
  /** Set when this portfolio is a pie: the target mix its investing is steered toward. */
  pie?: PieSlice[];
  /** Set only once a user explicitly picks a mark; absent means the default (see resolvePortfolioIcon). */
  icon?: PortfolioIcon;
  /**
   * The last action from this portfolio, while it is sent and not yet seen
   * to land or fail. Kept here, in the encrypted record, so that a reload, a
   * lock or another tab cannot forget it and let the same thing be confirmed
   * a second time while the first may still land. Removed once the chain has
   * settled it. See src/application/pendingActions.ts.
   */
  pendingAction?: PendingAction;
};

export type PendingAction = {
  /**
   * How far it has got, in the shared package's names:
   * - "reserved" from the moment the action is confirmed, while nothing is
   *   signed;
   * - "unknown" once a transaction of it is signed and may have left this
   *   device, and what became of it is not known;
   * - "submitted" once it was sent and accepted, with the signature and last
   *   valid block height of the exact transaction, and is not yet seen to land.
   * An action that landed or expired is no longer pending, and is removed.
   */
  status: "reserved" | "unknown" | "submitted";
  /** Tells this reservation from any other, including one another tab made. */
  id: string;
  /** The transaction's id, when it was this wallet's to know. */
  signature?: string;
  /** The block height past which it can no longer land. */
  lastValidBlockHeight?: number;
  /** The blockhash it was signed against. */
  blockhash?: string;
  /** The address that signed it, which every transaction of the action names. */
  signer?: string;
  /**
   * The signer's own signature on it. It is over the message and nothing
   * else, so it stands for exactly that message. When the id is not known (a
   * fee payer that signs after this wallet), this is how the transaction is
   * recognised among the signer's own on chain.
   */
  ownSignature?: string;
  /**
   * Set once the chain was asked about a transaction with no recorded id and
   * could not say: its time has run out, and whether it landed cannot be
   * looked up. Only the person, who can check the balance, can release it.
   */
  unfindable?: true;
  /** When it was reserved, by this device's clock. Shown, never used to release it. */
  at: number;
  /** What it was, in the words the user is told it with: "a send of 5.00 USDC". */
  what: string;
  /** The activity entry to write if it turns out to have landed. A send only. */
  activity?: Pick<Activity, "kind" | "symbol" | "amount" | "usd" | "counterparty" | "networkCost">;
};

type FundingWallet = {
  /** The wallet's real Solana pubkey at derivation index 0, base58-encoded. */
  address: string;
  /** Real native SOL balance of that keypair's own wallet (not a vault). */
  sol: number;
  /**
   * Real SPL token balances of that keypair's own associated token
   * accounts, keyed by symbol (see src/infrastructure/solana/tokenRegistry.ts). A new
   * registered token needs no schema change here - it just gets a new key.
   */
  tokens: Record<string, number>;
  /**
   * An action of the funding wallet (moving money into a portfolio, or a send
   * of its own) that is reserved or not yet settled on chain, exactly as
   * `Portfolio.pendingAction` is for a portfolio's own actions.
   */
  pendingAction?: PendingAction;
  /**
   * Set on an imported wallet once its SOL and cash have been read from the
   * chain here. Until then its stored balances are not a read, so what the
   * first read finds was already there and is not recorded as arriving.
   */
  balancesRead?: true;
};

/**
 * Everything the app knows about a wallet except its recovery phrase. It
 * exists only in memory, and only while the wallet is unlocked: what is
 * stored is the encrypted `StoredRecord` (src/wallet/types.ts), never
 * this object, and its wallet is written in the stored shape (`StoredWallet`).
 */
export type Wallet = {
  createdAt: number;
  /** Fixed at creation/import; every deriveKeypair call for this wallet must pass this scheme. */
  derivationScheme: DerivationScheme;
  funding: FundingWallet;
  portfolios: Portfolio[];
  activity: Activity[];
  watchlist: string[];
  /**
   * The copy of the wallet's labels this device last synced with their
   * mirror, as the mirror's own text (see src/domain/profile.ts). Kept here,
   * in the encrypted record, because it is what tells a label changed on
   * this device from one changed on another. Absent until a first sync.
   */
  syncedProfile?: string;
  /**
   * Set on a wallet that was imported from its recovery phrase: what it did
   * before, on another device, was never recorded here.
   */
  imported?: true;
};
