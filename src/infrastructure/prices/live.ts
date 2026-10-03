import type { LivePrice } from "./liveSource.js";
import { relayInit, relayUrl } from "../httpConfig.js";
import { readFetch } from "../readFetch.js";
import { onMultipliersChange, refreshMultipliers } from "./multipliers.js";

/**
 * Live prices as an app gets them: from its own relay's `/api/prices`,
 * which reads Jupiter's index once for everyone and caches it.
 *
 * Polled only while a screen that shows prices is mounted and the app is in
 * view. A tab or an app left in the background asks for nothing, and catches
 * up the moment it is looked at again.
 */

/**
 * Whether the app is out of view, and word when that changes: the document's
 * visibility on the web, the app state on mobile. Each app passes its own.
 */
export type Visibility = {
  hidden(): boolean;
  subscribe(onChange: () => void): () => void;
};

export const POLL_MS = 30_000;
/** Past this age a price stops counting as live, so an outage cannot keep yesterday's number labelled current. */
const FRESH_MS = 120_000;

let prices = new Map<string, LivePrice>();
let updatedAt: number | null = null;
/** Bumped on every poll, success or failure, so screens re-check freshness even when nothing new arrives. */
let version = 0;
const listeners = new Set<() => void>();
let subscribers = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let lastPoll = 0;
let visibility: Visibility | null = null;
let stopListening: (() => void) | null = null;

async function refresh() {
  lastPoll = Date.now();
  // A stock's value needs its multiplier as well as its price; this asks the
  // chain only when the last read has aged out.
  void refreshMultipliers();
  try {
    const response = await readFetch(relayUrl("/api/prices"), relayInit());
    if (response.ok) {
      const payload = (await response.json()) as { prices: Record<string, LivePrice> | null };
      if (payload.prices) {
        prices = new Map(Object.entries(payload.prices));
        // Aged from when the source supplied them: a copy the cache held for a
        // minute is a minute old, however recently it arrived here.
        updatedAt = Date.now() - (Number(response.headers.get("age")) || 0) * 1000;
      }
    }
  } catch {
    /* the last prices age out on their own */
  }
  version += 1;
  listeners.forEach((listener) => listener());
}

function isFresh(): boolean {
  return updatedAt !== null && Date.now() - updatedAt < FRESH_MS;
}

export function livePrice(symbol: string): LivePrice | undefined {
  return isFresh() ? prices.get(symbol) : undefined;
}

/** Hears of every poll, and of every multiplier read, which can change a value too. */
export function subscribeLivePrices(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Moves on every poll, success or failure, so a screen re-checks freshness even when nothing new arrives. */
export function livePricesVersion(): number {
  return version;
}

/** When prices were last fetched, or null when there is no fresh price at all. */
export function livePricesUpdatedAt(): number | null {
  return isFresh() ? updatedAt : null;
}

onMultipliersChange(() => {
  version += 1;
  listeners.forEach((listener) => listener());
});

function startPolling() {
  if (timer || visibility?.hidden()) return;
  // Moving between screens restarts this; prices read seconds ago are not read again.
  if (Date.now() - lastPoll >= POLL_MS) void refresh();
  else void refreshMultipliers();
  timer = setInterval(refresh, POLL_MS);
}

function stopPolling() {
  if (timer) clearInterval(timer);
  timer = null;
}

function onVisibilityChange() {
  if (visibility?.hidden()) stopPolling();
  else startPolling();
}

/**
 * Keeps prices polled while any screen that shows them is open, and only
 * while the app is in view. Returns what stops this screen's interest.
 */
export function watchLivePrices(view: Visibility): () => void {
  subscribers += 1;
  if (subscribers === 1) {
    visibility = view;
    stopListening = view.subscribe(onVisibilityChange);
    startPolling();
  }
  return () => {
    subscribers -= 1;
    if (subscribers === 0) {
      stopListening?.();
      stopListening = null;
      visibility = null;
      stopPolling();
    }
  };
}
