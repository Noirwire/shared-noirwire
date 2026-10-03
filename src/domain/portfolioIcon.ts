/**
 * The fixed glyph and tint catalog a portfolio's mark can be set to. Kept
 * free of any React import so the id lists and the resolver below are
 * unit-testable on their own; the id -> icon component map lives next to the
 * component that renders them in each app.
 */
export const PORTFOLIO_ICON_GLYPHS = [
  "compass",
  "target",
  "flag",
  "mountains",
  "house",
  "graduation",
  "airplane",
  "heart",
  "shield",
  "clock",
  "globe",
  "tree",
  "sun",
  "lightning",
  "chart-line",
  "chart-pie",
  "buildings",
  "factory",
  "heartbeat",
  "flask",
  "cpu",
  "robot",
  "cloud",
  "wifi",
  "car",
  "truck",
  "shopping",
  "coins",
  "briefcase",
  "scales",
  "bank",
  "diamond",
] as const;

export type PortfolioIconGlyph = (typeof PORTFOLIO_ICON_GLYPHS)[number];

export const PORTFOLIO_ICON_TINTS = [
  "neutral",
  "sage",
  "blue",
  "lilac",
  "clay",
  "ochre",
  "teal",
  "rose",
] as const;

export type PortfolioIconTint = (typeof PORTFOLIO_ICON_TINTS)[number];

export const DEFAULT_PORTFOLIO_GLYPH: PortfolioIconGlyph = "compass";
export const DEFAULT_PORTFOLIO_TINT: PortfolioIconTint = "neutral";

export type PortfolioIcon = { glyph: PortfolioIconGlyph; tint: PortfolioIconTint };

function isGlyph(value: unknown): value is PortfolioIconGlyph {
  return typeof value === "string" && (PORTFOLIO_ICON_GLYPHS as readonly string[]).includes(value);
}

function isTint(value: unknown): value is PortfolioIconTint {
  return typeof value === "string" && (PORTFOLIO_ICON_TINTS as readonly string[]).includes(value);
}

/**
 * The glyph and tint actually shown for a stored `icon` value. Each field
 * falls back to its own default independently, so an unrecognised tint (an
 * older build, a hand-edited export) never also blanks a perfectly good
 * glyph, and a non-object/null/number/array value falls back to the full
 * default rather than making the portfolio unreadable.
 */
export function resolvePortfolioIcon(value: unknown): PortfolioIcon {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { glyph: DEFAULT_PORTFOLIO_GLYPH, tint: DEFAULT_PORTFOLIO_TINT };
  }
  const record = value as Record<string, unknown>;
  return {
    glyph: isGlyph(record.glyph) ? record.glyph : DEFAULT_PORTFOLIO_GLYPH,
    tint: isTint(record.tint) ? record.tint : DEFAULT_PORTFOLIO_TINT,
  };
}
