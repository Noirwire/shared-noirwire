import { describe, expect, it } from "vitest";
import {
  MIN_TARGET,
  btnGhost,
  btnPrimary,
  btnQuiet,
  chartPaths,
  chipClass,
  colors,
  focus,
  focusRing,
  iconButton,
  input,
  mobileRadius,
  size,
} from "./index.js";

describe("the phone's tokens", () => {
  it("sizes a control to at least the smallest touch target", () => {
    expect(size.minTarget).toBe(MIN_TARGET);
    expect(size.control).toBeGreaterThanOrEqual(MIN_TARGET);
    expect(mobileRadius.button).toBe(size.control / 2);
  });

  it("exports the chart maths beside them", () => {
    expect(chartPaths([1, 2], 10, 10, 0)?.line).toBe("M0.00 10.00 L10.00 0.00");
  });
});

describe("the keyboard focus ring", () => {
  const ring = [
    "focus-visible:outline-2",
    "focus-visible:outline-offset-2",
    "focus-visible:outline-solid",
    "focus-visible:outline-ink-strong",
  ];

  it("is on every button variant and control, in a colour named outright", () => {
    for (const classes of [
      btnPrimary,
      btnGhost,
      btnQuiet,
      iconButton,
      input,
      chipClass(true),
      chipClass(false),
    ]) {
      for (const utility of ring) expect(classes.split(" ")).toContain(utility);
    }
    expect(focusRing.split(" ")).toEqual(expect.arrayContaining(ring));
  });

  it("does not take the text colour, which on a primary button is the page's", () => {
    expect(btnPrimary).toContain("text-base");
    expect(focusRing).not.toMatch(/outline-(base|current)/);
    expect(colors["ink-strong"]).not.toBe(colors.base);
  });

  it("is the same ring on the phone: its width, its offset and its colour", () => {
    expect(focus).toEqual({ width: 2, offset: 2, color: "ink-strong" });
    expect(colors[focus.color]).toBe("#f5f3ee");
  });
});
