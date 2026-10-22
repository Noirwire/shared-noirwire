import { isDecimalText } from "./decimal.js";

/**
 * How the order book's numbers are written. A price, a size or a quote
 * amount arrives as a decimal string and is written from its digits, never
 * through a floating-point number, at a fixed number of places so columns
 * of figures line up. Each formatter answers null for a value it cannot
 * read; what a screen says instead is the screen's choice.
 */

function grouped(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * A decimal string at exactly `decimals` places, grouped in thousands and
 * rounded half away from zero: "1,234.50". A value that is not zero but
 * rounds to zero is written as a bound ("<0.01", ">-0.01"), never as zero.
 */
export function orderbookDecimal(value: string, decimals: number): string | null {
  if (!isDecimalText(value)) return null;
  const places = Math.max(Math.floor(decimals), 0);
  const trimmed = value.trim();
  const negative = trimmed.startsWith("-");
  const [whole, fraction = ""] = (negative ? trimmed.slice(1) : trimmed).split(".");
  const kept = BigInt(whole + fraction.slice(0, places).padEnd(places, "0"));
  const rounded = kept + ((fraction[places] ?? "0") >= "5" ? 1n : 0n);
  if (rounded === 0n) {
    if (!/[1-9]/.test(whole + fraction)) return places > 0 ? `0.${"0".repeat(places)}` : "0";
    const smallest = places > 0 ? `0.${"0".repeat(places - 1)}1` : "1";
    return negative ? `>-${smallest}` : `<${smallest}`;
  }
  const digits = rounded.toString().padStart(places + 1, "0");
  const integer = grouped(digits.slice(0, digits.length - places));
  const sign = negative ? "-" : "";
  return places > 0 ? `${sign}${integer}.${digits.slice(-places)}` : `${sign}${integer}`;
}

/**
 * An amount of the market's quote token, named by `quoteSymbol` as the
 * venue names it (nUSD, USDC): "12.50 USDC". Never a dollar sign. With no
 * symbol known yet, the number alone.
 */
export function quoteAmount(value: string, quoteSymbol: string, decimals = 2): string | null {
  const amount = orderbookDecimal(value, decimals);
  if (amount === null) return null;
  return quoteSymbol ? `${amount} ${quoteSymbol}` : amount;
}

/** A latency: whole milliseconds below a second ("420 ms"), seconds to two places from there ("1.24 s"). */
export function durationText(ms: number): string | null {
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

/** "14:03:05.006", by the device's clock: when an order event happened. */
export function clockTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

/** The clock time of an event from the same day as `now`, and "2026-01-05" for an older one. */
export function eventTime(timestamp: number, now: number): string {
  const date = new Date(timestamp);
  if (date.toDateString() === new Date(now).toDateString()) return clockTime(timestamp);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** How old something is, in its largest whole unit: "just now", "4s", "12m", "3h", "2d". */
export function ageText(ms: number): string | null {
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return "just now";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
