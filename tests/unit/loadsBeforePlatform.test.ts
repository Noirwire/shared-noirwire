import { describe, expect, it, vi } from "vitest";

/**
 * An app installs its platform at boot, and its bundler may load any module
 * of this package before that happens. So nothing may read the platform, the
 * network or the HTTP configuration while a module loads, only when it is
 * asked for something.
 */
const ENTRIES = [
  "domain",
  "application",
  "infrastructure",
  "presentation",
  "copy",
  "design",
  "wallet",
] as const;

describe("every entry", () => {
  it.each(ENTRIES)("%s loads with no platform installed", async (entry) => {
    vi.resetModules();
    const platform = await import("../../src/platform.js");
    expect(() => platform.getPlatform()).toThrow(/no platform installed/);
    await expect(import(`../../src/${entry}/index.ts`)).resolves.toBeDefined();
  });
});
