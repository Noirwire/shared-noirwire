import { afterEach, describe, expect, it } from "vitest";
import {
  bridgeNetworkPins,
  bridgeTerminalOrigins,
  envFrom,
} from "../../../src/infrastructure/solana/config.js";
import { installPlatform } from "../../../src/platform.js";
import { installTestPlatform, memoryPlatform } from "../../../src/testing/index.js";

afterEach(() => {
  installTestPlatform();
});

function install(settings: Parameters<typeof envFrom>[0]) {
  installPlatform({
    ...memoryPlatform(),
    env: envFrom({ apiBaseUrl: "https://api.noirwire.com", ...settings }),
  });
}

describe("the origins that may ask this wallet to sign", () => {
  it("is the terminal alone on the main network, whatever the build's setting says", () => {
    install({ network: "mainnet", bridgeTerminalOrigins: "https://evil.example" });
    expect(bridgeTerminalOrigins()).toEqual(["https://terminal.noirwire.com"]);
  });

  it("is the build's setting on the test network", () => {
    install({
      network: "devnet",
      bridgeTerminalOrigins: "http://localhost:3002, https://terminal-test.noirwire.com",
    });
    expect(bridgeTerminalOrigins()).toEqual([
      "http://localhost:3002",
      "https://terminal-test.noirwire.com",
    ]);
  });

  it("is the terminal's local address on the test network with no setting", () => {
    install({ network: "devnet" });
    expect(bridgeTerminalOrigins()).toEqual(["http://localhost:3002"]);
  });

  it.each([
    "https://terminal.noirwire.com/",
    "https://terminal.noirwire.com/connect",
    "http://terminal.noirwire.com",
    "terminal.noirwire.com",
    "https://user@terminal.noirwire.com",
  ])("refuses %s as an origin", (origin) => {
    expect(() =>
      envFrom({
        network: "devnet",
        apiBaseUrl: "https://api.noirwire.com",
        bridgeTerminalOrigins: origin,
      }),
    ).toThrow(/wallet bridge origin/);
  });

  it("pins the order book, the rollup and its validator, and the mint of the network", () => {
    install({ network: "mainnet" });
    expect(bridgeNetworkPins()).toMatchObject({
      orderbookProgram: "BrUoDsreaeXWypVxh6LoGseqwB4TZVJZBxvhfxXprvwP",
      rollupUrl: "https://mainnet-tee.magicblock.app",
      rollupValidator: "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo",
      usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    });
  });
});
