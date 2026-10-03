/**
 * Where to go once the wallet is open. A locked route hands its own path
 * over in `?next=`, so unlocking returns the user to the page they asked
 * for instead of dropping them on the portfolio - which matters more than
 * it sounds, because the decrypted phrase never survives a reload, so *any*
 * full page load on a protected route comes through here first.
 *
 * Only same-origin paths are honoured. `//evil.com` is a valid relative URL
 * to a browser and would navigate off-site, and browsers read a backslash as
 * a slash, so `/\evil.com` is the same thing. A path is accepted only when
 * it starts with exactly one slash and holds no backslash anywhere.
 */
export function safeDestination(next: string | null): string {
  if (!next || !/^\/[^/\\]/.test(next) || next.includes("\\")) return "/portfolio";
  return next;
}

/**
 * The entry screen, carrying the page to come back to once a wallet is open.
 * Used by a locked route and by a visitor who has no wallet yet and chooses
 * to create one from the page they were reading.
 */
export function entryHref(returnTo: string): string {
  return `/?next=${encodeURIComponent(returnTo)}`;
}
