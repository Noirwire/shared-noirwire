import { describe, expect, it } from "vitest";
import { entryHref, safeDestination } from "../../src/domain/safeDestination.js";

describe("safeDestination", () => {
  it("keeps a plain path on this site", () => {
    for (const path of [
      "/portfolio",
      "/portfolios/acc_1",
      "/markets/NVDAx?range=1m",
      "/settings#security",
    ]) {
      expect(safeDestination(path)).toBe(path);
    }
  });

  it("falls back to the portfolio for anything a browser could read as another site", () => {
    const hostile = [
      "//evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "\\/evil.example",
      "/ok\\..\\evil",
      "/path\\",
      "https://evil.example",
      "javascript:alert(1)",
      "evil.example",
      "portfolio",
    ];
    for (const next of hostile) expect(safeDestination(next)).toBe("/portfolio");
  });

  it("falls back for a path a browser's URL parser drops a character from and sends off-site", () => {
    // The parser removes tab, CR and LF wherever they stand, leaving `//`.
    for (const next of ["/\t/evil.example/phish", "/\n/evil.example/phish", "/\r/evil.example"]) {
      expect(new URL(next, "https://app.example").origin).toBe("https://evil.example");
      expect(safeDestination(next)).toBe("/portfolio");
    }
  });

  it("falls back for a path whose dot segments resolve to one starting with two slashes", () => {
    // Same-origin as written, but the resolved path is `//evil.example`, which
    // is another site the moment it is read as a link again.
    for (const next of [
      "/.//evil.example/p",
      "/x/..//evil.example",
      "/%2e//evil.example",
      "/%2E%2e//evil.example",
    ]) {
      expect(new URL(next, "https://app.example").pathname.startsWith("//")).toBe(true);
      expect(safeDestination(next)).toBe("/portfolio");
    }
  });

  it("falls back for any control character or whitespace, even one a browser would keep", () => {
    for (const next of [
      "/\u0000/evil.example",
      "/\u001f/evil.example",
      "/portfolio\u007f",
      "/portfolio ",
      "/markets ?range=1m",
    ]) {
      expect(safeDestination(next)).toBe("/portfolio");
    }
  });

  it("falls back when there is nothing usable", () => {
    for (const next of [null, "", "/"]) expect(safeDestination(next)).toBe("/portfolio");
  });

  it("round-trips the page an entry link was built from", () => {
    for (const path of ["/markets", "/markets/NVDAx", "/portfolios/acc_1"]) {
      const next = new URL(entryHref(path), "https://app.example").searchParams.get("next");
      expect(safeDestination(next)).toBe(path);
    }
  });
});
