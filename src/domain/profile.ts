import type { PortfolioIcon } from "./portfolioIcon.js";
import type { PieSlice, Portfolio, Wallet } from "./wallet.js";

/**
 * The wallet's own labels as the record that mirrors them off the device:
 * what a portfolio is called, its mark, whether it is archived, its pie, and
 * the watchlist. The device's wallet is the truth and the record a copy of
 * it, so everything here reads a record it cannot follow as no record.
 *
 * Never in it: a balance, a holding, an address, activity, a pending action.
 */

/** The envelope version this package writes. */
export const PROFILE_VERSION = 1;

/** The most bytes a record can ever be, sealed. One that reads as longer is not a record. */
export const MAX_PROFILE_BYTES = 4096;

/** One field: how many times it has been rewritten, and what it holds. */
export type ProfileField = readonly [revision: number, value: unknown];

/**
 * The record before it is sealed. `v` is the version its writer speaks, and
 * `m` the lowest version a reader must speak to be allowed to write: one
 * below it reads what it follows and writes nothing.
 */
export type ProfileEnvelope = {
  v: number;
  m: number;
  f: Record<string, ProfileField>;
};

const WATCHLIST = "w";

/**
 * The highest derivation index a mirrored portfolio may have, and so the
 * most portfolios a mirror can make a device create. A record holds some
 * twenty portfolios at most, and an import never looks further than this
 * past the last one used (`EXTENDED_DISCOVERY_GAP`). A field past it is
 * kept as it came and never becomes a portfolio.
 */
export const MAX_MIRRORED_PORTFOLIO_INDEX = 100;

const PORTFOLIO_FIELD = /^p([1-9]\d{0,2})$/;

/**
 * The derivation index a portfolio's field names: `p` and the index, which
 * the funding wallet's 0 never is. Null for any other field, and for an
 * index past `MAX_MIRRORED_PORTFOLIO_INDEX`.
 */
function portfolioIndexOf(id: string): number | null {
  const index = Number(PORTFOLIO_FIELD.exec(id)?.[1]);
  return Number.isInteger(index) && index <= MAX_MIRRORED_PORTFOLIO_INDEX ? index : null;
}

/** The keys of a portfolio's value this version writes. Any other is a newer version's, and is kept. */
const PORTFOLIO_KEYS = ["l", "c", "a", "i", "s"];

/** What of a portfolio is a label: everything a person set, and nothing the chain says. */
export type PortfolioLabels = Pick<Portfolio, "label" | "createdAt" | "archivedAt"> & {
  pie?: PieSlice[];
  icon?: PortfolioIcon;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

const isMoment = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

function portfolioValue({ label, createdAt, archivedAt, icon, pie }: PortfolioLabels) {
  return {
    l: label,
    c: createdAt,
    a: archivedAt,
    ...(icon ? { i: [icon.glyph, icon.tint] } : {}),
    ...(pie ? { s: pie.map((slice) => [slice.symbol, slice.weight]) } : {}),
  };
}

function watchlistIn(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((symbol) => typeof symbol === "string") ? value : null;
}

function iconIn(value: unknown): PortfolioIcon | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [glyph, tint] = value as unknown[];
  // A glyph or tint from a newer catalog is kept: the screens fall back when they draw it.
  return typeof glyph === "string" && typeof tint === "string"
    ? ({ glyph, tint } as PortfolioIcon)
    : null;
}

function pieIn(value: unknown): PieSlice[] | null {
  if (!Array.isArray(value)) return null;
  const slices: PieSlice[] = [];
  for (const slice of value as unknown[]) {
    if (!Array.isArray(slice) || slice.length !== 2) return null;
    const [symbol, weight] = slice as unknown[];
    if (typeof symbol !== "string" || !Number.isInteger(weight)) return null;
    slices.push({ symbol, weight: weight as number });
  }
  return slices;
}

/** The labels a portfolio's value holds, or null for one this version cannot follow. */
function portfolioLabelsIn(value: unknown): PortfolioLabels | null {
  if (!isRecord(value)) return null;
  const { l, c, a, i, s } = value;
  if (typeof l !== "string" || !isMoment(c) || (a !== null && !isMoment(a))) return null;
  const icon = i === undefined ? undefined : iconIn(i);
  const pie = s === undefined ? undefined : pieIn(s);
  if (icon === null || pie === null) return null;
  return {
    label: l,
    createdAt: c,
    archivedAt: a,
    ...(icon ? { icon } : {}),
    ...(pie ? { pie } : {}),
  };
}

/**
 * A field's value as this version reads it, written one way so two values
 * that say the same compare equal whatever else a newer version put beside
 * them. Null for a field, or a value, this version does not know.
 */
function readAs(id: string, value: unknown): string | null {
  if (id === WATCHLIST) {
    const watchlist = watchlistIn(value);
    return watchlist && JSON.stringify(watchlist);
  }
  if (portfolioIndexOf(id) === null) return null;
  const labels = portfolioLabelsIn(value);
  return labels && JSON.stringify(portfolioValue(labels));
}

/** The wallet's labels as the fields of a record, by field id. */
export function profileFieldsOf(wallet: Wallet): Record<string, unknown> {
  return Object.fromEntries([
    [WATCHLIST, wallet.watchlist],
    ...wallet.portfolios.map((portfolio) => [
      `p${portfolio.derivationIndex}`,
      portfolioValue(portfolio),
    ]),
  ]);
}

/** A record as the text that is sealed: compact JSON. */
export function encodeProfile({ v, m, f }: ProfileEnvelope): string {
  return JSON.stringify({ v, m, f });
}

function isField(value: unknown): value is ProfileField {
  return Array.isArray(value) && value.length === 2 && isCount(value[0]);
}

/** The record in `text`, or null when it is not one. A field that is not a revision and a value is left out. */
export function decodeProfile(text: string): ProfileEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const { v, m, f } = parsed;
  if (!isCount(v) || !isCount(m) || !isRecord(f)) return null;
  const fields = new Map<string, ProfileField>();
  for (const [id, field] of Object.entries(f)) if (isField(field)) fields.set(id, field);
  return { v, m, f: Object.fromEntries(fields) };
}

/** Whether this version may write over `mirror`. Nothing there yet is always writable. */
export function mayWriteProfile(mirror: ProfileEnvelope | null): boolean {
  return mirror === null || mirror.m <= PROFILE_VERSION;
}

/** A label the mirror holds that the device is to take. */
export type ProfileChange = {
  id: string;
  /** The device's own value when the two were compared, or null when it had none. */
  seen: string | null;
  value: unknown;
};

export type ProfileMerge = {
  /**
   * What the device keeps as its last synced copy. When `write` is set it is
   * also what the mirror is to hold, and is kept only once it does.
   */
  envelope: ProfileEnvelope;
  /** What the device takes from the mirror. */
  changes: ProfileChange[];
  /** Whether the mirror has to be written: it holds something else, or nothing. */
  write: boolean;
};

/** `mine` with the keys of `theirs` that this version does not write, unchanged. */
function withUnknownKeys(mine: unknown, theirs: unknown): unknown {
  if (!isRecord(mine) || !isRecord(theirs)) return mine;
  const unknown = Object.entries(theirs).filter(([key]) => !PORTFOLIO_KEYS.includes(key));
  return { ...Object.fromEntries(unknown), ...mine };
}

/**
 * Brings the device's labels and the mirror together, field by field, with
 * the copy this device last synced (`synced`) telling which side changed.
 *
 * - Only the mirror has it, and the device never synced it: the device
 *   takes it. That is a device that has never synced, or a field another
 *   device added since.
 * - Only the mirror has it, and the device did sync it once: the device
 *   took it off since, so the device wins and the field leaves the mirror.
 * - Only the device has it: it goes out, at revision 1.
 * - The device's value is as it was last synced, or was never synced: the
 *   mirror's stands, and the device takes it when its revision is higher.
 *   So the mirror wins on a device that has never synced, which is how a
 *   restored wallet gets its names back.
 * - The device's value changed since: the device wins, one revision past
 *   the higher of the mirror's and the last synced.
 *
 * Revisions decide, never a clock. A field this version does not know, and a
 * value it cannot follow, pass through untouched, as do the keys a newer
 * version put inside a value this one rewrites. A mirror this version may
 * not write is still read: the device takes what it follows from it, and
 * its own changes wait.
 */
export function mergeProfile(input: {
  device: Record<string, unknown>;
  synced: ProfileEnvelope | null;
  mirror: ProfileEnvelope | null;
}): ProfileMerge {
  const { device, synced, mirror } = input;
  const mayWrite = mayWriteProfile(mirror);
  const fields = new Map<string, ProfileField>();
  const changes: ProfileChange[] = [];

  for (const [id, field] of Object.entries((mirror ?? synced)?.f ?? {})) {
    if (readAs(id, field[1]) === null) fields.set(id, field);
  }

  for (const id of new Set([...Object.keys(device), ...Object.keys(mirror?.f ?? {})])) {
    if (fields.has(id)) continue;
    const mine = device[id];
    const theirs = mirror?.f[id];
    const last = synced?.f[id];

    if (mine === undefined) {
      if (!theirs) continue;
      if (last) {
        // Synced before and gone from the device since: taken off here, so it
        // is left out. A mirror that may not be written keeps the removal waiting.
        if (!mayWrite) fields.set(id, last);
        continue;
      }
      fields.set(id, theirs);
      changes.push({ id, seen: null, value: theirs[1] });
      continue;
    }
    const seen = readAs(id, mine);
    if (seen === null) continue;
    const changedHere = last !== undefined && readAs(id, last[1]) !== seen;

    if (theirs && (!changedHere || readAs(id, theirs[1]) === seen)) {
      fields.set(id, theirs);
      const newer = theirs[0] > (last?.[0] ?? 0);
      if (newer && readAs(id, theirs[1]) !== seen) changes.push({ id, seen, value: theirs[1] });
      continue;
    }
    if (!mayWrite || (last && !changedHere)) {
      if (last) fields.set(id, last);
      continue;
    }
    const revision = Math.max(theirs?.[0] ?? 0, last?.[0] ?? 0) + 1;
    fields.set(id, [revision, withUnknownKeys(mine, (theirs ?? last)?.[1])]);
  }

  const sorted = [...fields].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    envelope: {
      v: mayWrite ? PROFILE_VERSION : mirror!.v,
      m: mirror?.m ?? PROFILE_VERSION,
      f: Object.fromEntries(sorted),
    },
    changes,
    write:
      mayWrite &&
      (sorted.some(([id, field]) => mirror?.f[id] !== field) ||
        Object.keys(mirror?.f ?? {}).some((id) => !fields.has(id))),
  };
}

function withLabels(portfolio: Portfolio, labels: PortfolioLabels): Portfolio {
  const next: Portfolio = { ...portfolio, ...labels };
  // A mark or a pie the mirror no longer holds was taken off elsewhere.
  if (!labels.pie) delete next.pie;
  if (!labels.icon) delete next.icon;
  return next;
}

/**
 * `wallet` with the labels it is to take from the mirror. A label that was
 * changed on the device since the two were compared is left as it is now:
 * that change is the newer one, and the next sync sends it. A portfolio the
 * wallet does not have is made by `restore`, at the field's derivation
 * index; one `restore` cannot make is left for the next sync.
 */
export function withProfileChanges(
  wallet: Wallet,
  changes: readonly ProfileChange[],
  restore: (derivationIndex: number, label: string) => Portfolio | null,
): Wallet {
  const fields = profileFieldsOf(wallet);
  let { watchlist, portfolios } = wallet;
  const restored: Portfolio[] = [];

  for (const { id, seen, value } of changes) {
    const mine = fields[id];
    if ((mine === undefined ? null : readAs(id, mine)) !== seen) continue;
    if (id === WATCHLIST) {
      watchlist = watchlistIn(value) ?? watchlist;
      continue;
    }
    const index = portfolioIndexOf(id);
    const labels = portfolioLabelsIn(value);
    if (!labels || index === null) continue;
    if (mine !== undefined) {
      portfolios = portfolios.map((portfolio) =>
        portfolio.derivationIndex === index ? withLabels(portfolio, labels) : portfolio,
      );
      continue;
    }
    const made = restore(index, labels.label);
    if (made) restored.push(withLabels(made, labels));
  }

  if (watchlist === wallet.watchlist && portfolios === wallet.portfolios && restored.length === 0) {
    return wallet;
  }
  // Newest first, as creating them one by one would have left them.
  restored.sort((a, b) => b.derivationIndex - a.derivationIndex);
  return { ...wallet, watchlist, portfolios: [...restored, ...portfolios] };
}
