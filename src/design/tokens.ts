/**
 * NoirWire ivory and charcoal: one dark theme on every surface. The single
 * source for both apps. Names and values are those of the `@theme` block in
 * the web app's globals.css; tests/webTokens.test.ts fails when they drift.
 */
export const colors = {
  base: "#0b0b0c",
  surface: "#131315",
  "surface-raised": "#18181b",
  elevated: "#1c1c1f",
  "surface-strong": "#222226",

  ink: "#e8e6e1",
  "ink-strong": "#f5f3ee",
  dim: "#b4b1aa",
  faint: "#8d8b86",

  "line-subtle": "#272a2d",
  line: "#36393c",
  "line-strong": "#515458",

  safe: "#75bc97",
  warning: "#d1ad70",
  danger: "#f18d80",

  "portfolio-neutral": "#e8e6e1",
  "portfolio-sage": "#9abfa9",
  "portfolio-blue": "#9bafd1",
  "portfolio-lilac": "#b7a5c9",
  "portfolio-clay": "#c8a092",
  "portfolio-ochre": "#d2b479",
  "portfolio-teal": "#88bdb9",
  "portfolio-rose": "#c7a6b5",
} as const;

export type ColorToken = keyof typeof colors;

/** In pixels. `panel` and `tile` are the web's theme radii; the rest are the fixed radii its components use. */
export const radius = {
  panel: 12,
  tile: 8,
  mark: 10,
  sheet: 16,
  pill: 999,
} as const;

/** The 4px spacing step, by the multiples the screens use. */
export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  10: 40,
} as const;

export const fontFamily = "Figtree";

export type TextVariant = "h1" | "h2" | "lead" | "body" | "label" | "faint";

export type TextStyleToken = {
  /** Font size in pixels at phone width. */
  size: number;
  /** Line height in pixels. */
  lineHeight: number;
  /** Letter spacing in em. */
  tracking: number;
  weight: 400 | 500 | 600;
  color: ColorToken;
};

export const typeScale: Record<TextVariant, TextStyleToken> = {
  h1: { size: 34, lineHeight: 36, tracking: -0.04, weight: 500, color: "ink" },
  h2: { size: 24, lineHeight: 27, tracking: -0.035, weight: 500, color: "ink" },
  lead: { size: 17, lineHeight: 28, tracking: 0, weight: 400, color: "dim" },
  body: { size: 15, lineHeight: 22, tracking: 0, weight: 400, color: "ink" },
  label: { size: 12, lineHeight: 16, tracking: 0, weight: 500, color: "faint" },
  faint: { size: 13, lineHeight: 18, tracking: 0, weight: 400, color: "faint" },
};
