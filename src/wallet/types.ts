import type { Activity, PendingAction, Portfolio, Wallet } from "../domain/wallet.js";

/** An activity entry as the stored record writes it. */
type StoredActivity = Omit<Activity, "portfolioId"> & { accountId: string };

/**
 * A pending action as the stored record writes it. `state` is the field every
 * build has written, with two values: "reserved" until the action was sent
 * with its outcome unknown, "submitted" after. `status` is written next to it
 * in the shared package's names, and an entry stored before it existed has
 * its status read from `state` and what was signed under it.
 */
type StoredPendingAction = Omit<PendingAction, "status"> & {
  state: "reserved" | "submitted";
  status?: PendingAction["status"];
};

type StoredPortfolio = Omit<Portfolio, "pendingAction"> & { pendingAction?: StoredPendingAction };

/**
 * A wallet as the stored record writes it. Its field names are the ones
 * every wallet already stored in a browser has, and they stay: portfolios
 * are kept under `accounts`, and an activity entry names its portfolio as
 * `accountId`. `fromStored` and `toStored` translate at the store boundary,
 * keeping any field they do not know.
 */
export type StoredWallet = Omit<Wallet, "portfolios" | "activity" | "funding"> & {
  accounts: StoredPortfolio[];
  activity: StoredActivity[];
  funding: Omit<Wallet["funding"], "pendingAction"> & { pendingAction?: StoredPendingAction };
};

const STATUSES = new Set<PendingAction["status"]>(["reserved", "unknown", "submitted"]);

function pendingFromStored({ state, status, ...rest }: StoredPendingAction): PendingAction {
  if (status && STATUSES.has(status)) return { ...rest, status };
  const signed = Boolean(rest.signature || rest.blockhash || rest.lastValidBlockHeight);
  if (state === "reserved") return { ...rest, status: signed ? "unknown" : "reserved" };
  return { ...rest, status: rest.signature && rest.lastValidBlockHeight ? "submitted" : "unknown" };
}

function pendingToStored(pending: PendingAction): StoredPendingAction {
  return { ...pending, state: pending.status === "reserved" ? "reserved" : "submitted" };
}

/** Translates the `pendingAction` of `entry`, leaving an entry without one as it is. */
function withPending<From extends { pendingAction?: object }, P>(
  entry: From,
  translate: (pending: NonNullable<From["pendingAction"]>) => P,
): Omit<From, "pendingAction"> & { pendingAction?: P } {
  const { pendingAction, ...rest } = entry;
  return pendingAction
    ? { ...rest, pendingAction: translate(pendingAction as NonNullable<From["pendingAction"]>) }
    : rest;
}

export function fromStored({ accounts, activity, funding, ...rest }: StoredWallet): Wallet {
  return {
    ...rest,
    funding: withPending(funding, pendingFromStored),
    portfolios: accounts.map((portfolio) => withPending(portfolio, pendingFromStored)),
    activity: activity.map(({ accountId, ...entry }) => ({ ...entry, portfolioId: accountId })),
  };
}

export function toStored({ portfolios, activity, funding, ...rest }: Wallet): StoredWallet {
  return {
    ...rest,
    funding: withPending(funding, pendingToStored),
    accounts: portfolios.map((portfolio) => withPending(portfolio, pendingToStored)),
    activity: activity.map(({ portfolioId, ...entry }) => ({ ...entry, accountId: portfolioId })),
  };
}

/**
 * What is inside the stored envelope once it is decrypted: the real BIP-39
 * mnemonic every keypair is re-derived from, and the wallet it belongs to.
 * See src/wallet/keystore.ts.
 */
export type StoredRecord = {
  /** Counts writes, so a tab can tell that the stored copy is newer than its own. */
  rev: number;
  phrase: string[];
  wallet: StoredWallet;
};

/** A stored record once it is opened: the same, with the wallet in the shape the app uses. */
export type OpenRecord = Omit<StoredRecord, "wallet"> & { wallet: Wallet };

/**
 * Bumped from v8 when the whole wallet, not only the phrase, started being
 * stored encrypted. The value under this key is an `Envelope` and nothing
 * else: no address, label or balance is readable without the password.
 */
export const STORAGE_KEY = "noirwire.wallet.v9";

/**
 * The previous format: the phrase encrypted, but every address, label and
 * activity entry beside it in the clear. A wallet stored this way is
 * upgraded the first time it is unlocked, and this key is removed once the
 * new record is confirmed to be stored.
 */
export const LEGACY_STORAGE_KEY = "noirwire.wallet.v8";

/**
 * Keys from before the phrase was encrypted at all, `noirwire.wallet.v1` to
 * `v7` and the prototype's `noirwire.prototype.wallet.v1` to `v7`. A record
 * under one of them holds a recovery phrase in plain text and cannot be
 * upgraded (no password was ever set for it), so it is deleted once a
 * current wallet is stored or unlocked.
 */
export const PLAINTEXT_STORAGE_KEYS: readonly string[] = [
  "noirwire.",
  "noirwire.prototype.",
].flatMap((prefix) => [1, 2, 3, 4, 5, 6, 7].map((version) => `${prefix}wallet.v${version}`));

/**
 * Where the web app used to cache price charts, one key per symbol and range,
 * in the clear. Nothing writes them any more (see
 * src/infrastructure/prices/history.ts). Finding the ones an earlier version
 * left behind means listing the browser's storage, which the vault port does
 * not do, so the web app's vault deletes them when it starts.
 */
export const STALE_HISTORY_KEY_PREFIX = "noirwire.history.series.";
