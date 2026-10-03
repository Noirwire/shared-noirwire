import { describe, expect, it } from "vitest";
import type { ImportResolution, SchemeActivity } from "../../../src/domain/importResolution.js";
import {
  groupsOfFour,
  importFoundText,
  importResultView,
  importSchemeFor,
  importSourceView,
} from "../../../src/presentation/importFindings.js";

const ADDRESS = "5aqYNsJsmRuasaFMMWAF2s94r1bTuXZC46A6Ro9C82GY";
const portfolio = (index: number) => ({ index, address: ADDRESS, solBalance: 0 });
const activity = (over: Partial<SchemeActivity> = {}): SchemeActivity => ({
  address: ADDRESS,
  balanceSol: 0,
  portfolios: [],
  active: false,
  ...over,
});

describe("what an import found, in words", () => {
  it("names portfolios and token balances, and never the address", () => {
    expect(importFoundText(activity())).toBe("Nothing found on chain yet");
    expect(
      importFoundText(activity({ active: true, portfolios: [portfolio(1), portfolio(2)] })),
    ).toBe("2 portfolios");
    expect(importFoundText(activity({ active: true }))).toBe("Token balances");
    expect(
      importFoundText(activity({ active: true, balanceSol: 1, portfolios: [portfolio(1)] })),
    ).toBe("1 portfolio and token balances");
  });

  it("preselects and marks the one set that was used", () => {
    const resolution: ImportResolution = {
      scheme: "walletDefault",
      app: activity(),
      walletDefault: activity({ active: true }),
    };
    const view = importSourceView(resolution);
    expect(view.preselected).toBe("walletDefault");
    const other = view.options.find((option) => option.choice === "walletDefault")!;
    expect(other.captions.map((caption) => caption.text)).toEqual([
      "Such as Phantom or Solflare.",
      "Token balances",
      "This one has been used.",
    ]);
    expect(view.options[2].captions[0].text).toBe("Opens the set that has been used.");
    expect(importSchemeFor("notSure", resolution)).toBe("walletDefault");
    expect(JSON.stringify(view)).not.toContain(ADDRESS);
  });

  it("marks the NoirWire set when that is the one used", () => {
    const resolution: ImportResolution = {
      scheme: "app",
      app: activity({ active: true, portfolios: [portfolio(1)] }),
      walletDefault: activity(),
    };
    const view = importSourceView(resolution);
    expect(view.options[0].captions.map((caption) => caption.text)).toEqual([
      "1 portfolio",
      "This one has been used.",
    ]);
    expect(importSchemeFor("notSure", resolution)).toBe("app");
  });

  it("opens the addresses most wallets use when the chain cannot decide, and says so", () => {
    const resolution: ImportResolution = {
      scheme: null,
      app: activity(),
      walletDefault: activity(),
    };
    const view = importSourceView(resolution);
    expect(view.preselected).toBeNull();
    expect(view.options[2].captions[0].text).toBe(
      "Opens the addresses most other wallets use. You can switch afterwards.",
    );
    expect(importSchemeFor("notSure", resolution)).toBe("walletDefault");
    expect(importSchemeFor("app", resolution)).toBe("app");
  });

  it("reunites or simply imports", () => {
    expect(
      importResultView(activity({ active: true, portfolios: [portfolio(1), portfolio(2)] })),
    ).toEqual({
      title: "Wallet reunited with its funds.",
      body: "Found 2 portfolios this phrase already had on chain.",
      found: true,
    });
    expect(importResultView(activity({ active: true }))).toEqual({
      title: "Wallet reunited with its funds.",
      body: "Found token balances this phrase already had on chain.",
      found: true,
    });
    expect(importResultView(activity())).toEqual({
      title: "Wallet imported.",
      body: "Nothing was found on chain for these addresses yet. Add money whenever you're ready.",
      found: false,
    });
  });

  it("groups an address in fours", () => {
    expect(groupsOfFour("abcdefghij")).toEqual(["abcd", "efgh", "ij"]);
    expect(groupsOfFour("")).toEqual([]);
  });
});
