import type { VaultRepository } from "../platform.js";
import {
  NO_PENDING_ACTION,
  pendingReducer,
  type PendingAction,
  type PendingEvent,
} from "./pending.js";

/** The vault key under which every intent's pending action is kept, as one record. */
export const PENDING_ACTIONS_KEY = "pendingActions";

type PendingActions = Record<string, PendingAction>;

export type RecordOutcome =
  | { recorded: true; pending: PendingAction }
  /** `refused`: the event does not apply to the intent's current state, which is `pending`. */
  | { recorded: false; reason: "refused"; pending: PendingAction }
  /** `unavailable`: the vault could not be read or written, or holds something unreadable. Nothing was recorded. */
  | { recorded: false; reason: "unavailable" };

const STATUSES = new Set(["none", "reserved", "submitted", "unknown", "landed", "expired"]);

function isPendingAction(value: unknown): value is PendingAction {
  if (typeof value !== "object" || value === null) return false;
  const { status, signature, lastValidBlockHeight } = value as Record<string, unknown>;
  if (typeof status !== "string" || !STATUSES.has(status)) return false;
  if (signature !== undefined && typeof signature !== "string") return false;
  if (lastValidBlockHeight !== undefined && !Number.isInteger(lastValidBlockHeight)) return false;
  if (status === "submitted") return signature !== undefined && lastValidBlockHeight !== undefined;
  return true;
}

function decode(stored: string | null): PendingActions | null {
  if (stored === null) return {};
  try {
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return Object.values(parsed).every(isPendingAction) ? (parsed as PendingActions) : null;
  } catch {
    return null;
  }
}

/**
 * Applies `event` to `intent`'s pending action and stores the result in one
 * atomic vault update, so two confirms, from two taps or two tabs, cannot
 * both pass the check before either is recorded.
 */
export async function recordPendingEvent(
  vault: VaultRepository,
  intent: string,
  event: PendingEvent,
): Promise<RecordOutcome> {
  let outcome: RecordOutcome = { recorded: false, reason: "unavailable" };
  const update = await vault.update(PENDING_ACTIONS_KEY, (stored) => {
    const all = decode(stored);
    if (!all) return { keep: true };
    const before = all[intent] ?? NO_PENDING_ACTION;
    const after = pendingReducer(before, event);
    if (after === before) {
      outcome = { recorded: false, reason: "refused", pending: before };
      return { keep: true };
    }
    outcome = { recorded: true, pending: after };
    const next = { ...all, [intent]: after };
    if (after.status === "none") delete next[intent];
    return { write: JSON.stringify(next) };
  });
  if (update.persisted || (update.reason === "kept" && !outcome.recorded)) return outcome;
  return { recorded: false, reason: "unavailable" };
}

/**
 * Reserves `intent` before anything is signed. Anything but `reserved` means
 * do not sign: the intent is still unsettled, or the reservation could not
 * be stored and so would not protect anything.
 */
export async function reserveIntent(
  vault: VaultRepository,
  intent: string,
): Promise<"reserved" | "busy" | "unavailable"> {
  const outcome = await recordPendingEvent(vault, intent, { type: "reserve" });
  if (outcome.recorded) return "reserved";
  return outcome.reason === "refused" ? "busy" : "unavailable";
}

/** `intent`'s pending action as stored, or null when the vault cannot say. */
export async function readPendingAction(
  vault: VaultRepository,
  intent: string,
): Promise<PendingAction | null> {
  const read = await vault.read(PENDING_ACTIONS_KEY);
  const all = read.ok ? decode(read.value) : null;
  return all ? (all[intent] ?? NO_PENDING_ACTION) : null;
}
