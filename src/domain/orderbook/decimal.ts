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

const UNSIGNED_DECIMAL = /^\d+(\.\d+)?$/;

/**
 * The whole base units of an asset with `decimals` places that a decimal
 * string names, exactly. Throws on anything but plain digits with an
 * optional fraction (no sign, exponent or spaces) and on a nonzero digit
 * past `decimals`, which the asset cannot hold.
 */
export function parseUnits(text: string, decimals: number): bigint {
  const trimmed = text.trim();
  if (!UNSIGNED_DECIMAL.test(trimmed)) throw new Error(`Not an amount: "${text}"`);
  const [whole, fraction = ""] = trimmed.split(".");
  if (/[1-9]/.test(fraction.slice(decimals))) {
    throw new Error(`More than ${decimals} decimals: "${text}"`);
  }
  return BigInt(whole + fraction.slice(0, decimals).padEnd(decimals, "0"));
}

const EXPONENT_FORM = /^(\d)(?:\.(\d+))?e([+-]\d+)$/;

/** The shortest round-trip decimal string of a finite non-negative number, never in exponent form. */
function plainDecimal(amount: number): string {
  const text = String(amount);
  const match = EXPONENT_FORM.exec(text);
  if (!match) return text;
  const [, lead, fraction = "", exponent] = match;
  const digits = lead + fraction;
  const point = 1 + Number(exponent);
  if (point <= 0) return `0.${"0".repeat(-point)}${digits}`;
  if (digits.length <= point) return digits + "0".repeat(point - digits.length);
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}

/**
 * `parseUnits` for an amount held as a number, read as the shortest decimal
 * that names that number, exactly. NaN, infinity and negatives are refused.
 * More decimals than `decimals` are accepted only when they are float noise
 * (0.1 + 0.2): rounding the number to 15 significant digits then fits.
 */
export function parseNumberUnits(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`Not an amount: ${amount}`);
  try {
    return parseUnits(plainDecimal(amount), decimals);
  } catch (error) {
    const rounded = Number(amount.toPrecision(15));
    if (rounded === amount) throw error;
    return parseUnits(plainDecimal(rounded), decimals);
  }
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
