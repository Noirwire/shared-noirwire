import { describe, expect, it } from "vitest";
import { generateWalletMnemonic } from "../../src/infrastructure/solana/keys.js";
import { createWallet, createWalletFromMnemonic } from "../../src/wallet/create.js";

describe("where a wallet came from", () => {
  it("marks one imported from a phrase, so its Activity can say what it does not show", () => {
    const words = generateWalletMnemonic().split(" ");
    expect(createWalletFromMnemonic(words, "app").wallet.imported).toBe(true);
  });

  it("leaves one made here unmarked", () => {
    expect(createWallet().wallet).not.toHaveProperty("imported");
  });
});
