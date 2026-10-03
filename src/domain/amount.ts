/** A typed amount, or 0 when what was typed is not an amount greater than zero. */
export function typedAmount(text: string): number {
  const value = Number(text);
  return text.trim() !== "" && Number.isFinite(value) && value > 0 ? value : 0;
}
