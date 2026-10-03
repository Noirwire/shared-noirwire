import { afterEach, describe, expect, it, vi } from "vitest";
import { createTransferCheckedInstruction, createTransferInstruction } from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type { SwapQuote } from "../../src/infrastructure/solana/swap/types.js";
import { installPlatform } from "../../src/platform.js";
import { memoryPlatform, testEnv } from "../../src/testing/index.js";

/**
 * The one token transfer a swap may carry at the top level: NoirWire's fee on
 * a market-maker order, in the shape genuine orders pay it. The fee comes
 * from the installed platform's environment.
 */
const REFERRAL = "Fps2W6upBuMTgZpBsjgHbsjVVBthkaMfgaWfTXeKhrZw";
installPlatform(memoryPlatform({ env: testEnv({ referralAccount: REFERRAL, feeBps: 50 }) }));

const { connection } = await import("../../src/infrastructure/solana/client.js");
const { checkSwapPrograms } = await import("../../src/infrastructure/solana/swap/guard.js");

const TAKER = Keypair.generate().publicKey;
const CASH = Keypair.generate().publicKey;
const STOCK = Keypair.generate().publicKey;
const CASH_ATA = Keypair.generate().publicKey;
const STOCK_ATA = Keypair.generate().publicKey;
const FEE_ACCOUNT = Keypair.generate().publicKey;
const MAKER = Keypair.generate().publicKey;

/** A 12 USDC buy and a sell paying out 15.406408 USDC, as live orders quoted them. */
const BUY = { inputMint: CASH, outputMint: STOCK, inAmount: 12_000_000n, outAmount: 1_540_405n };
const SELL = { inputMint: STOCK, outputMint: CASH, inAmount: 2_000_000n, outAmount: 15_406_408n };
const quote = (leg: typeof BUY) =>
  ({
    ...leg,
    minOutAmount: leg.outAmount,
    slippageBps: 0,
    priceImpactPct: 0,
    venue: "test",
    raw: {},
  }) as SwapQuote;

function tokenAccount(mint: PublicKey, owner: PublicKey): Buffer {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);
  owner.toBuffer().copy(data, 32);
  return data;
}

/** What the fee account turns out to be when it is read from the chain. */
function feeAccountIs(data: Buffer | null) {
  return vi
    .spyOn(connection, "getAccountInfo")
    .mockResolvedValue((data ? { data } : null) as never);
}

function order(...instructions: TransactionInstruction[]) {
  const message = new TransactionMessage({
    payerKey: MAKER,
    recentBlockhash: PublicKey.default.toBase58(),
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), ...instructions],
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

const fee = (amount: bigint, source = CASH_ATA, mint = CASH, authority = TAKER) =>
  createTransferCheckedInstruction(source, mint, FEE_ACCOUNT, authority, amount, 6);

const checkBuy = (transaction: VersionedTransaction) =>
  checkSwapPrograms(transaction, TAKER, CASH_ATA, { quote: quote(BUY), outputAta: STOCK_ATA });
const checkSell = (transaction: VersionedTransaction) =>
  checkSwapPrograms(transaction, TAKER, STOCK_ATA, { quote: quote(SELL), outputAta: CASH_ATA });

afterEach(() => vi.restoreAllMocks());

describe("NoirWire's fee on a market-maker order", () => {
  it("passes the genuine buy and sell shapes, paid to the referral account", async () => {
    feeAccountIs(tokenAccount(CASH, new PublicKey(REFERRAL)));
    // 50 bps of the 12 USDC that leaves, and of the 15.483827 USDC a sell grossed.
    expect(await checkBuy(order(fee(60_000n)))).toEqual({ ok: true });
    expect(await checkSell(order(fee(77_419n)))).toEqual({ ok: true });
  });

  it("refuses a transfer above the fee rate, on either side", async () => {
    const read = feeAccountIs(tokenAccount(CASH, new PublicKey(REFERRAL)));
    expect((await checkBuy(order(fee(60_001n)))).ok).toBe(false);
    expect((await checkBuy(order(fee(12_000_000n)))).ok).toBe(false);
    expect((await checkSell(order(fee(77_421n)))).ok).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  it("refuses a fee paid to an account that is not the referral account's, in this mint", async () => {
    for (const data of [
      tokenAccount(CASH, Keypair.generate().publicKey),
      tokenAccount(STOCK, new PublicKey(REFERRAL)),
      Buffer.alloc(0),
      null,
    ]) {
      feeAccountIs(data);
      expect(await checkBuy(order(fee(60_000n)))).toMatchObject({
        ok: false,
        reason: expect.stringContaining("not NoirWire's"),
      });
    }
  });

  it("refuses a second transfer, another source, another mint or another authority", async () => {
    const read = feeAccountIs(tokenAccount(CASH, new PublicKey(REFERRAL)));
    const other = Keypair.generate().publicKey;
    const hostile = [
      order(fee(30_000n), fee(30_000n)),
      order(fee(60_000n, other)),
      // The stock leaving the account a buy pays into, dressed as a fee.
      order(fee(60_000n, STOCK_ATA, STOCK)),
      order(fee(60_000n, CASH_ATA, STOCK)),
      order(fee(60_000n, CASH_ATA, CASH, other)),
      // A plain Transfer is a different instruction, and never allowed.
      order(createTransferInstruction(CASH_ATA, FEE_ACCOUNT, TAKER, 60_000n)),
    ];
    for (const transaction of hostile) expect((await checkBuy(transaction)).ok).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  it("refuses any transfer when the caller names no order to hold it to", async () => {
    feeAccountIs(tokenAccount(CASH, new PublicKey(REFERRAL)));
    expect((await checkSwapPrograms(order(fee(1n)), TAKER, CASH_ATA)).ok).toBe(false);
  });
});
