import { connection } from "../solana/client.js";
import { isMainnet } from "../solana/config.js";
import { multiplierAt, multiplierSchedule } from "../solana/mintPolicy.mjs";
import { ALL_STOCKS } from "../solana/tokenRegistry.js";

/**
 * Each stock's display multiplier, read from its mint.
 *
 * The issuer's rule for Solana is exact: the on-chain balance never changes
 * for a dividend or a split, a multiplier on the mint does, and the balance
 * to show is the raw amount times that multiplier. Raw amounts go into
 * transactions. So the multiplier comes from the chain, not from a price
 * feed's copy of it.
 *
 * Every mint is read in one request, and a read is reused for ten minutes: a
 * new multiplier is published ahead of the moment it takes effect, and the
 * mint carries both, so a read stays right across the switch. A mint that
 * cannot be read keeps its last multiplier for an hour and is asked for again
 * a minute later; past the hour it has none, and that stock's amount and
 * value are shown as unavailable rather than guessed.
 *
 * The stock mints exist on mainnet only. On any other network there is
 * nothing to read and no real stock balance to scale, so the multiplier is 1.
 */

type Schedule = NonNullable<ReturnType<typeof multiplierSchedule>>;

const REFRESH_MS = 10 * 60 * 1000;
const MAX_AGE_MS = 60 * 60 * 1000;
/** The most accounts one getMultipleAccounts request takes. */
const ACCOUNTS_PER_REQUEST = 100;

/** A mint that could not be read is asked for again this soon, not after the full interval. */
const RETRY_MS = 60 * 1000;

const schedules = new Map<string, { schedule: Schedule; readAt: number }>();
let nextReadAt = 0;
let reading: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** Reads every mint. One that cannot be read keeps the schedule it had, until that is too old. */
async function read() {
  let missed = false;
  for (let start = 0; start < ALL_STOCKS.length; start += ACCOUNTS_PER_REQUEST) {
    const stocks = ALL_STOCKS.slice(start, start + ACCOUNTS_PER_REQUEST);
    const infos = await connection.getMultipleAccountsInfo(stocks.map((stock) => stock.mint));
    stocks.forEach((stock, index) => {
      const schedule = multiplierSchedule(stock.mint.toBase58(), infos[index]);
      if (schedule) schedules.set(stock.symbol, { schedule, readAt: Date.now() });
      else missed = true;
    });
  }
  nextReadAt = Date.now() + (missed ? RETRY_MS : REFRESH_MS);
}

/** Reads the multipliers unless a recent read is still good. Never throws. */
export function refreshMultipliers(): Promise<void> {
  if (!isMainnet() || Date.now() < nextReadAt) return Promise.resolve();
  reading ??= read()
    .catch(() => {
      nextReadAt = Date.now() + RETRY_MS;
    })
    .finally(() => {
      reading = null;
      listeners.forEach((listener) => listener());
    });
  return reading;
}

export function onMultipliersChange(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The multiplier in force right now for a stock, or undefined while it is not known. */
export function stockMultiplier(symbol: string): number | undefined {
  if (!isMainnet()) return 1;
  const known = schedules.get(symbol);
  if (!known || Date.now() - known.readAt > MAX_AGE_MS) return undefined;
  return multiplierAt(known.schedule, Date.now() / 1000);
}
