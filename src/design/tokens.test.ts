import { describe, expect, it } from "vitest";
import { colors, typeScale } from "./tokens.js";

describe("tokens", () => {
  it("defines every colour as a six-digit hex", () => {
    for (const value of Object.values(colors)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("colours every text style with a token that exists", () => {
    for (const style of Object.values(typeScale)) expect(colors[style.color]).toBeDefined();
  });
});
