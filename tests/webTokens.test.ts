import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { colors, fontFamily, radius } from "../src/design/tokens.js";

// The web app is a sibling checkout on a developer's machine and absent in
// CI, where this suite skips instead of failing.
const WEB_THEME = join(import.meta.dirname, "../../app-noirwire/src/app/globals.css");

function webTokens(prefix: string) {
  const theme = /@theme\s*\{([^}]*)\}/.exec(readFileSync(WEB_THEME, "utf8"))?.[1] ?? "";
  const declaration = new RegExp(`--${prefix}-([a-z-]+):\\s*([^;]+);`, "g");
  return Object.fromEntries(
    Array.from(theme.matchAll(declaration), (match) => [match[1], match[2]]),
  );
}

describe.skipIf(!existsSync(WEB_THEME))("design tokens against the web app", () => {
  it("carries every colour token with the same name and value", () => {
    expect(colors).toEqual(webTokens("color"));
  });

  it("carries every radius the web's theme names", () => {
    const web = webTokens("radius");
    expect(Object.keys(web)).not.toHaveLength(0);
    for (const [name, value] of Object.entries(web)) {
      expect(`${radius[name as keyof typeof radius]}px`).toBe(value);
    }
  });

  it("names the typeface the web's theme loads", () => {
    expect(webTokens("font").sans).toContain(`--font-${fontFamily.toLowerCase()}`);
  });
});
