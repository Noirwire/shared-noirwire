import { getPlatform } from "../platform.js";
import { FUNDING } from "../application/pendingActions.js";
import { walletCopy } from "../copy/wallet.js";
import { dropSession } from "../infrastructure/apiSession.js";
import { deriveKeypair, FUNDING_DERIVATION_INDEX } from "../infrastructure/solana/keys.js";
import {
  decryptVault,
  isEncryptedVault,
  isEnvelope,
  newVaultKey,
  newVaultKeyWithBits,
  open,
  seal,
  vaultKeyFor,
  vaultKeyFromBits,
  zeroBits,
  type EncryptedVault,
  type Envelope,
  type VaultKey,
} from "./keystore.js";
import { assessPassword } from "./passwordStrength.js";
import { ACTIVITY_KINDS, type Wallet } from "../domain/wallet.js";
import {
  LEGACY_STORAGE_KEY,
  LOCK_SIGNAL_KEY,
  PLAINTEXT_STORAGE_KEYS,
  STORAGE_KEY,
  fromStored,
  toStored,
  type OpenRecord,
  type StoredRecord,
  type StoredWallet,
} from "./types.js";

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

type Change = (wallet: Wallet) => Wallet;
const apply = (wallet: Wallet, change: Change) => change(wallet);

/**
 * What an unlocked tab holds in memory and nowhere else: the key the stored
 * record is encrypted under, the decrypted recovery phrase, and the routine
 * changes made here that have not reached storage yet. A reload drops all of
 * it, which is the point: the only copy that survives a refresh is the
 * encrypted one.
 */
type Session = {
  vaultKey: VaultKey;
  phrase: string[];
  pending: Change[];
};

let session: Session | null = null;

/**
 * The decrypted wallet, or null while locked. A locked tab knows nothing
 * about the wallet except that one is stored: see `walletExists`.
 */
let current: Wallet | null = null;

/** undefined means the vault has not been read yet in this session. */
let exists: boolean | undefined = undefined;

/**
 * The stored string this tab last wrote or took `current` from, and the
 * revision inside it. Storage holding anything else means another tab wrote
 * since, and its record is the one a change here has to be applied to.
 */
let lastRaw: string | null = null;
let revision = 0;

/**
 * Counts every lock, reset and wallet replacement. Work that started before
 * one of those (an unlock still deriving its key, a phrase being revealed)
 * compares the count when it finishes and discards its result if it moved.
 */
let generation = 0;

/** Set when a routine write was refused by the vault, so the screen can say changes are not being kept. */
let saveFailing = false;

/**
 * An unlocked tab left open is a signer anyone at the keyboard can use, so the
 * phrase is forgotten after this long without input - the same default the
 * major browser wallets ship. Locking only drops the in-memory copy; the
 * encrypted wallet stays exactly where it was.
 *
 * A timer alone is not enough: timers stop while a laptop or a phone sleeps,
 * and an app that slept for a night would wake up still unlocked. So the
 * time of the last input is recorded and compared against the clock whenever
 * the platform reports input or a return to the app (the `activity` port),
 * and before anything is signed.
 */
const IDLE_LOCK_MS = 15 * 60 * 1000;
let lastActivityAt = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let stopActivity: (() => void) | null = null;

/** Locks if the idle window has passed. True when it did. */
export function lockIfIdle(): boolean {
  if (!session || Date.now() - lastActivityAt < IDLE_LOCK_MS) return false;
  getPlatform().track("wallet_locked", { by: "idle" });
  lockHere();
  return true;
}

/**
 * Input, or a return to the app, after the window has passed must lock, not
 * restart the clock.
 */
function noteActivity() {
  if (!lockIfIdle()) lastActivityAt = Date.now();
}

function scheduleIdleCheck() {
  if (idleTimer) clearTimeout(idleTimer);
  const remaining = IDLE_LOCK_MS - (Date.now() - lastActivityAt);
  idleTimer = setTimeout(
    () => {
      if (session && !lockIfIdle()) scheduleIdleCheck();
    },
    Math.max(remaining, 1000),
  );
}

/** Counts from now, and from every input or return to the app the platform reports. */
function armIdleLock() {
  disarmIdleLock();
  lastActivityAt = Date.now();
  stopActivity = getPlatform().activity.subscribe(noteActivity);
  scheduleIdleCheck();
}

function disarmIdleLock() {
  stopActivity?.();
  stopActivity = null;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const nonnegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const text = (value: unknown): value is string => typeof value === "string";

/**
 * Shape only. Whether every stock is still listed is a question for the
 * screens, not for loading: a delisted stock must not make a wallet unreadable.
 */
function isPie(value: unknown) {
  return (
    Array.isArray(value) &&
    value.every((slice) => record(slice) && text(slice.symbol) && Number.isInteger(slice.weight))
  );
}

function isPendingAction(value: unknown) {
  return (
    record(value) &&
    (value.state === "reserved" || value.state === "submitted") &&
    text(value.id) &&
    nonnegative(value.at) &&
    text(value.what) &&
    (value.blockhash === undefined || text(value.blockhash)) &&
    (value.signature === undefined || text(value.signature)) &&
    (value.signer === undefined || text(value.signer)) &&
    (value.ownSignature === undefined || text(value.ownSignature)) &&
    (value.unfindable === undefined || value.unfindable === true) &&
    (value.lastValidBlockHeight === undefined || nonnegative(value.lastValidBlockHeight)) &&
    (value.activity === undefined || record(value.activity))
  );
}

function isTokenBalanceMap(value: unknown): value is Record<string, number> {
  return record(value) && Object.values(value).every(nonnegative);
}

/** Validate persisted data before any screen consumes it. Invalid data stays in storage. */
function isStoredWallet(value: unknown): value is StoredWallet {
  if (
    !record(value) ||
    !nonnegative(value.createdAt) ||
    (value.derivationScheme !== "app" && value.derivationScheme !== "walletDefault") ||
    !record(value.funding) ||
    !text(value.funding.address) ||
    !nonnegative(value.funding.sol) ||
    !isTokenBalanceMap(value.funding.tokens) ||
    (value.funding.pendingAction !== undefined && !isPendingAction(value.funding.pendingAction)) ||
    (value.funding.balancesRead !== undefined && value.funding.balancesRead !== true) ||
    !Array.isArray(value.accounts) ||
    !Array.isArray(value.activity) ||
    !Array.isArray(value.watchlist) ||
    !value.watchlist.every(text) ||
    (value.syncedProfile !== undefined && !text(value.syncedProfile))
  )
    return false;
  const portfolioIds = new Set<string>();
  for (const portfolio of value.accounts) {
    if (
      !record(portfolio) ||
      !text(portfolio.id) ||
      portfolioIds.has(portfolio.id) ||
      !text(portfolio.label) ||
      !text(portfolio.address) ||
      !nonnegative(portfolio.derivationIndex) ||
      (portfolio.pie !== undefined && !isPie(portfolio.pie)) ||
      (portfolio.pendingAction !== undefined && !isPendingAction(portfolio.pendingAction)) ||
      !nonnegative(portfolio.createdAt) ||
      (portfolio.archivedAt !== null && !nonnegative(portfolio.archivedAt)) ||
      !Array.isArray(portfolio.holdings)
    )
      return false;
    portfolioIds.add(portfolio.id);
    const symbols = new Set<string>();
    for (const holding of portfolio.holdings) {
      if (
        !record(holding) ||
        !text(holding.symbol) ||
        symbols.has(holding.symbol) ||
        !nonnegative(holding.amount) ||
        !nonnegative(holding.cost) ||
        (holding.uncosted !== undefined && !nonnegative(holding.uncosted))
      )
        return false;
      symbols.add(holding.symbol);
    }
  }
  return value.activity.every(
    (entry: unknown) =>
      record(entry) &&
      text(entry.id) &&
      text(entry.accountId) &&
      (portfolioIds.has(entry.accountId) || entry.accountId === FUNDING) &&
      nonnegative(entry.at) &&
      ACTIVITY_KINDS.some((kind) => kind === entry.kind) &&
      text(entry.symbol) &&
      nonnegative(entry.amount) &&
      nonnegative(entry.usd) &&
      (entry.counterparty === undefined || text(entry.counterparty)),
  );
}

function isStoredRecord(value: unknown): value is StoredRecord {
  return (
    record(value) &&
    Number.isInteger(value.rev) &&
    nonnegative(value.rev) &&
    Array.isArray(value.phrase) &&
    (value.phrase.length === 12 || value.phrase.length === 24) &&
    value.phrase.every(text) &&
    isStoredWallet(value.wallet)
  );
}

function vault() {
  return getPlatform().vault;
}

/** What is stored under `key`, or null when nothing is or it cannot be read. */
async function readRaw(key: string = STORAGE_KEY): Promise<string | null> {
  const read = await vault().read(key);
  return read.ok ? read.value : null;
}

function parseEnvelope(raw: string | null): Envelope | null {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return isEnvelope(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

type LegacyWallet = StoredWallet & { vault: EncryptedVault };

/** A wallet in the previous format, whose addresses and activity sit beside the encrypted phrase. */
function parseLegacy(raw: string | null): LegacyWallet | null {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return isStoredWallet(parsed) && isEncryptedVault((parsed as { vault?: unknown }).vault)
      ? (parsed as LegacyWallet)
      : null;
  } catch {
    return null;
  }
}

async function hasStoredWallet(): Promise<boolean> {
  return (
    parseEnvelope(await readRaw()) !== null ||
    parseLegacy(await readRaw(LEGACY_STORAGE_KEY)) !== null
  );
}

/**
 * A key the web app's trade sheet used to write: the id of the portfolio
 * last traded from, in the clear. Nothing reads it, and which portfolio is in
 * use is exactly what a copy of the device's storage should not say.
 */
const STALE_SELECTION_KEY = "noirwire.selectedPortfolio";

/**
 * Deletes what earlier versions left readable: wallets from before the
 * phrase was encrypted, which hold a recovery phrase in plain text. They
 * cannot be upgraded (no password was ever set for them).
 *
 * Only ever called once a current wallet has been created or unlocked on
 * this device. For someone whose only wallet is one of these records, it is
 * also their only copy of the phrase, and deleting it on sight would lose
 * the wallet for good.
 */
async function purgePlaintext(): Promise<boolean> {
  const removed = await Promise.all(PLAINTEXT_STORAGE_KEYS.map(remove));
  const cleared = removed.every(Boolean);
  if (plaintextLeft !== !cleared) {
    plaintextLeft = !cleared;
    emit();
  }
  return cleared;
}

/** Set while an old plain text phrase could not be deleted. Each later start or unlock tries again. */
let plaintextLeft = false;

/**
 * Removes `key`, and says whether it is gone: written away, or confirmed
 * absent by a read. A vault that refuses the write leaves it where it was.
 */
async function remove(key: string): Promise<boolean> {
  const update = await vault().update(key, (current) =>
    current === null ? { keep: true } : { write: null },
  );
  if (update.persisted) return true;
  if (update.reason === "kept") return update.value === null;
  const read = await vault().read(key);
  return read.ok && read.value === null;
}

type Written = "written" | "changed" | "failed";

/**
 * Writes `next` as the stored record, in one atomic update, only while what
 * is stored passes `accept`. "changed" when it did not: another tab or
 * process wrote first. "failed" when the vault could not be written.
 */
async function writeIf(
  accept: (current: string | null) => boolean,
  next: string | null,
): Promise<Written> {
  const update = await vault().update(STORAGE_KEY, (current) =>
    accept(current) ? { write: next } : { keep: true },
  );
  if (update.persisted) return "written";
  return update.reason === "kept" ? "changed" : "failed";
}

/** Writes `next` only over the exact record `expected`, byte for byte. */
function replace(expected: string | null, next: string | null): Promise<Written> {
  return writeIf((current) => current === expected, next);
}

async function sealRecord(vaultKey: VaultKey, opened: OpenRecord): Promise<string> {
  const stored: StoredRecord = { ...opened, wallet: toStored(opened.wallet) };
  return JSON.stringify(await seal(vaultKey, JSON.stringify(stored)));
}

function parseRecord(plaintext: string | null): OpenRecord | null {
  try {
    const parsed: unknown = plaintext ? JSON.parse(plaintext) : null;
    return isStoredRecord(parsed) ? { ...parsed, wallet: fromStored(parsed.wallet) } : null;
  } catch {
    return null;
  }
}

async function openRecord(vaultKey: VaultKey, envelope: Envelope): Promise<OpenRecord | null> {
  return parseRecord(await open(vaultKey, envelope));
}

/**
 * Whether every stored address is the one the phrase derives at its index.
 * The stored copy is only a cache of that derivation, and it is what the
 * screens show and what balances are read from: an address swapped in
 * storage would have the user fund, and read as their own, a portfolio whose
 * key they do not hold.
 */
function addressesMatch({ phrase, wallet }: OpenRecord): boolean {
  const mnemonic = phrase.join(" ");
  const addressAt = (index: number) =>
    deriveKeypair(mnemonic, index, wallet.derivationScheme).publicKey.toBase58();
  try {
    return (
      wallet.funding.address === addressAt(FUNDING_DERIVATION_INDEX) &&
      wallet.portfolios.every(
        (portfolio) => portfolio.address === addressAt(portfolio.derivationIndex),
      )
    );
  } catch {
    return false;
  }
}

/**
 * Runs `task` while no other holder of the same name is inside it: another
 * tab on the web, through the platform's locks. For read-then-write changes
 * that must not interleave.
 */
export function serialised<T>(name: string, task: () => Promise<T>): Promise<T> {
  return getPlatform().locks.withLock(name, task);
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Every write to the stored record goes through here: one at a time in this
 * tab, in the order they were asked for, and one tab at a time. Encrypting is
 * asynchronous, so without this an older write could finish after a newer
 * one and put stale data back.
 */
function exclusive<T>(task: () => T | Promise<T>): Promise<T> {
  const run = queue.then(() => serialised("noirwire-wallet-write", async () => task()));
  queue = run.catch(() => undefined);
  return run;
}

function noteSaveFailed(): false {
  if (!saveFailing) {
    saveFailing = true;
    emit();
  }
  return false;
}

/**
 * Brings storage and this tab's copy into agreement: writes the changes made
 * here, and takes in whatever another tab stored since.
 *
 * When the stored record is the one this tab last saw, the wallet in memory
 * already is that record plus the pending changes, and it is written as it
 * stands. When another tab wrote in between, the pending changes are applied
 * again to the record as stored now, so a tab with an old picture of the
 * wallet cannot write that picture over newer state. The key from unlock is
 * reused, so no write waits on PBKDF2.
 */
async function sync(live: Session): Promise<boolean> {
  const read = await vault().read(STORAGE_KEY);
  if (!read.ok) return noteSaveFailed();
  const raw = read.value;
  const envelope = parseEnvelope(raw);
  if (!envelope || envelope.salt !== live.vaultKey.salt) {
    // Another tab reset the wallet, replaced it or changed its password. A
    // change made here must not bring the old one back, and the phrase in
    // memory may no longer belong to what is stored.
    if (session === live) lockHere();
    exists = await hasStoredWallet();
    emit();
    return false;
  }

  const mine = session === live ? current : null;
  const unchanged = raw === lastRaw && mine !== null;
  if (live.pending.length === 0 && (unchanged || session !== live)) return true;
  const changes = live.pending.splice(0);

  let wallet: Wallet;
  let rev: number;
  if (unchanged) {
    wallet = mine;
    rev = revision;
  } else {
    const stored = await openRecord(live.vaultKey, envelope);
    if (!stored) {
      live.pending.unshift(...changes);
      return noteSaveFailed();
    }
    wallet = changes.reduce(apply, stored.wallet);
    rev = stored.rev;
  }

  let written = raw;
  if (changes.length > 0) {
    const sealed = await sealRecord(live.vaultKey, { rev: rev + 1, phrase: live.phrase, wallet });
    const outcome = await replace(raw, sealed);
    if (outcome === "changed") {
      live.pending.unshift(...changes);
      return sync(live);
    }
    if (outcome === "failed") {
      live.pending.unshift(...changes);
      return noteSaveFailed();
    }
    written = sealed;
    rev += 1;
    saveFailing = false;
  }

  if (session !== live) {
    // Locked while this was writing. Whoever unlocks next reads storage afresh.
    lastRaw = null;
    return true;
  }
  lastRaw = written;
  revision = rev;
  if (!unchanged) current = live.pending.reduce(apply, wallet);
  emit();
  return true;
}

/**
 * A change to the stored wallet, from this tab or any other. Another tab may
 * have replaced or reset the wallet, or changed its password: the phrase in
 * memory then belongs to the old one, and signing with it against the new
 * wallet's portfolios would spend from addresses the screen no longer shows,
 * so `sync` locks. A routine write from another tab is simply taken in. It
 * runs in turn with this tab's own writes, so a write of this tab's is never
 * mistaken for someone else's halfway through.
 */
function handleStored(key: string) {
  if (key === LOCK_SIGNAL_KEY) return handleLockSignal();
  if (key !== STORAGE_KEY && key !== LEGACY_STORAGE_KEY) return;
  void exclusive(async () => {
    const existed = exists;
    exists = await hasStoredWallet();
    // Reset from another tab: the session this tab holds goes with the wallet too.
    if (existed && !exists) await dropSession();
    const live = session;
    if (live) await sync(live);
    emit();
  }).catch(noteSaveFailed);
}

let stopWatching: (() => void) | null = null;

export function subscribe(listener: () => void) {
  if (listeners.size === 0) stopWatching = vault().subscribe(handleStored);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopWatching?.();
      stopWatching = null;
    }
  };
}

/** The decrypted wallet, or null while locked. */
export function getSnapshot(): Wallet | null {
  return current;
}

export function getServerSnapshot(): Wallet | null {
  return null;
}

let presence: Promise<void> | null = null;

/**
 * Whether a wallet is stored on this device. It is the one thing knowable
 * without the password, and all a locked tab needs: enough to show the
 * unlock prompt rather than onboarding.
 *
 * Undefined until the vault has answered. The first call asks it, and
 * subscribers hear when the answer arrives.
 */
export function walletExists(): boolean | undefined {
  if (exists === undefined) presence ??= readPresence();
  return exists;
}

async function readPresence() {
  await remove(STALE_SELECTION_KEY);
  const found = await hasStoredWallet();
  // A current wallet has been stored on this device, so an older plain text
  // copy is not its only phrase: a cleanup that failed before is tried again.
  if (parseEnvelope(await readRaw())) await purgePlaintext();
  // A reset or a new wallet in the meantime already says what is true.
  if (exists === undefined) {
    exists = found;
    emit();
  }
}

/** Whether the vault is refusing to store changes, so what the screen shows will not survive a reload. */
export function isSaveFailing(): boolean {
  return saveFailing;
}

/** Routine changes shown on screen whose write has not finished. */
let unsaved = 0;

/**
 * Whether a change on screen is not stored yet: it would be lost if the app
 * closed now. True from `updateWallet` until its write lands; it stays true,
 * with `isSaveFailing`, for a change the vault refused, until a later write
 * carries it.
 */
export function isSaving(): boolean {
  return unsaved > 0 || (session?.pending.length ?? 0) > 0;
}

/**
 * Whether an old plain text recovery phrase from an earlier version could not
 * be deleted from this device, and so may still be readable.
 */
export function isPlaintextCleanupFailing(): boolean {
  return plaintextLeft;
}

/** Moves on every lock, reset and wallet replacement. See `generation`. */
export function sessionGeneration(): number {
  return generation;
}

/**
 * Whether the wallet has stayed unlocked, without interruption, since
 * `since` was read from `sessionGeneration`. Checks the idle window first,
 * so asking is also what locks a wallet that sat past it.
 */
export function unlockedSince(since: number): boolean {
  lockIfIdle();
  return session !== null && generation === since;
}

/**
 * Routine updates - balances, labels, activity. Shown at once, then written
 * in the background; see `sync` for how a write from another tab is kept.
 * Resolves to whether the change reached storage. `change` may run more than
 * once, against a newer record than the one on screen.
 */
export function updateWallet(change: Change): Promise<boolean> {
  const live = session;
  if (!live || !current) return Promise.resolve(false);
  current = change(current);
  live.pending.push(change);
  unsaved += 1;
  emit();
  return exclusive(() => sync(live))
    .catch(noteSaveFailed)
    .finally(() => {
      unsaved -= 1;
      emit();
    });
}

/**
 * Takes in whatever another tab stored since this tab last looked, and
 * writes nothing. For a decision that must not be made on an old picture of
 * the wallet. False when the wallet is locked or could not be read.
 */
export function syncFromStorage(): Promise<boolean> {
  const live = session;
  if (!live) return Promise.resolve(false);
  return exclusive(() => sync(live)).catch(noteSaveFailed);
}

function install(vaultKey: VaultKey, stored: OpenRecord, raw: string | null) {
  session = { vaultKey, phrase: stored.phrase, pending: [] };
  current = stored.wallet;
  lastRaw = raw;
  revision = stored.rev;
  exists = true;
  saveFailing = false;
  armIdleLock();
  emit();
}

const {
  notSaved: NOT_SAVED,
  walletExists: WALLET_EXISTS,
  wrongPassword: WRONG_PASSWORD,
  interrupted: INTERRUPTED,
  damaged: DAMAGED,
  addressMismatch: ADDRESS_MISMATCH,
  changedElsewhere: CHANGED_ELSEWHERE,
  keyRefused: KEY_REFUSED,
  rekeyRefused: REKEY_REFUSED,
  rekeyNotUndone: REKEY_NOT_UNDONE,
  passwordChangeUnknown: PASSWORD_CHANGE_UNKNOWN,
} = walletCopy.store;

/**
 * Stores a new wallet and unlocks it in one step, for the two moments that
 * already have the phrase in hand: creating a wallet and importing one.
 *
 * Saves first and only then shows the wallet, so a vault that refuses the
 * write cannot report success for something that will be gone on the next
 * launch. Refuses when a wallet is already stored: onboarding left open in a
 * second tab must not replace, with one click, a wallet another tab created
 * in the meantime. Throws with a readable message.
 */
export async function storeNewWallet(
  wallet: Wallet,
  phrase: string[],
  password: string,
): Promise<void> {
  const stored: OpenRecord = { rev: 1, phrase, wallet };
  const vaultKey = await newVaultKey(password);
  const raw = await sealRecord(vaultKey, stored);
  await exclusive(async () => {
    if (await hasStoredWallet()) throw new Error(WALLET_EXISTS);
    const outcome = await replace(null, raw);
    if (outcome === "changed") throw new Error(WALLET_EXISTS);
    if (outcome === "failed") throw new Error(NOT_SAVED);
    generation += 1;
    install(vaultKey, stored, raw);
  });
  // There is a working wallet on this device now, so older plain text copies can go.
  await purgePlaintext();
}

export type ResetResult =
  | { ok: true }
  /** The vault kept the wallet: it is still on this device, locked. */
  | { ok: false; reason: "notRemoved" };

/**
 * Deletes the wallet from this device. The recovery phrase is the only way
 * back. Locks at once, so nothing more can be signed, and says the wallet is
 * gone only once the vault has removed and confirmed the removal of the
 * record, with the pending actions kept inside it, and of the previous
 * format's record. The anonymous session with NoirWire's server is dropped
 * with it, and a new one is made on the next request.
 */
export async function resetWallet(): Promise<ResetResult> {
  lockHere();
  saveFailing = false;
  emit();
  return exclusive(async () => {
    const removed = (await remove(STORAGE_KEY)) && (await remove(LEGACY_STORAGE_KEY));
    // A password change left unknown was about the record that is now gone.
    if (removed) unsettledRekey = null;
    // The session with NoirWire's server goes with the wallet, so the next
    // wallet on this device is not tied to this one by a session they share.
    if (removed) await dropSession();
    // Other tabs lock when they see the record gone, and nothing is left
    // behind, the lock signal included. A record that would not go is still
    // there for them to use, so they are told to lock.
    if (removed) await remove(LOCK_SIGNAL_KEY);
    else announceLock();
    exists = removed ? false : await hasStoredWallet();
    emit();
    return removed ? { ok: true as const } : { ok: false as const, reason: "notRemoved" as const };
  });
}

/**
 * The decrypted phrase, or null when the wallet is locked. Every signature
 * starts by asking for it, so this is also where an idle window that passed
 * while timers were not running (a sleeping laptop) is caught.
 */
export function getPhrase(): string[] | null {
  lockIfIdle();
  return session?.phrase ?? null;
}

export function isUnlocked(): boolean {
  return session !== null;
}

/**
 * Turns a wallet of the previous format into an encrypted record. The old
 * copy is removed only after the new one is stored and has been read back
 * and decrypted, so no failure along the way can leave the device without
 * the wallet.
 */
async function upgradeLegacy(password: string, started: number): Promise<string | null> {
  const legacyRaw = await readRaw(LEGACY_STORAGE_KEY);
  const legacy = parseLegacy(legacyRaw);
  if (!legacy) return walletCopy.store.noWallet;
  const { vault: legacyVault, ...legacyWallet } = legacy;
  const phrase = await decryptVault(legacyVault, password);
  if (!phrase) return WRONG_PASSWORD;
  const stored: OpenRecord = { rev: 1, phrase, wallet: fromStored(legacyWallet) };
  if (!addressesMatch(stored)) return ADDRESS_MISMATCH;

  const vaultKey = await newVaultKey(password);
  const raw = await sealRecord(vaultKey, stored);
  return exclusive(async () => {
    // Reset here or in another tab, or upgraded by another tab first, while
    // the key was being derived. Writing now would bring a deleted wallet back.
    if (generation !== started || (await readRaw(LEGACY_STORAGE_KEY)) !== legacyRaw) {
      return INTERRUPTED;
    }
    const outcome = await writeIf((current) => parseEnvelope(current) === null, raw);
    if (outcome === "changed") return INTERRUPTED;
    const written = outcome === "written" ? parseEnvelope(await readRaw()) : null;
    if (!written || !(await openRecord(vaultKey, written))) {
      await replace(raw, null);
      return NOT_SAVED;
    }
    await remove(LEGACY_STORAGE_KEY);
    if (generation !== started) return INTERRUPTED;
    install(vaultKey, stored, raw);
    return null;
  });
}

/** Null when the wallet was unlocked, else the reason it was not, in words to show. */
export type UnlockResult = string | null;

/**
 * Opens the current-format record under `vaultKey` and unlocks on success.
 * Both ways of unlocking end here, so they make the same checks: the record
 * decrypts and parses, every address is the one the phrase derives, and
 * nothing locked, reset or replaced the wallet while the key was on its way.
 */
async function unlockEnvelope(
  vaultKey: VaultKey,
  envelope: Envelope,
  raw: string | null,
  started: number,
  wrongKey: string,
): Promise<UnlockResult> {
  const plaintext = await open(vaultKey, envelope);
  if (plaintext === null) return wrongKey;
  const stored = parseRecord(plaintext);
  if (!stored) return DAMAGED;
  if (!addressesMatch(stored)) return ADDRESS_MISMATCH;
  if (generation !== started || parseEnvelope(await readRaw())?.salt !== envelope.salt) {
    return INTERRUPTED;
  }
  install(vaultKey, stored, raw);
  // Another tab may have written while the key was being derived.
  const live = session;
  if (live) void exclusive(() => sync(live)).catch(noteSaveFailed);
  return null;
}

/**
 * Decrypts the stored wallet with `password` and unlocks on success. Returns
 * null, or the reason nothing was unlocked.
 *
 * Deriving the key takes a moment, and the tab does not stand still for it:
 * it can be locked, reset, or see the wallet replaced from another tab. An
 * unlock that finishes after any of those is discarded rather than
 * installing a phrase for a wallet that is no longer the one stored.
 */
export async function unlock(password: string): Promise<UnlockResult> {
  const started = generation;
  const raw = await readRaw();
  const envelope = parseEnvelope(raw);

  const problem = envelope
    ? await unlockEnvelope(
        await vaultKeyFor(envelope, password),
        envelope,
        raw,
        started,
        WRONG_PASSWORD,
      )
    : await upgradeLegacy(password, started);
  if (problem) return problem;
  // There is a working wallet on this device now, so older plain text copies can go.
  await purgePlaintext();

  void assessPassword(password)
    .then((result) => {
      passwordIsWeak = !result.ok;
      emit();
    })
    .catch(() => {
      /* the strength check could not load; unlocking does not depend on it */
    });
  return null;
}

/**
 * Unlocks with the raw vault key a device keystore kept (see `vaultKeyBits`
 * in keystore.ts) instead of the password. Everything else is as `unlock`:
 * the same checks, the same discarding of a late result, the same cleanup
 * of old plain text phrases. A wallet still in the previous format has no
 * such key, and needs the password once to be upgraded.
 *
 * The bytes are imported into a key that holds its own copy; `bits` is the
 * caller's to zero.
 */
export async function unlockWithKeyBits(bits: Uint8Array): Promise<UnlockResult> {
  const started = generation;
  const raw = await readRaw();
  const envelope = parseEnvelope(raw);
  if (!envelope) {
    return parseLegacy(await readRaw(LEGACY_STORAGE_KEY)) ? KEY_REFUSED : walletCopy.store.noWallet;
  }
  let vaultKey: VaultKey;
  try {
    vaultKey = await vaultKeyFromBits(envelope, bits);
  } catch {
    return KEY_REFUSED;
  }
  const problem = await unlockEnvelope(vaultKey, envelope, raw, started, KEY_REFUSED);
  if (problem) return problem;
  await purgePlaintext();
  return null;
}

/**
 * Whether the password this session was unlocked with falls below today's
 * strength bar. Wallets created under the older, looser rule still open, and
 * this is how the app knows to ask for a stronger one. Held in memory only;
 * nothing about the password is ever stored.
 */
let passwordIsWeak = false;

export function isPasswordWeak(): boolean {
  return passwordIsWeak;
}

/**
 * Checks a password against the stored encrypted record, not the copy in
 * memory, and returns the phrase only if it matches. Used wherever a secret
 * is about to be shown, so an unlocked tab left open is not enough to read it.
 */
export async function verifyPassword(password: string): Promise<string[] | null> {
  const envelope = parseEnvelope(await readRaw());
  if (!envelope) return null;
  const stored = await openRecord(await vaultKeyFor(envelope, password), envelope);
  return stored?.phrase ?? null;
}

/**
 * What became of a password change. "changed": the stored record opens with
 * the new password (`notice` says what else to know, or is null).
 * "unchanged": it still opens with the old one (`reason` says why).
 * "indeterminate": a write failed and the record could not be read back, so
 * which password opens it is not known; another change is refused until a
 * read-back settles it.
 */
export type PasswordChange =
  | { outcome: "changed"; notice: string | null }
  | { outcome: "unchanged"; reason: string }
  | { outcome: "indeterminate"; reason: string };

const unchanged = (reason: string): PasswordChange => ({ outcome: "unchanged", reason });
const changed = (notice: string | null = null): PasswordChange => ({ outcome: "changed", notice });
const INDETERMINATE: PasswordChange = { outcome: "indeterminate", reason: PASSWORD_CHANGE_UNKNOWN };

/** A password change whose write failed and whose result is still to be read back. */
type UnsettledRekey = {
  oldKey: VaultKey;
  newKey: VaultKey;
  adopt(): void;
};

let unsettledRekey: UnsettledRekey | null = null;

/**
 * Reads the stored record back after a write that failed, to learn which key
 * opens it: the write may have landed before the failure was reported.
 * "replaced" when what is stored now is another record, or none.
 * "indeterminate" when the read fails too, or the record does not open.
 */
async function readBackRekey(
  pending: UnsettledRekey,
): Promise<"changed" | "unchanged" | "replaced" | "indeterminate"> {
  const read = await vault().read(STORAGE_KEY);
  if (!read.ok) return "indeterminate";
  const envelope = parseEnvelope(read.value);
  // Read back, and it is no longer the record either password sealed: it
  // was reset or replaced since, so there is nothing left to settle.
  if (
    !envelope ||
    (envelope.salt !== pending.newKey.salt && envelope.salt !== pending.oldKey.salt)
  ) {
    return "replaced";
  }
  if (envelope.salt === pending.newKey.salt && (await openRecord(pending.newKey, envelope))) {
    return "changed";
  }
  if (envelope.salt === pending.oldKey.salt && (await openRecord(pending.oldKey, envelope))) {
    return "unchanged";
  }
  return "indeterminate";
}

/** Settles a password change left unknown, if the record can be read now. */
async function settleUnsettledRekey(): Promise<"settled" | "indeterminate"> {
  const pending = unsettledRekey;
  if (!pending) return "settled";
  const found = await readBackRekey(pending);
  if (found === "indeterminate") return "indeterminate";
  if (found === "changed") pending.adopt();
  unsettledRekey = null;
  return "settled";
}

export type ChangePasswordOptions = {
  /**
   * Called once the record is stored under the new key, with that key's raw
   * bytes, for a platform that keeps the vault key in a device keystore.
   * False, or a throw, undoes the change: the record goes back to the one
   * sealed under the old password. The bytes are zeroed when it settles.
   */
  onRekey?: (bits: Uint8Array) => Promise<boolean>;
};

/**
 * Re-encrypts the wallet under a new password. The old one must decrypt the
 * stored copy first, so a borrowed unlocked session cannot lock the owner out.
 *
 * Two tabs changing the password, or one replacing the wallet while another
 * changes it, would otherwise let the slower write win and pair the wrong
 * ciphertext with the wrong wallet. So changes are serialised across tabs
 * (the platform's locks), the stored copy is re-read at the end, and nothing
 * is written unless it is still the record this change started from.
 *
 * Only the copy on this device changes. A copy someone already took keeps
 * opening with the old password, which the settings screen says plainly.
 */
export async function changePassword(
  current: string,
  next: string,
  { onRekey }: ChangePasswordOptions = {},
): Promise<PasswordChange> {
  const run = async (): Promise<PasswordChange> => {
    if ((await settleUnsettledRekey()) === "indeterminate") return INDETERMINATE;
    const before = parseEnvelope(await readRaw());
    if (!before) return unchanged(walletCopy.store.noWalletToChange);
    const oldKey = await vaultKeyFor(before, current);
    if ((await open(oldKey, before)) === null) {
      return unchanged(walletCopy.store.currentPasswordWrong);
    }
    if (next.normalize("NFKC") === current.normalize("NFKC")) {
      return unchanged(walletCopy.store.samePassword);
    }
    const strength = await assessPassword(next);
    if (!strength.ok) return unchanged(strength.reason);
    if (!onRekey) {
      const newKey = await newVaultKey(next);
      return exclusive(() => rekey(oldKey, newKey));
    }
    const { vaultKey: newKey, bits } = await newVaultKeyWithBits(next);
    try {
      return await exclusive(() => rekey(oldKey, newKey, () => onRekey(bits)));
    } finally {
      zeroBits(bits);
    }
  };

  try {
    return await serialised("noirwire-wallet-password", run);
  } catch (error) {
    return unchanged(
      error instanceof Error && error.message === NOT_SAVED
        ? NOT_SAVED
        : walletCopy.store.passwordNotChanged,
    );
  }
}

/** Whether a platform's `onRekey` accepted the new key. A throw is a refusal. */
async function accepted(confirm: () => Promise<boolean>): Promise<boolean> {
  try {
    return (await confirm()) === true;
  } catch {
    return false;
  }
}

/**
 * The write half of a password change: the record as stored now, under the
 * new key. With `confirm`, the change stands only once it accepts; until
 * then this tab keeps the old key, and a refusal writes the old record back
 * exactly as it was. Writes are held in turn meanwhile, so nothing of this
 * tab's lands under the new key only to be lost with it.
 */
async function rekey(
  oldKey: VaultKey,
  newKey: VaultKey,
  confirm?: () => Promise<boolean>,
): Promise<PasswordChange> {
  const latestRaw = await readRaw();
  const latest = parseEnvelope(latestRaw);
  const stored = latest && latest.salt === oldKey.salt ? await openRecord(oldKey, latest) : null;
  if (!stored) return unchanged(CHANGED_ELSEWHERE);

  // Changes this tab has not written yet go into the same write.
  const live = session?.vaultKey.salt === oldKey.salt ? session : null;
  const changes = live ? live.pending.splice(0) : [];
  const updated: OpenRecord = {
    ...stored,
    rev: stored.rev + 1,
    wallet: changes.reduce(apply, stored.wallet),
  };
  const raw = await sealRecord(newKey, updated);

  /** This tab carries on under the new key, with what it wrote. */
  const adopt = () => {
    if (live) live.vaultKey = newKey;
    if (live && session === live) {
      current = live.pending.reduce(apply, updated.wallet);
      lastRaw = raw;
      revision = updated.rev;
    } else {
      lastRaw = null;
    }
    passwordIsWeak = false;
    emit();
  };
  /** The old record stands, and the changes this tab had not written yet wait for the next write. */
  const keepOld = () => live?.pending.unshift(...changes);

  /**
   * After a write that reported failure, which may still have landed: read the
   * record back and say which password opens it. When it cannot be read, the
   * change is left unknown, and the next change settles it first.
   */
  const readBack = async (
    ifUnchanged: string,
    ifChanged: string | null,
  ): Promise<PasswordChange> => {
    const pending = { oldKey, newKey, adopt };
    const found = await readBackRekey(pending);
    if (found === "changed") {
      adopt();
      return changed(ifChanged);
    }
    keepOld();
    if (found === "unchanged") return unchanged(ifUnchanged);
    if (found === "replaced") return unchanged(CHANGED_ELSEWHERE);
    unsettledRekey = pending;
    return INDETERMINATE;
  };

  // Written only over the exact record this was built from.
  const outcome = await replace(latestRaw, raw);
  if (outcome === "changed") {
    keepOld();
    return unchanged(CHANGED_ELSEWHERE);
  }
  if (outcome === "failed") return readBack(NOT_SAVED, null);

  if (confirm && !(await accepted(confirm))) {
    const undone = await replace(raw, latestRaw);
    if (undone === "written") {
      keepOld();
      return unchanged(REKEY_REFUSED);
    }
    // When the old record did not go back, the new password is the one that
    // opens what is stored, and this tab carries on under it.
    if (undone === "failed") return readBack(REKEY_REFUSED, REKEY_NOT_UNDONE);
    adopt();
    return changed(REKEY_NOT_UNDONE);
  }

  adopt();
  return changed();
}

/** Forgets the key, the decrypted phrase and the decrypted wallet without touching the stored record. */
function lockHere() {
  generation += 1;
  session = null;
  current = null;
  disarmIdleLock();
  emit();
}

/** The signal this copy of the app last published, so its own echo is not taken for another's. */
let ownLockSignal: string | null = null;

/**
 * Tells every other running copy of the app to lock. The signal is a counter
 * under its own key: nothing secret, nothing about the wallet. One that
 * cannot be written is left at that: this copy is locked whatever happens.
 */
function announceLock() {
  void vault()
    .update(LOCK_SIGNAL_KEY, (stored) => {
      ownLockSignal = String((Number(stored) || 0) + 1);
      return { write: ownLockSignal };
    })
    .catch(() => undefined);
}

/** Another copy of the app announced a lock. One this copy announced itself is passed over. */
function handleLockSignal() {
  void vault()
    .read(LOCK_SIGNAL_KEY)
    .then((read) => {
      if (read.ok && read.value === ownLockSignal) return;
      if (session) lockHere();
    })
    .catch(() => {
      if (session) lockHere();
    });
}

/**
 * Locks the wallet: here at once, and in every other tab or running copy of
 * the app, which hear of it through the vault and lock themselves. A person
 * who locks their wallet has locked it everywhere it was open.
 */
export function lock() {
  lockHere();
  announceLock();
}
