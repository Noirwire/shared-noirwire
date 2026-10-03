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
