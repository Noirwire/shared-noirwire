import type { PublicKey, VersionedTransaction } from "@solana/web3.js";

export type SwapRequest = {
  inputMint: PublicKey;
  outputMint: PublicKey;
  /** Base units of `inputMint`, never UI units - floats do not survive this trip. */
  amount: bigint;
  slippageBps: number;
  /** False for an order NoirWire charges no fee on. Charged when left out. */
  noirwireFee?: boolean;
  /**
   * True to ask for a price only, naming no taker. The answer can be shown
   * and never signed: it carries no transaction.
   */
  priceOnly?: boolean;
};

export type SwapQuote = {
  inputMint: PublicKey;
  outputMint: PublicKey;
  inAmount: bigint;
  /** What the venue expects to deliver, before slippage. */
  outAmount: bigint;
  /**
   * The floor the swap is allowed to deliver. This is the number that
   * matters: `outAmount` is a forecast, this is the commitment, and it is
   * what every check before signing is made against.
   */
  minOutAmount: bigint;
  slippageBps: number;
  priceImpactPct: number;
  venue: string;
  /** RFQ deadline when the venue supplies one. */
  expiresAt?: number;
  /** True only when the venue explicitly covers the network fee. */
  gasless?: boolean;
  /**
   * True when the venue names the taker as the one who pays rent. A fee-paid
   * market-maker order carrying NoirWire's fee still leaves the rent of a new
   * output account to the taker, so such an order can need SOL after all.
   */
  takerPaysRent?: boolean;
  /**
   * The venue's charge in basis points, already inside the quoted amounts.
   * On a small gasless order it also pays for the network fee, which is why
   * it can be far above the headline rate (1.88% on a $10 RFQ buy, observed).
   */
  feeBps?: number;
  /** Opaque venue state that `buildTransaction` needs handed back unchanged. */
  raw: unknown;
};

export type BuiltSwap = {
  transaction: VersionedTransaction;
  lastValidBlockHeight: number;
};

export { UnknownOutcomeError } from "../../../domain/chainError.js";

/** Slippage the app will accept at all, whatever a caller or venue asks for. */
export const MAX_SLIPPAGE_BPS = 500;
export const DEFAULT_SLIPPAGE_BPS = 50;

export function clampSlippageBps(requested: number): number {
  if (!Number.isFinite(requested) || requested <= 0) return DEFAULT_SLIPPAGE_BPS;
  return Math.min(Math.round(requested), MAX_SLIPPAGE_BPS);
}

/** The floor implied by a quote's slippage, computed in base units so nothing rounds away. */
export function minimumOut(outAmount: bigint, slippageBps: number): bigint {
  return (outAmount * BigInt(10_000 - slippageBps)) / 10_000n;
}
