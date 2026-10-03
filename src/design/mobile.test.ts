import { describe, expect, it } from "vitest";
import {
  MIN_TARGET,
  chartPaths,
  colors,
  fonts,
  layout,
  mobileRadius,
  motion,
  opacity,
  overlayColor,
  radius,
  size,
  space,
} from "./index.js";

describe("the phone's tokens", () => {
  it("keeps the shared radii and rounds its own sheet, checkbox and button", () => {
    expect(mobileRadius).toEqual({ ...radius, sheet: 20, checkbox: 6, button: 26 });
    expect(radius.sheet).toBe(16);
  });

  it("lays screens out on the shared spacing steps", () => {
    expect(layout).toEqual({
      gutter: space[5],
      section: 32,
      hero: space[6],
      group: space[4],
      tight: space[2],
      inset: space[3],
      signature: space[10],
      hairline: space[1],
    });
    expect(space[8]).toBe(32);
  });

  it("sizes a control to at least the smallest touch target", () => {
    expect(size.minTarget).toBe(MIN_TARGET);
    expect(size.control).toBeGreaterThanOrEqual(MIN_TARGET);
    expect(mobileRadius.button).toBe(size.control / 2);
  });

  it("dims the base colour behind a sheet", () => {
    expect(colors.base).toBe("#0b0b0c");
    expect(overlayColor).toBe("rgba(11, 11, 12, 0.85)");
    expect(opacity).toEqual({ pressed: 0.6, inert: 0.4 });
  });

  it("names the font files and how long things move for", () => {
    expect(fonts).toEqual({
      regular: "Figtree_400Regular",
      medium: "Figtree_500Medium",
      semibold: "Figtree_600SemiBold",
    });
    expect(motion).toEqual({
      overlayMs: 200,
      sheetMs: 380,
      pressMs: 200,
      stepMs: 320,
      signatureMs: 260,
    });
  });

  it("exports the chart maths beside them", () => {
    expect(chartPaths([1, 2], 10, 10, 0)?.line).toBe("M0.00 10.00 L10.00 0.00");
  });
});
