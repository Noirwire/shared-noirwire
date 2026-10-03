import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { connection } from "../../src/infrastructure/solana/client.js";
import { usdcMint } from "../../src/infrastructure/solana/config.js";
import { prepareEarn, sharesFor } from "../../src/infrastructure/solana/earn/jupiterLend.js";

const LEND_PROGRAM = new PublicKey("jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9");
const RECEIPT_MINT = new PublicKey("9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D");
const TEN_USDC = 10_000_000n;
const ONE = 1_000_000_000_000n;

describe("sharesFor", () => {
  it("converts at a plausible price: a share worth a little over one USDC", () => {
    expect(sharesFor(TEN_USDC, ONE)).toBe(TEN_USDC);
    expect(sharesFor(TEN_USDC, 1_062_609_067_277n)).toBe(9_410_798n);
    expect(sharesFor(TEN_USDC, 2n * ONE)).toBe(5_000_000n);
  });

  it("refuses a price below the one USDC a share started at", () => {
    expect(() => sharesFor(TEN_USDC, ONE - 1n)).toThrow(/cannot be right/);
    expect(() => sharesFor(TEN_USDC, 0n)).toThrow(/cannot be right/);
  });

  it("refuses a price too high to be a share price at all", () => {
    expect(() => sharesFor(TEN_USDC, 2n * ONE + 1n)).toThrow(/cannot be right/);
    expect(() => sharesFor(TEN_USDC, 2n ** 64n - 1n)).toThrow(/cannot be right/);
  });
});

describe("prepareEarn", () => {
  const owner = Keypair.generate().publicKey;

  /** The vault account as it is laid out on chain, holding `price`. */
  function lendingAccount(price: bigint, assetMint = new PublicKey(usdcMint())) {
    const data = Buffer.alloc(196);
    assetMint.toBuffer().copy(data, 8);
    RECEIPT_MINT.toBuffer().copy(data, 40);
    data.writeBigUInt64LE(price, 115);
    return { owner: LEND_PROGRAM, data };
  }

  /** An API that reports whatever share price suits it and builds a transaction. */
  function hostileApi() {
    const built = new VersionedTransaction(
      new TransactionMessage({
        payerKey: owner,
        recentBlockhash: Keypair.generate().publicKey.toBase58(),
        instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1 })],
      }).compileToV0Message(),
    );
    const fetched = vi.fn(async (url: string) => {
      const body = url.endsWith("/lend/v1/earn/tokens")
        ? [
            {
              address: RECEIPT_MINT.toBase58(),
              asset: { address: usdcMint() },
              convertToShares: "1000",
              convertToAssets: "1000000000",
            },
          ]
        : { transaction: Buffer.from(built.serialize()).toString("base64") };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal("fetch", fetched);
    return fetched;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("takes its limits from the price on chain, whatever share price the API reports", async () => {
    // The API's rate would put the deposit's floor at a thousandth of what is
    // owed. The floor signed against comes from the vault account instead.
    hostileApi();
    vi.spyOn(connection, "getAccountInfo").mockResolvedValue(
      lendingAccount(1_062_609_067_277n) as never,
    );

    const deposit = await prepareEarn("deposit", owner, 10);
    expect(deposit.limits.maxCashSpent).toBe(TEN_USDC);
    expect(deposit.limits.receive?.minAmount).toBe((9_410_798n * 9_950n) / 10_000n);

    const withdrawal = await prepareEarn("withdraw", owner, 10);
    expect(withdrawal.limits.maxCashSpent).toBe((9_410_798n * 10_050n) / 10_000n + 1n);
    expect(withdrawal.limits.receive?.minAmount).toBe(TEN_USDC - 1n);
  });

  it("builds nothing when the vault account is not the one expected", async () => {
    const fetched = hostileApi();
    for (const account of [
      null,
      { ...lendingAccount(1_062_609_067_277n), owner: Keypair.generate().publicKey },
      lendingAccount(1_062_609_067_277n, Keypair.generate().publicKey),
      { owner: LEND_PROGRAM, data: Buffer.alloc(100) },
    ]) {
      vi.spyOn(connection, "getAccountInfo").mockResolvedValue(account as never);
      await expect(prepareEarn("deposit", owner, 10)).rejects.toThrow(/could not be read/);
    }
    vi.spyOn(connection, "getAccountInfo").mockResolvedValue(lendingAccount(1n) as never);
    await expect(prepareEarn("deposit", owner, 10)).rejects.toThrow(/cannot be right/);
    expect(fetched).not.toHaveBeenCalled();
  });
});
