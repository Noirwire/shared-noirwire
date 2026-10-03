import { describe, expect, it } from "vitest";
import { connection } from "../../src/infrastructure/solana/client.js";
import {
  deriveKeypair,
  FUNDING_DERIVATION_INDEX,
  generateWalletMnemonic,
} from "../../src/infrastructure/solana/keys.js";
import {
  discoverExistingPortfolios,
  resolveImportedWallet,
} from "../../src/infrastructure/solana/import.js";
import { depositSol, lamportsToSol, solToLamports } from "../../src/infrastructure/solana/sol.js";
import { airdropSol, freshKeypair, waitForBalance } from "./helpers/chain.js";

describe("resolveImportedWallet", () => {
  it('resolves to "app" when only the app-scheme address is funded', async () => {
    const mnemonic = generateWalletMnemonic();
    const appKeypair = deriveKeypair(mnemonic, FUNDING_DERIVATION_INDEX, "app");
    await airdropSol(appKeypair.publicKey, 1);
    await waitForBalance(connection, appKeypair.publicKey, (l) => l > 0);

    const resolution = await resolveImportedWallet(mnemonic);

    expect(resolution.scheme).toBe("app");
    expect(resolution.walletDefault.active).toBe(false);
    expect(resolution.app.balanceSol).toBeGreaterThan(0);
    expect(resolution.walletDefault.balanceSol).toBe(0);
  });

  it('resolves to "walletDefault" when only the walletDefault-scheme address is funded', async () => {
    const mnemonic = generateWalletMnemonic();
    const walletDefaultKeypair = deriveKeypair(mnemonic, FUNDING_DERIVATION_INDEX, "walletDefault");
    await airdropSol(walletDefaultKeypair.publicKey, 1);
    await waitForBalance(connection, walletDefaultKeypair.publicKey, (l) => l > 0);

    const resolution = await resolveImportedWallet(mnemonic);

    expect(resolution.scheme).toBe("walletDefault");
    expect(resolution.app.active).toBe(false);
    expect(resolution.walletDefault.balanceSol).toBeGreaterThan(0);
    expect(resolution.app.balanceSol).toBe(0);
  });

  it("leaves the scheme to the user when neither set of addresses shows activity", async () => {
    const mnemonic = generateWalletMnemonic();

    const resolution = await resolveImportedWallet(mnemonic);

    expect(resolution.scheme).toBeNull();
    expect(resolution.app.active).toBe(false);
    expect(resolution.walletDefault.active).toBe(false);
    expect(resolution.app.balanceSol).toBe(0);
    expect(resolution.walletDefault.balanceSol).toBe(0);
  });

  it("leaves the scheme to the user when both sets of addresses show activity", async () => {
    const mnemonic = generateWalletMnemonic();
    const appKeypair = deriveKeypair(mnemonic, FUNDING_DERIVATION_INDEX, "app");
    const walletDefaultKeypair = deriveKeypair(mnemonic, FUNDING_DERIVATION_INDEX, "walletDefault");
    await airdropSol(appKeypair.publicKey, 1);
    await airdropSol(walletDefaultKeypair.publicKey, 1);
    await waitForBalance(connection, appKeypair.publicKey, (l) => l > 0);
    await waitForBalance(connection, walletDefaultKeypair.publicKey, (l) => l > 0);

    const resolution = await resolveImportedWallet(mnemonic);

    expect(resolution.scheme).toBeNull();
    expect(resolution.app.active).toBe(true);
    expect(resolution.walletDefault.active).toBe(true);
    expect(resolution.app.balanceSol).toBeGreaterThan(0);
    expect(resolution.walletDefault.balanceSol).toBeGreaterThan(0);
  });
});

describe("discoverExistingPortfolios", () => {
  it("finds exactly the funded indices, skipping the gaps between them", async () => {
    const mnemonic = generateWalletMnemonic();
    const funder = freshKeypair();
    await airdropSol(funder.publicKey, 2);

    // Deliberate gaps: nothing at 1, 3, 4, 6-11, 13+.
    const existingIndices = [2, 5, 12];
    const depositsSol = [0.1, 0.25, 0.05];
    for (let i = 0; i < existingIndices.length; i++) {
      const owner = deriveKeypair(mnemonic, existingIndices[i], "app");
      await depositSol(funder, owner.publicKey, depositsSol[i]);
      await waitForBalance(
        connection,
        owner.publicKey,
        (lamports) => lamports >= solToLamports(depositsSol[i]),
      );
    }

    const result = await discoverExistingPortfolios(mnemonic, "app");

    expect(result.map((portfolio) => portfolio.index)).toEqual(existingIndices);
    for (let i = 0; i < existingIndices.length; i++) {
      const owner = deriveKeypair(mnemonic, existingIndices[i], "app");
      const balanceLamports = await connection.getBalance(owner.publicKey);
      expect(result[i].address).toBe(owner.publicKey.toBase58());
      expect(result[i].solBalance).toBeCloseTo(lamportsToSol(balanceLamports), 9);
    }
  });

  it("does not report an account that was created but never funded", async () => {
    // Creating an account now writes nothing on chain, so there is deliberately
    // nothing to find until it actually receives something - and nothing worth
    // finding, since an empty account is free to re-derive.
    const mnemonic = generateWalletMnemonic();
    expect(await discoverExistingPortfolios(mnemonic, "app")).toEqual([]);
  });

  it("returns [] for a freshly generated mnemonic that has never touched the chain", async () => {
    const mnemonic = generateWalletMnemonic();

    const result = await discoverExistingPortfolios(mnemonic, "app");

    expect(result).toEqual([]);
  });
});
