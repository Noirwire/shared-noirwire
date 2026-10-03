import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ComputeBudgetProgram,
  Keypair,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { connection } from "../../src/infrastructure/solana/client.js";
import {
  lamportsBudget,
  MAX_TRADE_LAMPORTS,
  type TradePlan,
} from "../../src/infrastructure/solana/swap/execute.js";
import { TRADABLE_STOCKS } from "../../src/infrastructure/solana/tokenRegistry.js";

const OUTPUT_ATA = Keypair.generate().publicKey;

const transaction = new VersionedTransaction(
  new TransactionMessage({
    payerKey: Keypair.generate().publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 })],
  }).compileToV0Message(),
);

const plan = (gasless: boolean, takerPaysRent = false) =>
  ({
    side: "buy",
    stock: TRADABLE_STOCKS[0],
    quote: { gasless, takerPaysRent },
  }) as unknown as TradePlan;

const RENT = 2_074_080;
vi.mock("../../src/infrastructure/solana/tokens.js", async (original) => ({
  ...(await original<typeof import("../../src/infrastructure/solana/tokens.js")>()),
  ataRentFor: async () => RENT,
}));

/** The output account already exists, so the budget is the fee plus headroom. */
function mockFee(fee: number) {
  vi.spyOn(connection, "getAccountInfo").mockResolvedValue({ data: Buffer.alloc(165) } as never);
  vi.spyOn(connection, "getFeeForMessage").mockResolvedValue({
    context: { slot: 1 },
    value: fee,
  });
}

afterEach(() => vi.restoreAllMocks());

describe("lamportsBudget", () => {
  it("budgets the transaction's own fee plus headroom when the fee is ordinary", async () => {
    mockFee(15_000);
    expect(await lamportsBudget(plan(false), transaction, OUTPUT_ATA)).toBe(515_000n);
  });

  it("budgets nothing for an order the venue pays for", async () => {
    expect(await lamportsBudget(plan(true), transaction, OUTPUT_ATA)).toBe(0n);
  });

  it("budgets only the rent when the venue pays the fee and leaves a new account to the taker", async () => {
    vi.spyOn(connection, "getAccountInfo").mockResolvedValue(null);
    expect(await lamportsBudget(plan(true, true), transaction, OUTPUT_ATA)).toBe(BigInt(RENT));
    // Nothing once the account exists, and nothing when the venue pays the rent too.
    expect(await lamportsBudget(plan(true, false), transaction, OUTPUT_ATA)).toBe(0n);
    vi.spyOn(connection, "getAccountInfo").mockResolvedValue({ data: Buffer.alloc(165) } as never);
    expect(await lamportsBudget(plan(true, true), transaction, OUTPUT_ATA)).toBe(0n);
  });

  it("refuses a transaction that names a fee large enough to raise its own SOL limit", async () => {
    // The fee is whatever the venue wrote into the transaction. Budgeting it
    // as given would let a 5 SOL priority fee authorise a 5 SOL loss.
    mockFee(5_000_000_000);
    await expect(lamportsBudget(plan(false), transaction, OUTPUT_ATA)).rejects.toThrow(
      /far above normal/,
    );

    mockFee(MAX_TRADE_LAMPORTS);
    await expect(lamportsBudget(plan(false), transaction, OUTPUT_ATA)).rejects.toThrow(
      /far above normal/,
    );
  });
});
