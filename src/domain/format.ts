export function shortAddress(address: string, lead = 4, tail = 4) {
  return `${address.slice(0, lead)}...${address.slice(-tail)}`;
}

export function usd(amount: number) {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function shares(amount: number) {
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

/** A real SPL token amount in its own unit (not a dollar sign): two decimals, matching its real-money-like role. */
export function tokenAmount(amount: number) {
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** USDC reads like money, with two decimals. Everything else is held in shares, with four. */
export function symbolAmount(symbol: string, amount: number) {
  return symbol === "USDC" ? `${tokenAmount(amount)} ${symbol}` : `${shares(amount)} ${symbol}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * "3 Sep 2026", by the device's calendar. Written out rather than left to the
 * runtime's locale data, which spells September "Sept" on Node and in some
 * phone builds.
 */
export function sinceDate(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** "3 Sep 2026, 14:32", by the device's calendar and clock. */
export function dateAndTime(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${sinceDate(timestamp)}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "3 September", as a screen reader says a day. */
export function spokenDay(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getDate()} ${LONG_MONTHS[date.getMonth()]}`;
}

export type ChangeTone = "safe" | "danger" | "neutral";

/** A change of exactly zero is neither a gain nor a loss, and is never shown as one. */
export function changeTone(value: number): ChangeTone {
  if (value === 0) return "neutral";
  return value > 0 ? "safe" : "danger";
}

function changeSign(value: number) {
  if (value === 0) return "";
  return value > 0 ? "+" : "-";
}

/** A signed percentage alone, or a signed dollar gain with its percentage. Zero carries no sign. */
export function deltaText(percent: number, gain?: number) {
  const sign = changeSign(gain ?? percent);
  return gain === undefined
    ? `${sign}${Math.abs(percent).toFixed(2)}%`
    : `${sign}${usd(Math.abs(gain))} (${Math.abs(percent).toFixed(1)}%)`;
}
