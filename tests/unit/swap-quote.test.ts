import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ComputeBudgetProgram,
  Keypair,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { connection } from "../../src/infrastructure/solana/client.js";
import {
  executeJupiterSwap,
  isBuilt,
  jupiterVenue,
  NoQuoteError,
} from "../../src/infrastructure/solana/swap/jupiter.js";
import { signatureOf } from "../../src/infrastructure/solana/settlement.js";
import {
  clampSlippageBps,
  DEFAULT_SLIPPAGE_BPS,
  MAX_SLIPPAGE_BPS,
  minimumOut,
  UnknownOutcomeError,
  type SwapQuote,
} from "../../src/infrastructure/solana/swap/types.js";

describe("clampSlippageBps", () => {
  it("passes a sensible value through unchanged", () => {
    expect(clampSlippageBps(50)).toBe(50);
    expect(clampSlippageBps(300)).toBe(300);
  });

  it("caps anything above the app's own ceiling, however it was asked for", () => {
    // A venue or a caller must never be able to widen slippage without limit:
    // that is the difference between a bad price and an emptied account.
    expect(clampSlippageBps(10_000)).toBe(MAX_SLIPPAGE_BPS);
    expect(clampSlippageBps(501)).toBe(MAX_SLIPPAGE_BPS);
  });

  it("falls back to the default for nonsense rather than trusting it", () => {
    expect(clampSlippageBps(0)).toBe(DEFAULT_SLIPPAGE_BPS);
    expect(clampSlippageBps(-100)).toBe(DEFAULT_SLIPPAGE_BPS);
    expect(clampSlippageBps(Number.NaN)).toBe(DEFAULT_SLIPPAGE_BPS);
    expect(clampSlippageBps(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SLIPPAGE_BPS);
  });

  it("rounds a fractional bps to a whole one", () => {
    expect(clampSlippageBps(49.6)).toBe(50);
  });
});

describe("minimumOut", () => {
  it("subtracts exactly the slippage allowance", () => {
    expect(minimumOut(1_000_000n, 50)).toBe(995_000n);
    expect(minimumOut(1_000_000n, 100)).toBe(990_000n);
  });

  it("returns the full amount at zero slippage", () => {
    expect(minimumOut(1_000_000n, 0)).toBe(1_000_000n);
  });

  it("never rounds in the user's disfavour beyond one base unit", () => {
    // Integer division truncates, which rounds the floor DOWN - conservative,
    // and the only safe direction: a floor rounded up could reject a swap
    // that honoured its quote.
    const floor = minimumOut(333n, 50);
    expect(floor).toBe(331n);
    expect(floor).toBeLessThanOrEqual((333n * 9_950n) / 10_000n);
  });

  it("stays exact at amounts that would lose precision as a float", () => {
    // 2^53 + 1: the first integer a double cannot represent. Base units of a
    // 9-decimal token reach this range, and a silent rounding here would be
    // a silently wrong minimum.
    const huge = 9_007_199_254_740_993n;
    expect(minimumOut(huge, 0)).toBe(huge);
    expect(minimumOut(huge, 100)).toBe((huge * 9_900n) / 10_000n);
  });

  it("handles a zero quote without producing a negative floor", () => {
    expect(minimumOut(0n, 50)).toBe(0n);
  });
});

describe("a quote taken from the venue", () => {
  const TAKER = Keypair.generate().publicKey;
  const REQUEST = {
    inputMint: Keypair.generate().publicKey,
    outputMint: Keypair.generate().publicKey,
    amount: 10_000_000n,
    slippageBps: 50,
  };
  const ORDER = {
    inAmount: "10000000",
    outAmount: "1000000",
    otherAmountThreshold: "995000",
    slippageBps: 50,
    requestId: "request",
    transaction: "",
  };

  const quoteFor = (order: Record<string, unknown>) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(order), { status: 200 })),
    );
    return jupiterVenue(TAKER).quote(REQUEST);
  };

  afterEach(() => vi.unstubAllGlobals());

  it("asks for the order in a POST body, so the taker's address is in no URL", async () => {
    await quoteFor(ORDER);

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.noirwire.test/v1/jupiter/swap/v2/order");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: "Bearer test-token-1" });
    expect(JSON.parse(init.body as string)).toMatchObject({
      taker: TAKER.toBase58(),
      inputMint: REQUEST.inputMint.toBase58(),
      outputMint: REQUEST.outputMint.toBase58(),
      amount: REQUEST.amount.toString(),
    });
  });

  it("reports who pays: the venue only when it says so, and the rent only as the order names it", async () => {
    expect(await quoteFor(ORDER)).toMatchObject({ gasless: false, takerPaysRent: false });
    // A fee-paid market-maker order can still leave a new account's rent to the taker.
    expect(
      await quoteFor({ ...ORDER, gasless: true, rentFeePayer: TAKER.toBase58() }),
    ).toMatchObject({ gasless: true, takerPaysRent: true });
    expect(
      await quoteFor({
        ...ORDER,
        gasless: true,
        rentFeePayer: Keypair.generate().publicKey.toBase58(),
      }),
    ).toMatchObject({ gasless: true, takerPaysRent: false });
  });

  it("tells a priced order from one that can be signed", async () => {
    expect(isBuilt(await quoteFor(ORDER))).toBe(false);
    expect(isBuilt(await quoteFor({ ...ORDER, transaction: "AQID" }))).toBe(true);
    expect(
      isBuilt(await quoteFor({ ...ORDER, transaction: undefined, swapTransaction: "AQID" })),
    ).toBe(true);
  });

  it("names the one answer Jupiter gives when no router takes an order", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "Failed to get quotes" }, { status: 400 })),
    );
    await expect(jupiterVenue(TAKER).quote(REQUEST)).rejects.toBeInstanceOf(NoQuoteError);
  });

  it("accepts an order inside the request and the slippage ceiling", async () => {
    expect(await quoteFor(ORDER)).toMatchObject({
      inAmount: 10_000_000n,
      outAmount: 1_000_000n,
      minOutAmount: 995_000n,
      slippageBps: 50,
    });
  });

  it("accepts a guaranteed price, whose slippage is zero and whose floor is the quote", async () => {
    const quote = await quoteFor({ ...ORDER, slippageBps: 0, otherAmountThreshold: "1000000" });
    expect(quote).toMatchObject({ minOutAmount: 1_000_000n, slippageBps: 0 });
  });

  it("refuses a floor below the app's widest slippage, by one base unit", async () => {
    // The floor is what the check before signing holds the swap to. A venue
    // that could set it freely could set it to nothing.
    const floor = minimumOut(1_000_000n, MAX_SLIPPAGE_BPS);
    expect((await quoteFor({ ...ORDER, otherAmountThreshold: String(floor) })).minOutAmount).toBe(
      floor,
    );
    await expect(quoteFor({ ...ORDER, otherAmountThreshold: String(floor - 1n) })).rejects.toThrow(
      /guaranteed minimum/,
    );
    await expect(quoteFor({ ...ORDER, otherAmountThreshold: "1" })).rejects.toThrow(
      /guaranteed minimum/,
    );
  });

  it("refuses an order that spends more than was asked for", async () => {
    await expect(quoteFor({ ...ORDER, inAmount: "10000001" })).rejects.toThrow(/larger amount/);
  });

  it("refuses a slippage wider than the ceiling instead of echoing it", async () => {
    await expect(quoteFor({ ...ORDER, slippageBps: 5_000 })).rejects.toThrow(/wider slippage/);
    await expect(
      quoteFor({ ...ORDER, slippageBps: 5_000, otherAmountThreshold: undefined }),
    ).rejects.toThrow(/wider slippage/);
  });

  it("refuses amounts that are zero, negative or not numbers", async () => {
    for (const bad of [
      { inAmount: "0" },
      { outAmount: "0" },
      { outAmount: "-5" },
      { outAmount: "1e6" },
      { inAmount: 10_000_000 },
      { otherAmountThreshold: "0" },
      { otherAmountThreshold: "" },
    ]) {
      await expect(quoteFor({ ...ORDER, ...bad }), JSON.stringify(bad)).rejects.toThrow(
        /usable|guaranteed minimum/,
      );
    }
  });
});

describe("a swap handed back to the venue to land", () => {
  const taker = Keypair.generate();
  const quote = { raw: { requestId: "request", lastValidBlockHeight: 100 } } as SwapQuote;

  function signed(): VersionedTransaction {
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: taker.publicKey,
        recentBlockhash: Keypair.generate().publicKey.toBase58(),
        instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1 })],
      }).compileToV0Message(),
    );
    transaction.sign([taker]);
    return transaction;
  }

  const chainSays = (value: unknown, height = 50) => {
    vi.spyOn(connection, "getBlockHeight").mockResolvedValue(height);
    return vi
      .spyOn(connection, "getSignatureStatus")
      .mockResolvedValue({ context: { slot: 1 }, value } as never);
  };
  const noAnswer = () =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reads the transaction's own id off its first signature", () => {
    const transaction = signed();
    expect(signatureOf(transaction)).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
    transaction.signatures[0] = new Uint8Array(64);
    expect(signatureOf(transaction)).toBeNull();
  });

  it("returns the signature when the connection dropped but the swap landed", async () => {
    noAnswer();
    const transaction = signed();
    const status = chainSays({ err: null, confirmationStatus: "confirmed" });
    expect(await executeJupiterSwap(quote, transaction)).toBe(signatureOf(transaction));
    expect(status).toHaveBeenCalledWith(signatureOf(transaction), {
      searchTransactionHistory: true,
    });
  });

  it("says the outcome is unknown, not failed, when the chain has not seen it yet", async () => {
    noAnswer();
    chainSays(null);
    await expect(executeJupiterSwap(quote, signed())).rejects.toBeInstanceOf(UnknownOutcomeError);
  });

  it("says unknown when the chain cannot be asked either", async () => {
    noAnswer();
    vi.spyOn(connection, "getBlockHeight").mockRejectedValue(new Error("rpc down"));
    await expect(executeJupiterSwap(quote, signed())).rejects.toBeInstanceOf(UnknownOutcomeError);
  });

  it("reports a failure only when it is a fact: an error on chain, or an expired blockhash", async () => {
    noAnswer();
    chainSays({ err: { InstructionError: [0, "Custom"] }, confirmationStatus: "confirmed" });
    await expect(executeJupiterSwap(quote, signed())).rejects.toThrow("did not go through");

    chainSays(null, 101);
    await expect(executeJupiterSwap(quote, signed())).rejects.toThrow("did not go through");
  });

  describe("when the venue says it landed", () => {
    const venueSays = (signature: string) =>
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify({ status: "Success", signature }), { status: 200 }),
        ),
      );
    const fabricated = "5".repeat(88);

    it("reports success once the chain shows the transaction's own signature", async () => {
      const transaction = signed();
      venueSays(signatureOf(transaction)!);
      chainSays({ err: null, confirmationStatus: "confirmed" });
      expect(await executeJupiterSwap(quote, transaction)).toBe(signatureOf(transaction));
    });

    it("does not take a fabricated signature for a landed trade", async () => {
      // The reply names a signature that is not this transaction's. What is
      // asked of the chain is the transaction's own, and it is not there.
      vi.useFakeTimers();
      try {
        const transaction = signed();
        venueSays(fabricated);
        const status = chainSays(null);
        const refused = expect(executeJupiterSwap(quote, transaction)).rejects.toBeInstanceOf(
          UnknownOutcomeError,
        );
        await vi.advanceTimersByTimeAsync(30_000);
        await refused;
        expect(status).toHaveBeenCalledWith(signatureOf(transaction), expect.anything());
        expect(status).not.toHaveBeenCalledWith(fabricated, expect.anything());
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not take some other confirmed transaction for ours when someone else pays the fee", async () => {
      // A market-maker order: the first signature is not ours to know, so the
      // named one has to be looked up. It is real and confirmed, and it is
      // not this trade until it is seen to carry the taker's signature.
      const maker = Keypair.generate();
      const transaction = new VersionedTransaction(
        new TransactionMessage({
          payerKey: maker.publicKey,
          recentBlockhash: Keypair.generate().publicKey.toBase58(),
          instructions: [
            new TransactionInstruction({
              programId: ComputeBudgetProgram.programId,
              keys: [{ pubkey: taker.publicKey, isSigner: true, isWritable: true }],
              data: Buffer.from([2, 0, 0, 0, 0]),
            }),
          ],
        }).compileToV0Message(),
      );
      transaction.sign([taker]);
      expect(signatureOf(transaction)).toBeNull();
      const [makerSlot, takerSlot] = transaction.signatures;
      const takerSignature = signatureOf(
        new VersionedTransaction(transaction.message, [takerSlot, makerSlot]),
      );

      venueSays(fabricated);
      chainSays({ err: null, confirmationStatus: "finalized" });
      const landed = vi
        .spyOn(connection, "getTransaction")
        .mockResolvedValue({ transaction: { signatures: [fabricated, "someone-else"] } } as never);
      await expect(executeJupiterSwap(quote, transaction)).rejects.toBeInstanceOf(
        UnknownOutcomeError,
      );

      landed.mockResolvedValue({
        transaction: { signatures: [fabricated, takerSignature] },
      } as never);
      expect(await executeJupiterSwap(quote, transaction)).toBe(fabricated);
    });
  });

  it("does not take the venue's own refusal as final once it had the signed transaction", async () => {
    const refusing = (body: object, status: number) =>
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify(body), { status })),
      );
    // It may have forwarded the transaction before it answered.
    for (const [body, status] of [
      [{ status: "Failed", error: "Quote expired" }, 200],
      [{ error: "Bad request" }, 400],
    ] as const) {
      refusing(body, status);
      chainSays(null);
      await expect(executeJupiterSwap(quote, signed())).rejects.toBeInstanceOf(UnknownOutcomeError);
    }
    // The chain shows its time ran out with no trace: now it is a failure.
    refusing({ status: "Failed", error: "Quote expired" }, 200);
    chainSays(null, 101);
    await expect(executeJupiterSwap(quote, signed())).rejects.toThrow("did not go through");
    // And had it landed after all, it landed.
    chainSays({ confirmationStatus: "confirmed", err: null });
    expect(await executeJupiterSwap(quote, signed())).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
  });
});
