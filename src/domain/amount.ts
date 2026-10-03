/**
 * An amount as a person types it, read one way on every keypad. A decimal
 * pad in many regions has a comma and no period, so either is the decimal
 * separator, and there is at most one. Nothing else is read: no sign, no
 * exponent, no spaces inside, and no grouping, because "1,234.50" and
 * "1.234,50" mean different amounts to different people.
 *
 * One reading stays open with a single comma: "1,234" is 1.234 on a comma
 * keypad and one thousand two hundred and thirty four to someone who groups
 * with commas. That is refused, not guessed. "0,234" is not grouped (no
 * group starts with a zero) and "1,23" or "1,2345" cannot be, so those are
 * read. A period is this app's own separator ("0.00"), so "1.234" is 1.234.
 */
const DECIMAL = /^(\d*)([.,]?)(\d*)$/;
const GROUPED = /^[1-9]\d{0,2},\d{3}$/;

/** The typed amount, or null when the text is not one amount read one way. */
export function decimalAmount(text: string): number | null {
  const typed = text.trim();
  const match = DECIMAL.exec(typed);
  if (!match || GROUPED.test(typed)) return null;
  const [, whole, , fraction] = match;
  if (whole === "" && fraction === "") return null;
  return Number(`${whole || "0"}.${fraction || "0"}`);
}

/** A typed amount, or 0 when what was typed is not an amount greater than zero. */
export function typedAmount(text: string): number {
  const value = decimalAmount(text);
  return value !== null && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Whether the typed amount has more decimals than an asset with `decimals`
 * can hold, trailing zeros aside. An amount below the asset's smallest unit
 * is one of these: it needs a decimal the asset does not have. False for
 * text that is not an amount at all, which has its own message.
 */
export function tooPrecise(text: string, decimals: number): boolean {
  if (decimalAmount(text) === null) return false;
  const fraction = text.trim().split(/[.,]/)[1] ?? "";
  return fraction.replace(/0+$/, "").length > decimals;
}

/** The smallest amount an asset with `decimals` can hold, written out: "0.000001". */
export function smallestAmount(decimals: number): string {
  return decimals <= 0 ? "1" : `0.${"0".repeat(decimals - 1)}1`;
}
