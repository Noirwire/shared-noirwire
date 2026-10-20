/**
 * Where to go once the wallet is open. A locked route hands its own path
 * over in `?next=`, so unlocking returns the user to the page they asked
 * for instead of dropping them on the portfolio - which matters more than
 * it sounds, because the decrypted phrase never survives a reload, so *any*
 * full page load on a protected route comes through here first.
 *
 * Only same-origin paths are honoured, judged the way a browser's URL parser
 * (the WHATWG URL standard) will read the string:
 * - `//evil.com` is a valid relative URL to another site, so the path must
 *   start with exactly one slash.
 * - A backslash is read as a slash, so `/\evil.com` is the same thing. None
 *   is allowed anywhere.
 * - Tab, CR and LF are removed wherever they stand, and other control
 *   characters and spaces are trimmed from the ends, so `/<tab>/evil.com`
 *   becomes `//evil.com`. No control character and no whitespace is allowed.
 * - `.` and `..` segments, written plainly or as `%2e`, are resolved, so
 *   `/.//evil.com` becomes `//evil.com`. No path the app links to has one,
 *   so none is allowed.
 */
export function safeDestination(next: string | null): string {
  if (!next || !/^\/[^/]/.test(next) || hasUnsafeCharacter(next)) return "/portfolio";
  const [path] = next.split(/[?#]/, 1);
  if (path.split("/").some((segment) => DOT_SEGMENT.test(segment))) return "/portfolio";
  return next;
}

const DOT_SEGMENT = /^(?:\.|%2e){1,2}$/i;

/** A control character (C0 or DEL), any whitespace, or a backslash. */
function hasUnsafeCharacter(text: string): boolean {
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || character === "\\" || /\s/.test(character)) return true;
  }
  return false;
}

/**
 * The entry screen, carrying the page to come back to once a wallet is open.
 * Used by a locked route and by a visitor who has no wallet yet and chooses
 * to create one from the page they were reading.
 */
export function entryHref(returnTo: string): string {
  return `/?next=${encodeURIComponent(returnTo)}`;
}
