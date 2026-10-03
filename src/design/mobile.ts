import { radius, space } from "./tokens.js";

/**
 * What the phone's screens are laid out with beyond the tokens both apps
 * share: its own radii where a touch surface wants them rounder, the rhythm
 * of a screen, control sizes, and how long things move for. In points.
 */

/** The shared radii, with the phone's rounder sheet and the two its controls add. */
export const mobileRadius = {
  ...radius,
  sheet: 20,
  checkbox: 6,
  /** Half a main control's height, so a primary button reads as a pill. */
  button: 26,
} as const;

/** The rhythm every screen is laid out on. Components use these names, not raw steps. */
export const layout = {
  /** Left and right edge of a screen or a sheet. */
  gutter: space[5],
  /** Between sections of a screen. Space separates sections, not boxes. Also above a hero block. */
  section: space[8],
  /** Below a hero block, such as Home's balance. */
  hero: space[6],
  /** Between the parts of one group, such as a label and its control. */
  group: space[4],
  /** Between tightly related items, such as a title and its caption. */
  tight: space[2],
  /** Inside a control or a cell, between its edge and its content. */
  inset: space[3],
  /** Kept free of text along a balance's trailing edge, for the Home signature. */
  signature: space[10],
  /** The smallest gap, between an icon and the text it sits with. */
  hairline: space[1],
} as const;

/** The smallest comfortable touch target on both phone platforms. */
export const MIN_TARGET = 44;

export const size = {
  minTarget: MIN_TARGET,
  /** Main buttons and text fields. */
  control: 52,
  /** The numeric field inside a stepper. */
  stepperField: 56,
  icon: 20,
  iconSmall: 18,
  grabberWidth: 36,
  grabberHeight: 4,
  checkbox: 22,
  checkboxBorder: 1.5,
  checkIcon: 14,
  statusMark: 20,
  stroke: 1,
} as const;

/** The backdrop behind a sheet: the base colour at 85%. */
export const overlayColor = "rgba(11, 11, 12, 0.85)";

/** How much a pressed control dims, and how much a disabled one fades. */
export const opacity = {
  pressed: 0.6,
  inert: 0.4,
} as const;

/** The loaded font files, by weight. */
export const fonts = {
  regular: "Figtree_400Regular",
  medium: "Figtree_500Medium",
  semibold: "Figtree_600SemiBold",
} as const;

export const motion = {
  overlayMs: 200,
  sheetMs: 380,
  pressMs: 200,
  /** A progress step changing state. */
  stepMs: 320,
  /** The Home signature closing its last stretch, on first reveal. */
  signatureMs: 260,
} as const;
