import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ComputeBudgetProgram,
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { connection } from "../../src/infrastructure/solana/client.js";
import { executeTrade, type TradePlan } from "../../src/infrastructure/solana/swap/execute.js";
import { QUOTE_TOKEN, TRADABLE_STOCKS } from "../../src/infrastructure/solana/tokenRegistry.js";
import { UnknownOutcomeError } from "../../src/infrastructure/solana/swap/types.js";
import { ataFor } from "../../src/infrastructure/solana/tokens.js";
import { mintAccount } from "./support/mintAccount.js";
import { rfqFill } from "./support/routes.js";
import { recordSigning } from "./support/signing.js";

const records = recordSigning();

const owner = Keypair.generate();
const stock = TRADABLE_STOCKS[0];

function tokenData(amount: bigint): Buffer {
  const data = Buffer.alloc(165);
  owner.publicKey.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  return data;
}

/**
 * A venue-paid buy the guard passes, whose order states that its blockhash
 * stops being valid at height 10. The chain says 200.
 */
function plan(): TradePlan {
  const built = new VersionedTransaction(
    new TransactionMessage({
      payerKey: owner.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1 }),
        rfqFill({
          output: 495_000n,
          source: ataFor(QUOTE_TOKEN.mint, owner.publicKey, QUOTE_TOKEN.programId),
          destination: ataFor(stock.mint, owner.publicKey, stock.programId),
        }),
      ],
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
  vi.spyOn(connection, "simulateTransaction").mockResolvedValue({
    context: { slot: 1 },
    value: {
      err: null,
      logs: [],
      accounts: [
        { data: [tokenData(0n).toString("base64"), "base64"] },
        { data: [tokenData(500_000n).toString("base64"), "base64"] },
        { lamports: 10_000_000, owner: SystemProgram.programId.toBase58(), data: ["", "base64"] },
      ],
      unitsConsumed: 0,
    },
  } as never);
  return {
    side: "buy",
    stock,
    quote: {
      inputMint: QUOTE_TOKEN.mint,
      outputMint: stock.mint,
      inAmount: 1_000_000n,
      outAmount: 500_000n,
      minOutAmount: 495_000n,
      slippageBps: 100,
      priceImpactPct: 0,
      venue: "Jupiter",
      gasless: true,
      raw: {
        requestId: "request",
        transaction: Buffer.from(built.serialize()).toString("base64"),
        lastValidBlockHeight: 10,
      },
    },
    spend: 1,
    receive: 0.5,
    receiveAtLeast: 0.495,
    unitPrice: 2,
    venue: "Jupiter",
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("what a signed trade is written down with before it leaves", () => {
  it("records the last valid height the chain gives, not the one the order states", async () => {
    const trade = plan();
    const latest = vi.spyOn(connection, "getLatestBlockhash").mockResolvedValue({
      blockhash: Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: 200,
    });
    vi.spyOn(connection, "getBlockHeight").mockResolvedValue(50);
    vi.spyOn(connection, "getSignatureStatus").mockResolvedValue({
      context: { slot: 1 },
      value: null,
    } as never);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const outcome = await executeTrade(owner, trade, () => true).catch((error: unknown) => error);
    expect(outcome).toBeInstanceOf(UnknownOutcomeError);
    expect(records).toHaveLength(1);
    expect(records[0].lastValidBlockHeight).toBe(200);
    // The outcome is judged against the same reading, not a second one.
    expect((outcome as UnknownOutcomeError).lastValidBlockHeight).toBe(200);
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it("signs nothing when the chain cannot say how long the trade would stay valid", async () => {
    const trade = plan();
    vi.spyOn(connection, "getLatestBlockhash").mockRejectedValue(new Error("rpc down"));
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);

    await expect(executeTrade(owner, trade, () => true)).rejects.toThrow(/could not be asked/);
    expect(records).toHaveLength(0);
    expect(fetched).not.toHaveBeenCalled();
  });
});
