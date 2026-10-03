/** `count` and `noun`, with an "s" unless there is exactly one. */
export function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
