import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTransferCheckedInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
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
import { rfqFill } from "./support/routes.js";

/**
 * The one token transfer a swap may carry at the top level: NoirWire's fee on
 * a market-maker order, in the shape genuine orders pay it. The fee comes
 * from the installed platform's environment.
 */
const REFERRAL = new PublicKey("Fps2W6upBuMTgZpBsjgHbsjVVBthkaMfgaWfTXeKhrZw");
installPlatform(
  memoryPlatform({ env: testEnv({ referralAccount: REFERRAL.toBase58(), feeBps: 50 }) }),
);

const { connection } = await import("../../src/infrastructure/solana/client.js");
const { checkSwapPrograms } = await import("../../src/infrastructure/solana/swap/guard.js");

const TAKER = Keypair.generate().publicKey;
const CASH = Keypair.generate().publicKey;
const STOCK = Keypair.generate().publicKey;
const CASH_ATA = Keypair.generate().publicKey;
const STOCK_ATA = Keypair.generate().publicKey;
const MAKER = Keypair.generate().publicKey;

/**
 * Where Jupiter's referral program keeps the referral account's fees in a
 * mint: its associated token account, which `initializeReferralTokenAccountV2`
 * opens.
 */
const referralTokenAccount = (mint: PublicKey) =>
  getAssociatedTokenAddressSync(mint, REFERRAL, true);
const FEE_ACCOUNT = referralTokenAccount(CASH);

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

/** The market maker's fill of `leg`, from the taker's input account into its output account. */
const fill = (leg: typeof BUY, source: PublicKey, destination: PublicKey) =>
  rfqFill({ inAmount: leg.inAmount, output: leg.outAmount, source, destination });

function order(...instructions: TransactionInstruction[]) {
  const message = new TransactionMessage({
    payerKey: MAKER,
    recentBlockhash: PublicKey.default.toBase58(),
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), ...instructions],
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

const buy = (...instructions: TransactionInstruction[]) =>
  order(fill(BUY, CASH_ATA, STOCK_ATA), ...instructions);
const sell = (...instructions: TransactionInstruction[]) =>
  order(fill(SELL, STOCK_ATA, CASH_ATA), ...instructions);

const fee = (
  amount: bigint,
  source = CASH_ATA,
  mint = CASH,
  authority = TAKER,
  destination = FEE_ACCOUNT,
) => createTransferCheckedInstruction(source, mint, destination, authority, amount, 6);

const checkBuy = (transaction: VersionedTransaction) =>
  checkSwapPrograms(transaction, TAKER, CASH_ATA, { quote: quote(BUY), outputAta: STOCK_ATA });
const checkSell = (transaction: VersionedTransaction) =>
  checkSwapPrograms(transaction, TAKER, STOCK_ATA, { quote: quote(SELL), outputAta: CASH_ATA });

afterEach(() => vi.restoreAllMocks());

describe("NoirWire's fee on a market-maker order", () => {
  it("passes the genuine buy and sell shapes, paid to the referral token account, with nothing read", async () => {
    const read = vi.spyOn(connection, "getAccountInfo");
    // 50 bps of the 12 USDC that leaves, and of the 15.483827 USDC a sell grossed.
    expect(await checkBuy(buy(fee(60_000n)))).toEqual({ ok: true });
    expect(await checkSell(sell(fee(77_419n)))).toEqual({ ok: true });
    expect(read).not.toHaveBeenCalled();
  });

  it("pays USDC fees into the account the referral program really opened for NoirWire", async () => {
    // Read from mainnet: the referral account's USDC token account.
    const usdc = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    const live = new PublicKey("8g84HuzpFAH6tPHXDjSev8JE3kGr71zsshuhpvyWWhoh");
    const usdcBuy = { ...BUY, inputMint: usdc };
    const transaction = order(
      fill(usdcBuy, CASH_ATA, STOCK_ATA),
      fee(60_000n, CASH_ATA, usdc, TAKER, live),
    );
    expect(
      await checkSwapPrograms(transaction, TAKER, CASH_ATA, {
        quote: quote(usdcBuy),
        outputAta: STOCK_ATA,
      }),
    ).toEqual({ ok: true });
  });

  it("refuses a transfer above the fee rate, on either side", async () => {
    expect((await checkBuy(buy(fee(60_001n)))).ok).toBe(false);
    expect((await checkBuy(buy(fee(12_000_000n)))).ok).toBe(false);
    expect((await checkSell(sell(fee(77_421n)))).ok).toBe(false);
  });

  it("refuses a fee into any account but the one derived for the referral account and this mint, whatever the server says of it", async () => {
    // A server answering for the chain would say each of these is a token
    // account of this mint that the referral account owns. It is not asked.
    const read = vi.spyOn(connection, "getAccountInfo");
    const stranger = Keypair.generate().publicKey;
    for (const destination of [
      stranger,
      getAssociatedTokenAddressSync(CASH, stranger, true),
      referralTokenAccount(STOCK),
      getAssociatedTokenAddressSync(CASH, REFERRAL, true, TOKEN_2022_PROGRAM_ID),
      REFERRAL,
    ]) {
      expect(await checkBuy(buy(fee(60_000n, CASH_ATA, CASH, TAKER, destination)))).toMatchObject({
        ok: false,
        reason: expect.stringContaining("not NoirWire's"),
      });
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("refuses a transaction with no route and only a fee transfer, though the fee itself is in order", async () => {
    expect(await checkBuy(order(fee(60_000n)))).toMatchObject({
      ok: false,
      reason: expect.stringContaining("no route"),
    });
    expect((await checkSell(order(fee(77_419n)))).ok).toBe(false);
  });

  it("refuses a second transfer, another source, another mint or another authority", async () => {
    const other = Keypair.generate().publicKey;
    const hostile = [
      buy(fee(30_000n), fee(30_000n)),
      buy(fee(60_000n, other)),
      // The stock leaving the account a buy pays into, dressed as a fee.
      buy(fee(60_000n, STOCK_ATA, STOCK, TAKER, referralTokenAccount(STOCK))),
      buy(fee(60_000n, CASH_ATA, STOCK)),
      buy(fee(60_000n, CASH_ATA, CASH, other)),
      // A plain Transfer is a different instruction, and never allowed.
      buy(createTransferInstruction(CASH_ATA, FEE_ACCOUNT, TAKER, 60_000n)),
    ];
    for (const transaction of hostile) expect((await checkBuy(transaction)).ok).toBe(false);
  });

  it("refuses any transfer when the caller names no order to hold it to", async () => {
    expect((await checkSwapPrograms(buy(fee(1n)), TAKER, CASH_ATA)).ok).toBe(false);
  });
});
