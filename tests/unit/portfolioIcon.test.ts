import { describe, expect, it } from "vitest";
import {
  PORTFOLIO_ICON_GLYPHS,
  PORTFOLIO_ICON_TINTS,
  DEFAULT_PORTFOLIO_GLYPH,
  DEFAULT_PORTFOLIO_TINT,
  resolvePortfolioIcon,
} from "../../src/domain/portfolioIcon.js";

const DEFAULT = { glyph: DEFAULT_PORTFOLIO_GLYPH, tint: DEFAULT_PORTFOLIO_TINT };

describe("resolvePortfolioIcon", () => {
  it("falls back to the default for an absent, null, or wrongly-typed value", () => {
    expect(resolvePortfolioIcon(undefined)).toEqual(DEFAULT);
    expect(resolvePortfolioIcon(null)).toEqual(DEFAULT);
    expect(resolvePortfolioIcon("compass")).toEqual(DEFAULT);
    expect(resolvePortfolioIcon(42)).toEqual(DEFAULT);
    expect(resolvePortfolioIcon([])).toEqual(DEFAULT);
    expect(resolvePortfolioIcon(["compass", "sage"])).toEqual(DEFAULT);
  });

  it("falls back only the unknown field, keeping the other one", () => {
    expect(resolvePortfolioIcon({ glyph: "not-a-real-glyph", tint: "sage" })).toEqual({
      glyph: DEFAULT_PORTFOLIO_GLYPH,
      tint: "sage",
    });
    expect(resolvePortfolioIcon({ glyph: "target", tint: "not-a-real-tint" })).toEqual({
      glyph: "target",
      tint: DEFAULT_PORTFOLIO_TINT,
    });
  });

  it("falls back for non-string glyph and tint fields", () => {
    expect(resolvePortfolioIcon({ glyph: 7, tint: null })).toEqual(DEFAULT);
    expect(resolvePortfolioIcon({ glyph: ["target"], tint: { sage: true } })).toEqual(DEFAULT);
  });

  it("round-trips every known glyph and tint id", () => {
    for (const glyph of PORTFOLIO_ICON_GLYPHS) {
      for (const tint of PORTFOLIO_ICON_TINTS) {
        expect(resolvePortfolioIcon({ glyph, tint })).toEqual({ glyph, tint });
      }
    }
  });

  it("keeps the default ids inside the fixed lists", () => {
    expect(PORTFOLIO_ICON_GLYPHS).toContain(DEFAULT_PORTFOLIO_GLYPH);
    expect(PORTFOLIO_ICON_TINTS).toContain(DEFAULT_PORTFOLIO_TINT);
  });

  it("has no duplicate glyph or tint ids", () => {
    expect(new Set(PORTFOLIO_ICON_GLYPHS).size).toBe(PORTFOLIO_ICON_GLYPHS.length);
    expect(new Set(PORTFOLIO_ICON_TINTS).size).toBe(PORTFOLIO_ICON_TINTS.length);
  });
});
