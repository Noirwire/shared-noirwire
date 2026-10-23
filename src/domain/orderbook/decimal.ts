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
 * that names that number, exactly. NaN, infinity and negatives are refused,
 * and so is a number with more decimals than `decimals`: it is never rounded
 * here, because rounding can move an amount up. A caller holding the result
 * of arithmetic rounds it first, down, with `floorToUnit`.
 */
export function parseNumberUnits(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`Not an amount: ${amount}`);
  return parseUnits(plainDecimal(amount), decimals);
}

function scaledInteger(amount: number): { integer: bigint; places: number } {
  const [whole, fraction = ""] = plainDecimal(amount).split(".");
  return { integer: BigInt(whole + fraction), places: fraction.length };
}

/**
 * `numerator / denominator` as a whole count of base units of `decimals`
 * places, by bigint division of the shortest decimals the two numbers name,
 * rounded to the nearest unit with halves rounding up. Used to turn an amount
 * shown through a multiplier into stored units, where the float quotient
 * (0.0707 / 1.01 = 0.06999999999999999) would land a unit short.
 */
export function divideToUnits(numerator: number, denominator: number, decimals: number): bigint {
  if (!Number.isFinite(numerator) || numerator < 0) throw new Error(`Not an amount: ${numerator}`);
  if (!Number.isFinite(denominator) || denominator <= 0) {
    throw new Error(`Not a divisor: ${denominator}`);
  }
  const top = scaledInteger(numerator);
  const bottom = scaledInteger(denominator);
  const dividend = top.integer * 10n ** BigInt(bottom.places + decimals);
  const divisor = bottom.integer * 10n ** BigInt(top.places);
  return (2n * dividend + divisor) / (2n * divisor);
}

/**
 * The number cut down to a whole count of base units of `decimals` places,
 * never up. It reads the shortest decimal of the number and drops the digits
 * past the unit, so a value just below a unit boundary stays below it.
 */
export function floorToUnit(amount: number, decimals: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const [whole, fraction = ""] = plainDecimal(amount).split(".");
  return Number(fraction.slice(0, decimals) ? `${whole}.${fraction.slice(0, decimals)}` : whole);
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
