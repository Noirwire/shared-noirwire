/**
 * `count` and `noun`, with an "s" unless there is exactly one. Every counted
 * noun in the copy goes through this, so nothing reads "1 assets".
 */
export function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
