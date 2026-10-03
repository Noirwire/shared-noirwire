import { beforeAll, describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { connection } from "../../src/infrastructure/solana/client.js";
import {
  ataFor,
  depositToken,
  ensureTokenAccountExists,
  getTokenBalance,
  withdrawToken,
} from "../../src/infrastructure/solana/tokens.js";
import { depositSol, solToLamports } from "../../src/infrastructure/solana/sol.js";
import {
  airdropSol,
  createTestMint,
  freshKeypair,
  mintTestTokensTo,
  waitForAccount,
  waitForBalance,
  waitForTokenAmount,
} from "./helpers/chain.js";

/**
 * `tokens.ts` is fully generic now (mint + decimals are explicit parameters
 * on every function, per src/lib/infrastructure/solana/tokenRegistry.ts) - there is no
 * "the" token baked into the module any more, so this suite exercises it
 * directly against throwaway local mints, one at USDC's real decimals (6)
 * and a second at a deliberately different decimals count, to prove the
 * generic path isn't secretly still USDC-shaped (a hardcoded `10 ** 6`
 * would silently corrupt the second mint's amounts).
 */
describe("generic SPL token helpers (throwaway local mints)", () => {
  let mintAuthority: Keypair;

  beforeAll(async () => {
    mintAuthority = freshKeypair();
    await airdropSol(mintAuthority.publicKey, 5);
  }, 30_000);

  async function fundedFunder(mint: PublicKey, decimals: number, amount: number): Promise<Keypair> {
    const funder = freshKeypair();
    await airdropSol(funder.publicKey, 1);
    await mintTestTokensTo(mint, mintAuthority, funder.publicKey, amount, decimals);
    await waitForTokenAmount(
      connection,
      ataFor(mint, funder.publicKey),
      (raw) => raw === BigInt(Math.round(amount * 10 ** decimals)),
    );
    return funder;
  }

  describe("ensureTokenAccountExists", () => {
    it("creates the ATA and is a no-op (no error, no second charge) the second time", async () => {
      const mint = await createTestMint(mintAuthority, 6);
      const funder = freshKeypair();
      const owner = freshKeypair();
      await airdropSol(funder.publicKey, 1);

      const ata = ataFor(mint, owner.publicKey);
      expect(await connection.getAccountInfo(ata)).toBeNull();
      expect(await getTokenBalance(mint, 6, owner.publicKey)).toBe(0);

      await ensureTokenAccountExists(mint, owner.publicKey, funder);
      await waitForAccount(connection, ata);

      const funderBalanceAfterCreate = await connection.getBalance(funder.publicKey);
      await expect(
        ensureTokenAccountExists(mint, owner.publicKey, funder),
      ).resolves.toBeUndefined();
      const funderBalanceAfterNoop = await connection.getBalance(funder.publicKey);
      expect(funderBalanceAfterNoop).toBe(funderBalanceAfterCreate);
    });

    it("throws a plain, user-facing error when funder cannot cover the ATA-creation rent", async () => {
      const mint = await createTestMint(mintAuthority, 6);
      const funder = freshKeypair(); // deliberately never airdropped - 0 SOL
      const owner = freshKeypair();

      await expect(ensureTokenAccountExists(mint, owner.publicKey, funder)).rejects.toThrow(
        "The funding wallet does not have enough SOL to cover this.",
      );
      expect(await connection.getAccountInfo(ataFor(mint, owner.publicKey))).toBeNull();
    });
  });

  describe("depositToken", () => {
    it("increases the real balance by exactly the deposited amount, at USDC's real decimals (6)", async () => {
      const mint = await createTestMint(mintAuthority, 6);
      const funder = await fundedFunder(mint, 6, 100);
      const owner = freshKeypair();

      expect(await getTokenBalance(mint, 6, owner.publicKey)).toBe(0);

      await depositToken(mint, 6, funder, owner.publicKey, 12.5);

      const ownerAta = ataFor(mint, owner.publicKey);
      await waitForTokenAmount(connection, ownerAta, (amount) => amount === BigInt(12_500_000));
      expect(await getTokenBalance(mint, 6, owner.publicKey)).toBe(12.5);

      const funderAta = ataFor(mint, funder.publicKey);
      await waitForTokenAmount(connection, funderAta, (amount) => amount === BigInt(87_500_000));
      expect(await getTokenBalance(mint, 6, funder.publicKey)).toBe(87.5);
    });

    it("is off-by-10^6 safe: a 1 token deposit lands as exactly 1, never 1e6 or 1e-6", async () => {
      const mint = await createTestMint(mintAuthority, 6);
      const funder = await fundedFunder(mint, 6, 5);
      const owner = freshKeypair();

      await depositToken(mint, 6, funder, owner.publicKey, 1);

      await waitForTokenAmount(
        connection,
        ataFor(mint, owner.publicKey),
        (amount) => amount === BigInt(1_000_000),
      );
      expect(await getTokenBalance(mint, 6, owner.publicKey)).toBe(1);
    });

    /**
     * A second, test-only token at a decimals count deliberately different
     * from USDC's 6 - this is the extensibility proof: `depositToken` and
     * `getTokenBalance` are driven with zero code changes beyond passing
     * this mint's own `mint`/`decimals`, exactly the shape a real second
     * `TokenDefinition` in tokenRegistry.ts would supply. If any function in
     * tokens.ts still hardcoded USDC's decimals internally, this deposit
     * would land off by a factor of 10^4.
     */
    it("works unmodified for a second, non-USDC-shaped token at 2 decimals", async () => {
      const decimals = 2;
      const mint = await createTestMint(mintAuthority, decimals);
      const funder = await fundedFunder(mint, decimals, 100);
      const owner = freshKeypair();

      expect(await getTokenBalance(mint, decimals, owner.publicKey)).toBe(0);

      await depositToken(mint, decimals, funder, owner.publicKey, 12.5);

      await waitForTokenAmount(
        connection,
        ataFor(mint, owner.publicKey),
        (amount) => amount === BigInt(1_250),
      );
      expect(await getTokenBalance(mint, decimals, owner.publicKey)).toBe(12.5);

      await waitForTokenAmount(
        connection,
        ataFor(mint, funder.publicKey),
        (amount) => amount === BigInt(8_750),
      );
      expect(await getTokenBalance(mint, decimals, funder.publicKey)).toBe(87.5);
    });
  });

  describe("withdrawToken", () => {
    it("moves tokens from the owner's own balance to a third party, the owner paying for it", async () => {
      const mint = await createTestMint(mintAuthority, 6);
      const funder = await fundedFunder(mint, 6, 50);
      const owner = freshKeypair();
      const recipient = freshKeypair();

      await depositToken(mint, 6, funder, owner.publicKey, 20);
      await waitForTokenAmount(
        connection,
        ataFor(mint, owner.publicKey),
        (amount) => amount === BigInt(20_000_000),
      );

      await depositSol(funder, owner.publicKey, 0.01);
      await waitForBalance(connection, owner.publicKey, (l) => l === solToLamports(0.01));
      const funderBalanceBefore = await connection.getBalance(funder.publicKey);

      await withdrawToken(mint, 6, owner, funder, 8, recipient.publicKey);

      await waitForTokenAmount(
        connection,
        ataFor(mint, recipient.publicKey),
        (amount) => amount === BigInt(8_000_000),
      );
      expect(await getTokenBalance(mint, 6, recipient.publicKey)).toBe(8);

      await waitForTokenAmount(
        connection,
        ataFor(mint, owner.publicKey),
        (amount) => amount === BigInt(12_000_000),
      );
      expect(await getTokenBalance(mint, 6, owner.publicKey)).toBe(12);

      // The owner paid the fee and the recipient's token account; the funder paid nothing.
      expect(await connection.getBalance(owner.publicKey)).toBeLessThan(solToLamports(0.01));
      expect(await connection.getBalance(funder.publicKey)).toBe(funderBalanceBefore);
    });

    it("works unmodified for a second, non-USDC-shaped token at 2 decimals", async () => {
      const decimals = 2;
      const mint = await createTestMint(mintAuthority, decimals);
      const funder = await fundedFunder(mint, decimals, 50);
      const owner = freshKeypair();
      const recipient = freshKeypair();

      await depositToken(mint, decimals, funder, owner.publicKey, 20);
      await waitForTokenAmount(
        connection,
        ataFor(mint, owner.publicKey),
        (amount) => amount === BigInt(2_000),
      );

      await depositSol(funder, owner.publicKey, 0.01);
      await waitForBalance(connection, owner.publicKey, (l) => l === solToLamports(0.01));

      await withdrawToken(mint, decimals, owner, funder, 8, recipient.publicKey);

      await waitForTokenAmount(
        connection,
        ataFor(mint, recipient.publicKey),
        (amount) => amount === BigInt(800),
      );
      expect(await getTokenBalance(mint, decimals, recipient.publicKey)).toBe(8);

      await waitForTokenAmount(
        connection,
        ataFor(mint, owner.publicKey),
        (amount) => amount === BigInt(1_200),
      );
      expect(await getTokenBalance(mint, decimals, owner.publicKey)).toBe(12);
    });
  });
});
