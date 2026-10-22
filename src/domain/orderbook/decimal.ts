/**
 * Order book math (margin, fees, liquidation, tick and lot checks) runs on
 * bigint, never on floating point. Every decimal string the venue serves or
 * a trader types is read into a fixed-point bigint at this one scale before
 * any arithmetic, and written back to a string only to be shown.
 */
export const FIXED_POINT_SCALE = 1_000_000_000n;
const FIXED_POINT_DIGITS = 9;

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** Whether the text is a plain decimal number: digits, an optional sign and fraction, nothing else. */
export function isDecimalText(text: string): boolean {
  return DECIMAL.test(text.trim());
}

/**
 * The decimal string at the fixed-point scale. Throws on text that is not a
 * plain decimal, and on one with a nonzero digit past the ninth decimal,
 * which this scale cannot hold and would otherwise drop without a word.
 */
export function toFixedPoint(text: string): bigint {
  const trimmed = text.trim();
  if (!DECIMAL.test(trimmed)) throw new Error(`Not a decimal number: "${text}"`);
  const negative = trimmed.startsWith("-");
  const [whole, fraction = ""] = (negative ? trimmed.slice(1) : trimmed).split(".");
  if (/[1-9]/.test(fraction.slice(FIXED_POINT_DIGITS))) {
    throw new Error(`More than ${FIXED_POINT_DIGITS} decimals: "${text}"`);
  }
  const digits = fraction.slice(0, FIXED_POINT_DIGITS).padEnd(FIXED_POINT_DIGITS, "0");
  const value = BigInt(whole) * FIXED_POINT_SCALE + BigInt(digits);
  return negative ? -value : value;
}

/** The decimal string at the fixed-point scale, or null when `toFixedPoint` would throw. */
export function readFixedPoint(text: string): bigint | null {
  try {
    return toFixedPoint(text);
  } catch {
    return null;
  }
}

/** A fixed-point value as a decimal string with exactly `decimals` places, cut toward zero. */
export function fromFixedPoint(value: bigint, decimals: number): string {
  const sign = value < 0n ? "-" : "";
  const magnitude = value < 0n ? -value : value;
  const whole = magnitude / FIXED_POINT_SCALE;
  if (decimals <= 0) return `${sign}${whole}`;
  const fraction = (magnitude % FIXED_POINT_SCALE).toString().padStart(FIXED_POINT_DIGITS, "0");
  return `${sign}${whole}.${fraction.slice(0, decimals).padEnd(decimals, "0")}`;
}

export function mulFixedPoint(a: bigint, b: bigint): bigint {
  return (a * b) / FIXED_POINT_SCALE;
}

export function divFixedPoint(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("Division by zero");
  return (a * FIXED_POINT_SCALE) / b;
}
