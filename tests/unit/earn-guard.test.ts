import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { connection } from "../../src/infrastructure/solana/client.js";
import { usdcMint } from "../../src/infrastructure/solana/config.js";
import {
  prepareEarn,
  relayedEarnDraft,
  sharesFor,
} from "../../src/infrastructure/solana/earn/jupiterLend.js";

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

  describe("a withdrawal of everything", () => {
    const PRICE = 1_062_609_067_277n;
    const SHARES = 37_643_197n;
    const WORTH = (SHARES * PRICE) / ONE;
    const REDEEM = [0xb8, 0x0c, 0x56, 0x95, 0x46, 0xc4, 0x61, 0xe1];
    const WITHDRAW = [0xb7, 0x12, 0x46, 0x9c, 0x94, 0x6d, 0xa1, 0x22];

    /** The API builds a genuine withdrawal for whatever amount it is asked for. */
    function lendApi() {
      const asked: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init?: RequestInit) => {
          const { amount } = JSON.parse(init!.body as string) as { amount: string };
          asked.push(amount);
          const data = Buffer.alloc(16);
          Buffer.from(WITHDRAW).copy(data);
          data.writeBigUInt64LE(BigInt(amount), 8);
          const built = new VersionedTransaction(
            new TransactionMessage({
              payerKey: owner,
              recentBlockhash: Keypair.generate().publicKey.toBase58(),
              instructions: [
                new TransactionInstruction({
                  programId: LEND_PROGRAM,
                  keys: [{ pubkey: owner, isSigner: true, isWritable: true }],
                  data,
                }),
              ],
            }).compileToV0Message(),
          );
          return Response.json({ transaction: Buffer.from(built.serialize()).toString("base64") });
        }),
      );
      return asked;
    }

    /** The chain: the vault at `PRICE`, and the portfolio's receipt account holding `SHARES`. */
    function position(shares = SHARES) {
      const receipt = Buffer.alloc(165);
      receipt.writeBigUInt64LE(shares, 64);
      vi.spyOn(connection, "getAccountInfo").mockImplementation((async (key: PublicKey) =>
        key.equals(new PublicKey("2vVYHYM8VYnvZqQWpTJSj8o8DBf1wM8pVs3bsTgYZiqJ"))
          ? lendingAccount(PRICE)
          : { owner: LEND_PROGRAM, data: receipt }) as never);
    }

    const lendInstruction = (transaction: VersionedTransaction) =>
      TransactionMessage.decompile(transaction.message).instructions.find((entry) =>
        entry.programId.equals(LEND_PROGRAM),
      )!;

    it.each([
      ["exactly what the position is worth", Number(WORTH) / 1e6],
      ["what Max fills, a few units over what the chain will give", Number(WORTH + 16n) / 1e6],
      ["far more than there is", 1_000],
    ])(
      "redeems every share when asked for %s, and leaves nothing behind",
      async (_what, amount) => {
        lendApi();
        position();
        const { transaction, limits } = await prepareEarn("withdraw", owner, amount);
        const { data } = lendInstruction(transaction);
        expect([...data.subarray(0, 8)]).toEqual(REDEEM);
        expect(data.readBigUInt64LE(8)).toBe(SHARES);
        // Every share may leave and not one more; at least what they were worth must arrive.
        expect(limits.maxCashSpent).toBe(SHARES);
        expect(limits.receive?.minAmount).toBe(WORTH - 1n);
      },
    );

    it("stays a withdrawal of the amount typed when that is less than the position", async () => {
      const asked = lendApi();
      position();
      const { transaction, limits } = await prepareEarn("withdraw", owner, 10);
      const { data } = lendInstruction(transaction);
      expect([...data.subarray(0, 8)]).toEqual(WITHDRAW);
      expect(data.readBigUInt64LE(8)).toBe(TEN_USDC);
      expect(asked).toEqual(["10000000"]);
      expect(limits.receive?.minAmount).toBe(TEN_USDC - 1n);
    });

    it("is the same for the relayer: one redemption of every share, reviewed as that", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init?: RequestInit) => {
          const { amount } = JSON.parse(init!.body as string) as { amount: string };
          const data = Buffer.alloc(16);
          Buffer.from(WITHDRAW).copy(data);
          data.writeBigUInt64LE(BigInt(amount), 8);
          return Response.json({
            instructions: [
              {
                programId: LEND_PROGRAM.toBase58(),
                accounts: [{ pubkey: owner.toBase58(), isSigner: true, isWritable: true }],
                data: data.toString("base64"),
              },
            ],
          });
        }),
      );
      position();
      const receipt = Buffer.alloc(165);
      receipt.writeBigUInt64LE(SHARES, 64);
      const cash = Buffer.alloc(165);
      vi.spyOn(connection, "getMultipleAccountsInfo").mockResolvedValue([
        { data: cash },
        { data: receipt },
      ] as never);
      const terms = { feePayer: Keypair.generate().publicKey, feeRaw: 20_000n, pricing: false };

      const all = await relayedEarnDraft("withdraw", owner, Number(WORTH + 16n) / 1e6, terms);
      expect(all.intent).toEqual({ kind: "redeem", amountRaw: SHARES });
      const { data } = all.instructions.at(-1)!;
      expect([...data.subarray(0, 8)]).toEqual(REDEEM);
      expect(data.readBigUInt64LE(8)).toBe(SHARES);
      expect(all.limits(20_000n)).toMatchObject({
        maxCashSpent: SHARES,
        receive: { minAmount: WORTH - 1n - 20_000n },
      });

      const some = await relayedEarnDraft("withdraw", owner, 10, terms);
      expect(some.intent).toEqual({ kind: "withdraw", amountRaw: TEN_USDC });
    });

    it("refuses to turn anything but Jupiter's withdrawal into a redemption", async () => {
      hostileApi();
      position();
      await expect(prepareEarn("withdraw", owner, 1_000)).rejects.toThrow(
        /other than a withdrawal/,
      );
    });
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
