import "../buffer-polyfill.js";

import type { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { connection } from "../client.js";
import { isMainnet } from "../config.js";
import { NETWORK_FEE_LAMPORTS } from "../fees.js";
import { signForSending, type StillUnlocked } from "../signerAccounts.js";
import { lamportsToSol } from "../sol.js";
import { ataFor, ataRentFor } from "../tokens.js";
import { QUOTE_TOKEN, stockBySymbol, type TokenDefinition } from "../tokenRegistry.js";
import { executeJupiterSwap, isBuilt, jupiterVenue } from "./jupiter.js";
import { verifySigners, verifySwapBeforeSigning } from "./guard.js";
import { DEFAULT_SLIPPAGE_BPS, type SwapQuote } from "./types.js";

/**
 * The one path a real trade takes: price it, check what the built transaction
 * would actually do to this account's balances, sign it, and hand it back to
 * the venue to land.
 *
 * Every step between the quote and the signature is a refusal point. That is
 * the whole design: the venue is a third party returning a transaction it
 * built, and neither a moved pool nor a bad actor announces itself - both just
 * produce a transaction that takes the input and returns less than promised.
 */

export type TradeSide = "buy" | "sell";

export type TradePlan = {
  side: TradeSide;
  /** The stock being bought or sold. The other leg is always the cash token. */
  stock: TokenDefinition;
  quote: SwapQuote;
  /** What leaves the account, in the leg's own units: dollars, or raw stock tokens. Not the shown, multiplied amount. */
  spend: number;
  /** What the venue expects to deliver, in the same units. */
  receive: number;
  /** The least it is allowed to deliver, in the same units. This is the commitment. */
  receiveAtLeast: number;
  /** Dollars per raw stock token in this specific quote, not a catalog figure. */
  unitPrice: number;
  venue: string;
  /**
   * Whether the quote's price was held against this site's price index (see
   * `checkQuotedPrice` for what that is and is not). False means there was
   * none to hold it against, which the review has to say: the price shown is
   * then the order builder's word alone.
   */
  priceChecked: boolean;
};

/** How much worse than the market price a quote may be before it is refused, in basis points. */
export const MAX_PRICE_DEVIATION_BPS = 1000;

/**
 * Holds a quote's price against the price index this site serves.
 *
 * What that is, exactly: the figure comes from this site's own price route
 * (`/api/prices`), which reads Jupiter's price API. That is a separate
 * system from the order builder that produced the quote, with its own data,
 * so a quote that is wrong on its own shows up here. It is the same company,
 * though, and so not an independent check: nothing here would notice the two
 * being wrong together.
 *
 * Every other limit on a quote is relative to the quote itself: the floor
 * sits within a slippage of the quoted output, and the simulation holds the
 * transaction to that floor. None of that says the quoted output is a fair
 * price. A response offering one raw unit for a hundred dollars is perfectly
 * consistent with itself and would pass all of it.
 *
 * Both prices are dollars per raw token, the unit a transaction moves, so a
 * stock's display multiplier is already inside `marketPrice` and never mixed
 * with a raw amount here. Only a price worse for the user is refused: paying
 * more than the market on a buy, getting less on a sell. With no market price
 * to compare against nothing is refused, and the answer is false so the
 * review can say the price went unchecked.
 */
export function checkQuotedPrice(
  side: TradeSide,
  unitPrice: number,
  marketPrice: number | undefined,
): boolean {
  if (marketPrice === undefined || !(marketPrice > 0)) return false;
  const tolerance = MAX_PRICE_DEVIATION_BPS / 10_000;
  const worse =
    side === "buy"
      ? unitPrice > marketPrice * (1 + tolerance)
      : unitPrice < marketPrice * (1 - tolerance);
  if (worse || !Number.isFinite(unitPrice)) {
    throw new Error(
      `This quote is more than ${MAX_PRICE_DEVIATION_BPS / 100}% worse than the current market price. Not offered.`,
    );
  }
  return true;
}

function toBaseUnits(amount: number, decimals: number): bigint {
  return BigInt(Math.round(amount * 10 ** decimals));
}

function toDisplayUnits(amount: bigint, decimals: number): number {
  return Number(amount) / 10 ** decimals;
}

/**
 * Whether a real trade can be priced at all.
 *
 * Trading is mainnet-only, and not by choice: the router aggregates real
 * liquidity pools and none of them exist on devnet, so there is nothing for it
 * to route through and no devnet address to point a stock mint at. Offering a
 * buy button that cannot work is worse than saying so.
 */
export function tradingAvailable(): boolean {
  return isMainnet();
}

/**
 * Prices one trade without committing to it. The returned plan carries the
 * venue's own order inside `quote.raw`, so building the transaction later
 * uses the exact route the user was shown - re-requesting would produce a
 * different route at a different price than the one they agreed to.
 */
export async function planTrade(input: {
  owner: Keypair;
  side: TradeSide;
  symbol: string;
  /** Buying: cash to spend. Selling: shares to sell. */
  amount: number;
  slippageBps?: number;
  /** Live dollars per raw stock token from this site's price index, when there is one. */
  marketPrice?: number;
  /**
   * True for a price with no order behind it. Jupiter prices nothing for an
   * account that cannot pay an order's network cost, so the review of such a
   * trade shows this, and the order itself is priced once the cost is covered.
   */
  priceOnly?: boolean;
}): Promise<TradePlan> {
  const stock = stockBySymbol(input.symbol);
  if (!stock) throw new Error(`${input.symbol} is not a tradable asset.`);
  if (stock.retired && input.side === "buy") {
    throw new Error(
      `${input.symbol} is no longer offered to buy. What you hold can still be sold.`,
    );
  }
  if (!(input.amount > 0)) throw new Error("Enter an amount greater than zero.");

  const cash = QUOTE_TOKEN;
  const from = input.side === "buy" ? cash : stock;
  const to = input.side === "buy" ? stock : cash;

  const quote = await jupiterVenue(input.owner.publicKey).quote({
    inputMint: from.mint,
    outputMint: to.mint,
    amount: toBaseUnits(input.amount, from.decimals),
    slippageBps: input.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
    priceOnly: input.priceOnly,
  });

  const spend = toDisplayUnits(quote.inAmount, from.decimals);
  const receive = toDisplayUnits(quote.outAmount, to.decimals);
  const receiveAtLeast = toDisplayUnits(quote.minOutAmount, to.decimals);
  const shares = input.side === "buy" ? receive : spend;
  const cashLeg = input.side === "buy" ? spend : receive;

  const unitPrice = shares > 0 ? cashLeg / shares : 0;

  return {
    side: input.side,
    stock,
    quote,
    spend,
    receive,
    receiveAtLeast,
    unitPrice,
    venue: quote.venue,
    priceChecked: checkQuotedPrice(input.side, unitPrice, input.marketPrice),
  };
}

/**
 * Signs and submits a planned trade, but only after simulating it and
 * confirming it moves at least the quote's committed floor into this
 * account and takes no more than the quoted amount out.
 *
 * `stillUnlocked` is asked after all of that, right before the key signs.
 *
 * Returns the landed signature. The caller re-reads real balances afterwards
 * rather than trusting these numbers, because what settled is a chain fact
 * and everything here is still a forecast until it is.
 */
export async function executeTrade(
  owner: Keypair,
  plan: TradePlan,
  stillUnlocked: StillUnlocked,
): Promise<string> {
  const cash = QUOTE_TOKEN;
  const from = plan.side === "buy" ? cash : plan.stock;
  const to = plan.side === "buy" ? plan.stock : cash;

  const venue = jupiterVenue(owner.publicKey);
  const built = await venue.buildTransaction(plan.quote);

  const signerCheck = verifySigners(built.transaction, owner.publicKey);
  if (!signerCheck.ok) throw new Error(signerCheck.reason);

  const outputAta = ataFor(to.mint, owner.publicKey, to.programId);
  const verdict = await verifySwapBeforeSigning(
    built.transaction,
    plan.quote,
    owner.publicKey,
    ataFor(from.mint, owner.publicKey, from.programId),
    outputAta,
    { mint: plan.stock.mint, acquiring: plan.side === "buy" },
    await lamportsBudget(plan, built.transaction, outputAta),
  );
  if (!verdict.ok) throw new Error(verdict.reason);

  await signForSending(built.transaction, owner, stillUnlocked, built.lastValidBlockHeight);
  return executeJupiterSwap(plan.quote, built.transaction);
}

/** Headroom for rent extensions and fee changes between review and submission. */
const SOL_HEADROOM_LAMPORTS = 500_000;

/**
 * The most SOL any one trade may be budgeted, whatever its transaction asks
 * for. The network fee below is read off the transaction the venue built,
 * priority fee included, so without a fixed ceiling a response could raise
 * its own limit simply by naming a larger fee. 0.01 SOL covers the largest
 * token account's rent, the headroom and a priority fee far above a normal one.
 */
export const MAX_TRADE_LAMPORTS = 10_000_000;

/**
 * The most SOL one trade may take from the account, for the check before
 * signing. An order the venue pays for takes none, unless the venue leaves
 * the rent of a new output account to the taker: then that rent and nothing
 * else. Any other pays its own network fee and, on a first trade into a
 * token, the rent of the account that will hold it, with the same headroom
 * the review screen budgets. A trade that would need more than
 * `MAX_TRADE_LAMPORTS` is refused outright.
 */
export async function lamportsBudget(
  plan: TradePlan,
  transaction: VersionedTransaction,
  outputAta: PublicKey,
): Promise<bigint> {
  const output = plan.side === "buy" ? plan.stock : QUOTE_TOKEN;
  if (plan.quote.gasless) {
    if (!plan.quote.takerPaysRent || (await connection.getAccountInfo(outputAta))) return 0n;
    return BigInt(await ataRentFor(output.mint, output.programId));
  }
  const [fee, existing] = await Promise.all([
    connection.getFeeForMessage(transaction.message),
    connection.getAccountInfo(outputAta),
  ]);
  if (fee.value === null) throw new Error("The network fee could not be checked.");
  const rent = existing ? 0 : await ataRentFor(output.mint, output.programId);
  const budget = fee.value + rent + SOL_HEADROOM_LAMPORTS;
  if (budget > MAX_TRADE_LAMPORTS) {
    throw new Error(
      `This trade asks for a network fee far above normal (${lamportsToSol(fee.value)} SOL). Not signed.`,
    );
  }
  return BigInt(budget);
}

/**
 * The lamports a set of trades needs from the account itself, or 0 when the
 * venue pays for all of it. Covers each network fee the taker pays, the rent
 * of every output token account that does not exist yet and is the taker's
 * to open (once, however many trades pay into it), and one margin of
 * headroom when any fee is the taker's.
 */
export async function lamportsNeededForTrades(
  plans: TradePlan[],
  owner: PublicKey,
): Promise<number> {
  const paying = plans.filter((plan) => !plan.quote.gasless || plan.quote.takerPaysRent);
  if (paying.length === 0) return 0;
  const outputs = [
    ...new Map(
      paying.map((plan) => {
        const token = plan.side === "buy" ? plan.stock : QUOTE_TOKEN;
        return [token.symbol, { token, ata: ataFor(token.mint, owner, token.programId) }] as const;
      }),
    ).values(),
  ];
  const [fees, outputInfos] = await Promise.all([
    Promise.all(
      paying.map(async (plan) => {
        if (plan.quote.gasless) return 0;
        // Jupiter prices an order the taker has no SOL for without building
        // it. The requirement still has to be shown, so it is counted at the
        // base fee; a new price is needed before it can be placed anyway.
        if (!isBuilt(plan.quote)) return NETWORK_FEE_LAMPORTS;
        const { transaction } = await jupiterVenue(owner).buildTransaction(plan.quote);
        const fee = await connection.getFeeForMessage(transaction.message);
        if (fee.value === null) throw new Error("The network fee could not be checked.");
        return fee.value;
      }),
    ),
    connection.getMultipleAccountsInfo(outputs.map((output) => output.ata)),
  ]);
  // Each mint sets its own account size: a stock's account is larger than a cash one.
  const rents = await Promise.all(
    outputs
      .filter((_, index) => outputInfos[index] === null)
      .map(({ token }) => ataRentFor(token.mint, token.programId)),
  );
  const rent = rents.reduce((sum, value) => sum + value, 0);
  const fee = fees.reduce((sum, value) => sum + value, 0);
  return fee + rent + (fee > 0 ? SOL_HEADROOM_LAMPORTS : 0);
}
