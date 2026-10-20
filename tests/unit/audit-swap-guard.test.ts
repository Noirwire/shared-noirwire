import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { connection } from "../../src/infrastructure/solana/client.js";
import { verifySwapBeforeSigning } from "../../src/infrastructure/solana/swap/guard.js";
import { executeJupiterSwap } from "../../src/infrastructure/solana/swap/jupiter.js";
import { UnknownOutcomeError, type SwapQuote } from "../../src/infrastructure/solana/swap/types.js";
import { mintAccount } from "./support/mintAccount.js";

const JUPITER = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("audit: the floor the signed swap enforces on chain", () => {
  const taker = Keypair.generate().publicKey;
  const inputAta = Keypair.generate().publicKey;
  const outputAta = Keypair.generate().publicKey;
  const stockMint = Keypair.generate().publicKey;
  const quote: SwapQuote = {
    inputMint: Keypair.generate().publicKey,
    outputMint: stockMint,
    inAmount: 1_000_000n,
    outAmount: 500_000n,
    minOutAmount: 495_000n,
    slippageBps: 100,
    priceImpactPct: 0,
    venue: "Jupiter",
    raw: {},
  };

  function tokenData(amount: bigint): Buffer {
    const data = Buffer.alloc(165);
    taker.toBuffer().copy(data, 32);
    data.writeBigUInt64LE(amount, 64);
    return data;
  }

  /**
   * A Jupiter `route` instruction whose own arguments, which the program
   * enforces when the transaction lands, put the floor at zero: one unit
   * quoted out, 100% slippage. The order JSON beside it claims 495,000.
   */
  function routeWithNoFloor(): TransactionInstruction {
    const discriminator = createHash("sha256").update("global:route").digest().subarray(0, 8);
    const args = Buffer.alloc(4 + 8 + 8 + 2 + 1);
    args.writeUInt32LE(0, 0);
    args.writeBigUInt64LE(quote.inAmount, 4);
    args.writeBigUInt64LE(1n, 12);
    args.writeUInt16LE(10_000, 20);
    args.writeUInt8(0, 22);
    return new TransactionInstruction({
      programId: JUPITER,
      keys: [
        { pubkey: taker, isSigner: true, isWritable: true },
        { pubkey: inputAta, isSigner: false, isWritable: true },
        { pubkey: outputAta, isSigner: false, isWritable: true },
      ],
      data: Buffer.concat([discriminator, args]),
    });
  }

  it("refuses a route whose on-chain minimum is below the quote's floor", async () => {
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: taker,
        recentBlockhash: PublicKey.default.toBase58(),
        instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1 }), routeWithNoFloor()],
      }).compileToV0Message(),
    );
    vi.spyOn(connection, "getTokenAccountsByOwner").mockResolvedValue({
      context: { slot: 1 },
      value: [],
    } as never);
    vi.spyOn(connection, "getMultipleAccountsInfo").mockResolvedValue([
      { data: tokenData(1_000_000n) },
      { data: tokenData(0n) },
      { lamports: 10_000_000, owner: SystemProgram.programId, data: Buffer.alloc(0) },
      mintAccount(),
    ] as never);
    // At the instant it is simulated the pool pays the full amount; nothing in
    // the transaction stops it paying almost nothing when it actually lands.
    vi.spyOn(connection, "simulateTransaction").mockResolvedValue({
      context: { slot: 1 },
      value: {
        err: null,
        logs: [],
        accounts: [
          { data: [tokenData(0n).toString("base64"), "base64"] },
          { data: [tokenData(500_000n).toString("base64"), "base64"] },
          { lamports: 9_995_000, owner: SystemProgram.programId.toBase58(), data: ["", "base64"] },
        ],
        unitsConsumed: 0,
      },
    } as never);

    const verdict = await verifySwapBeforeSigning(
      transaction,
      quote,
      taker,
      inputAta,
      outputAta,
      { mint: stockMint, acquiring: true },
      5_000_000n,
    );

    expect(verdict.ok).toBe(false);
  });
});

describe("audit: when a swap handed to the venue can no longer land", () => {
  const taker = Keypair.generate();

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

  it("does not call a swap failed on the venue's word about when its blockhash expires", async () => {
    // The venue's order states an expiry height already behind the chain.
    // The blockhash it really used is valid until 200, as the chain itself
    // would say; private transfers bound this by a height read from the
    // chain for exactly this reason (private-payments.ts, submitTransfer).
    const quote = { raw: { requestId: "r", lastValidBlockHeight: 10 } } as SwapQuote;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    vi.spyOn(connection, "getBlockHeight").mockResolvedValue(50);
    vi.spyOn(connection, "getLatestBlockhash").mockResolvedValue({
      blockhash: Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: 200,
    });
    vi.spyOn(connection, "getSignatureStatus").mockResolvedValue({
      context: { slot: 1 },
      value: null,
    } as never);

    // Reported as failed, the reservation is released and the trade can be
    // placed again while the first signed copy can still land.
    await expect(executeJupiterSwap(quote, signed())).rejects.toBeInstanceOf(UnknownOutcomeError);
  });
});
