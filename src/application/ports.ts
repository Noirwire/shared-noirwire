import type { EventData, EventName } from "../domain/usageEvents.js";
import type { Portfolio, Wallet } from "../domain/wallet.js";

/**
 * What the use cases need from outside the application layer, as small
 * interfaces. The app wires each one to its store, its chain clients and its
 * analytics (each app wires them once); a test wires fakes.
 */

/** A key that can sign for one address. Only a client ever puts it to a transaction. */
export type Signer = { readonly publicKey: { toBase58(): string } };

/** Asks, at the moment of the call, whether the wallet a key was taken from is still unlocked. */
export type StillUnlocked = () => boolean;

/** Why a signer could not be had: the wallet locked, or the key is not the one for the address. */
export type SessionRefusal = "walletLocked" | "keyMismatch";

/** The current wallet and its signers, taken under one unlock. */
export type Session<K extends Signer> = {
  wallet: Wallet;
  /** Whether the wallet is still unlocked, as it was when this session was taken. */
  live: StillUnlocked;
  /** The key at a derivation index that has no stored address yet. Null once locked. */
  keyAt(index: number): K | null;
  /** The funding wallet's key, checked against its stored address. Null once locked. */
  fundingSigner(): K | null;
  /** A portfolio's own key, checked against its stored address. Null once locked. */
  portfolioSigner(portfolio: Portfolio): K | null;
  refusal(): SessionRefusal;
};

/** The session, or why there is none. */
export type OpenSession<K extends Signer> = () => Session<K> | { refused: "walletLocked" };

/** The wallet record as the store keeps it. */
export type WalletStore = {
  snapshot(): Wallet | null;
  /**
   * Applies `change` to the wallet on screen at once and stores it. Resolves
   * to whether it reached storage. `change` may run again against a newer
   * stored record.
   */
  update(change: (wallet: Wallet) => Wallet): Promise<boolean>;
  isUnlocked(): boolean;
  /** Runs `task` as the only holder of `name`, across tabs. */
  serialised<T>(name: string, task: () => Promise<T>): Promise<T>;
};

/** Counts one usage event from the closed list in src/domain/usageEvents.ts. */
export type Track = (name: EventName, data?: EventData) => void;

/** The prices and catalog facts a use case reads. See src/application/catalog.ts. */
export type PriceReader = {
  /** Dollars per held unit, or 0 while there is no live price. */
  price(symbol: string): number;
  /** Whether `symbol` is an investment position rather than cash or SOL. */
  isPosition(symbol: string): boolean;
  /** A held amount in shown units, or undefined while that cannot be shown truthfully. */
  shownUnits(symbol: string, held: number): number | undefined;
};

/** What a relayer quotes for one action. */
export type RelayerQuote = {
  /** What the relayer charges for this action, in raw USDC units. */
  feeRaw: bigint;
  /** Whether that includes opening a token account, which is most of the cost when it does. */
  opensAccount: boolean;
};

/**
 * How a reserved action is named in the note a screen shows while it is
 * unsettled. The words are chosen in presentation and kept in the record, so
 * a reload or another tab shows the same note.
 */
export type PendingWords = {
  moving(symbol: string, amount: number, portfolioLabel: string): string;
  /** `portfolioLabel` is null for a move into the funding wallet. */
  privateTransfer(symbol: string, amount: number, portfolioLabel: string | null): string;
  send(symbol: string, amount: number): string;
  trade(side: "buy" | "sell", symbol: string): string;
  openingHoldings(): string;
  earn(action: "deposit" | "withdraw"): string;
};
