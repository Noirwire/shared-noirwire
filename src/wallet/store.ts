import { getPlatform } from "../platform.js";
import { walletCopy } from "../copy/wallet.js";
import { deriveKeypair, FUNDING_DERIVATION_INDEX } from "../infrastructure/solana/keys.js";
import {
  decryptVault,
  isEncryptedVault,
  isEnvelope,
  newVaultKey,
  open,
  seal,
  vaultKeyFor,
  type EncryptedVault,
  type Envelope,
  type VaultKey,
} from "./keystore.js";
import { assessPassword } from "./passwordStrength.js";
import { ACTIVITY_KINDS, type Wallet } from "../domain/wallet.js";
import {
  LEGACY_STORAGE_KEY,
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
  lock();
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
    !Array.isArray(value.accounts) ||
    !Array.isArray(value.activity) ||
    !Array.isArray(value.watchlist) ||
    !value.watchlist.every(text)
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
      portfolioIds.has(entry.accountId) &&
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
async function purgePlaintext() {
  await Promise.all(PLAINTEXT_STORAGE_KEYS.map(remove));
}

/** Removes `key`. A vault that cannot be written holds nothing this could remove either. */
async function remove(key: string) {
  await vault().update(key, (current) => (current === null ? { keep: true } : { write: null }));
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
    if (session === live) lock();
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
  if (key !== STORAGE_KEY && key !== LEGACY_STORAGE_KEY) return;
  void exclusive(async () => {
    exists = await hasStoredWallet();
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
  emit();
  return exclusive(() => sync(live)).catch(noteSaveFailed);
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
  // There is a working wallet on this device now, so older plain text copies can go.
  void purgePlaintext();
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
}

/** Deletes the wallet from this device. The recovery phrase is the only way back. */
export function resetWallet() {
  lock();
  exists = false;
  saveFailing = false;
  emit();
  void exclusive(async () => {
    await remove(STORAGE_KEY);
    await remove(LEGACY_STORAGE_KEY);
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

/**
 * Decrypts the stored wallet with `password` and unlocks on success. Returns
 * null, or the reason nothing was unlocked.
 *
 * Deriving the key takes a moment, and the tab does not stand still for it:
 * it can be locked, reset, or see the wallet replaced from another tab. An
 * unlock that finishes after any of those is discarded rather than
 * installing a phrase for a wallet that is no longer the one stored.
 */
export async function unlock(password: string): Promise<string | null> {
  const started = generation;
  const raw = await readRaw();
  const envelope = parseEnvelope(raw);

  if (!envelope) {
    const problem = await upgradeLegacy(password, started);
    if (problem) return problem;
  } else {
    const vaultKey = await vaultKeyFor(envelope, password);
    const plaintext = await open(vaultKey, envelope);
    if (plaintext === null) return WRONG_PASSWORD;
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
  }

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
export async function changePassword(current: string, next: string): Promise<string | null> {
  const run = async (): Promise<string | null> => {
    const before = parseEnvelope(await readRaw());
    if (!before) return walletCopy.store.noWalletToChange;
    const oldKey = await vaultKeyFor(before, current);
    if ((await open(oldKey, before)) === null) return walletCopy.store.currentPasswordWrong;
    const strength = await assessPassword(next);
    if (!strength.ok) return strength.reason;
    const newKey = await newVaultKey(next);

    return exclusive(() => rekey(oldKey, newKey));
  };

  try {
    return await serialised("noirwire-wallet-password", run);
  } catch (error) {
    return error instanceof Error && error.message === NOT_SAVED
      ? NOT_SAVED
      : walletCopy.store.passwordNotChanged;
  }
}

/** The write half of a password change: the record as stored now, under the new key. */
async function rekey(oldKey: VaultKey, newKey: VaultKey): Promise<string | null> {
  const latestRaw = await readRaw();
  const latest = parseEnvelope(latestRaw);
  const stored = latest && latest.salt === oldKey.salt ? await openRecord(oldKey, latest) : null;
  if (!stored) return CHANGED_ELSEWHERE;

  // Changes this tab has not written yet go into the same write.
  const live = session?.vaultKey.salt === oldKey.salt ? session : null;
  const changes = live ? live.pending.splice(0) : [];
  const updated: OpenRecord = {
    ...stored,
    rev: stored.rev + 1,
    wallet: changes.reduce(apply, stored.wallet),
  };
  const raw = await sealRecord(newKey, updated);
  // Written only over the exact record this was built from.
  const outcome = await replace(latestRaw, raw);
  if (outcome === "changed") {
    live?.pending.unshift(...changes);
    return CHANGED_ELSEWHERE;
  }
  if (outcome === "failed") {
    live?.pending.unshift(...changes);
    throw new Error(NOT_SAVED);
  }

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
  return null;
}

/** Forgets the key, the decrypted phrase and the decrypted wallet without touching the stored record. */
export function lock() {
  generation += 1;
  session = null;
  current = null;
  disarmIdleLock();
  emit();
}
