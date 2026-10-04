import { afterEach, describe, expect, it } from "vitest";
import { isMainnet, networkLabel } from "../../src/infrastructure/solana/config.js";
import { installTestPlatform, testEnv } from "../../src/testing/index.js";

afterEach(() => {
  installTestPlatform();
});

describe("the network as a person is told it", () => {
  it("is only the chain's name on the main network", () => {
    installTestPlatform({ env: testEnv({ network: "mainnet-beta" }) });
    expect(isMainnet()).toBe(true);
    expect(networkLabel()).toBe("Solana");
  });

  it("says test network anywhere else, and never a cluster's own name", () => {
    installTestPlatform({ env: testEnv({ network: "devnet" }) });
    expect(isMainnet()).toBe(false);
    expect(networkLabel()).toMatch(/test network/);
    expect(networkLabel()).not.toMatch(/devnet|mainnet/i);
  });
});
