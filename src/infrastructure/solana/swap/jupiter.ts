import "../buffer-polyfill.js";

import { Buffer } from "buffer";
import { apiUrl } from "../../api.js";
import { authorizedFetch } from "../../apiSession.js";
import { jupiterThroughApi, jupiterReferralAccount, noirwireFeeBps } from "../config.js";

import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { ChainError, isChainError } from "../../../domain/chainError.js";
import { connection } from "../client.js";
import {
  clampSlippageBps,
  MAX_SLIPPAGE_BPS,
  minimumOut,
  UnknownOutcomeError,
  type BuiltSwap,
  type SwapQuote,
  type SwapRequest,
} from "./types.js";
import { outcomeWithin, signatureOf, signaturesOf } from "../settlement.js";

/**
 * Jupiter, the swap venue. Mainnet-only by nature, not by choice: the router
 * aggregates real liquidity pools, and none of them exist on devnet.
 */

/**
 * Two shapes come back from the same endpoint and the difference is not
 * cosmetic.
 *
 * An AMM route returns `swapTransaction` and enforces a slippage tolerance.
 * An RFQ route (`swapType: "rfq"`, what the liquid xStocks pairs actually
 * use today) returns `transaction`, quotes a **guaranteed** price so
 * `slippageBps` is 0 and the threshold equals the quote exactly, is gasless
 * with the market maker paying network and rent fees, and **expires**.
 * Reading only `swapTransaction` silently breaks every real stock trade,
 * which is exactly what happened before this was checked against the live
 * API.
 */
type JupiterOrder = {
  inAmount: string;
  outAmount: string;
  otherAmountThreshold?: string;
  slippageBps?: number;
  priceImpactPct?: string | number;
  priceImpact?: string | number;
  /** AMM route. */
  swapTransaction?: string;
  /** RFQ route. */
  transaction?: string;
  requestId: string;
  /** Why a priced order came back without a transaction, e.g. the taker cannot cover it. */
  errorMessage?: string;
  lastValidBlockHeight?: number;
  swapType?: string;
  gasless?: boolean;
  /** Who pays for a token account the order has to open. */
  rentFeePayer?: string;
  /** Jupiter's own charge on this order, taken from the traded amount. */
  feeBps?: number;
  /** Unix seconds; RFQ quotes are only honoured until then. */
  expireAt?: string;
  inUsdValue?: number;
  outUsdValue?: number;
};

/**
 * An RFQ price is a firm offer with a deadline, so a quote the user sat on
 * is not a quote any more. Signing an expired one just wastes a failed
 * transaction; saying so is more useful.
 */
function isExpired(order: JupiterOrder): boolean {
  if (!order.expireAt) return false;
  return Number(order.expireAt) * 1000 <= Date.now();
}

/**
 * The order size from which Jupiter pays the network fee itself, in dollars.
 * Its documentation says about $10, moving with network conditions. Live
 * orders for a taker holding no SOL agreed: without NoirWire's fee a $10 buy
 * was built and a $5 one was not, and with the fee a $12 buy was built and a
 * $10 one was not. Shown to the user as an approximate figure only; nothing
 * is decided by it.
 */
export function gaslessFromUsd(): number {
  return noirwireFeeBps() > 0 ? 12 : 10;
}

/** Jupiter's answer when no router will take an order, which is all it says. */
export class NoQuoteError extends ChainError {
  constructor() {
    super("noQuote");
    this.name = "NoQuoteError";
  }
}

/** Whether the order can be built and signed, or only shows a price. */
export function isBuilt(quote: SwapQuote): boolean {
  const order = quote.raw as JupiterOrder;
  return Boolean(order.transaction ?? order.swapTransaction);
}

function orderTransaction(order: JupiterOrder): string {
  const encoded = order.transaction ?? order.swapTransaction;
  if (!encoded) {
    throw new Error(order.errorMessage || "Jupiter returned no transaction for this route.");
  }
  return encoded;
}

async function getOrder(request: SwapRequest, taker: PublicKey): Promise<JupiterOrder> {
  const slippageBps = clampSlippageBps(request.slippageBps);
  const referralAccount = jupiterReferralAccount();
  const order = {
    inputMint: request.inputMint.toBase58(),
    outputMint: request.outputMint.toBase58(),
    amount: request.amount.toString(),
    ...(request.priceOnly ? {} : { taker: taker.toBase58() }),
    slippageBps: String(slippageBps),
    ...(referralAccount && request.noirwireFee !== false
      ? { referralAccount, referralFee: String(noirwireFeeBps()) }
      : {}),
  };

  // A POST with the order in its body, never a query: the server builds
  // Jupiter's GET on its side, so the taker's address is in no URL of ours.
  const response = await jupiterThroughApi("/swap/v2/order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(order),
  });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = (payload as { error?: string } | null)?.error;
    if (detail === "Failed to get quotes") throw new NoQuoteError();
    throw new Error(detail || `Jupiter returned ${response.status}.`);
  }
  return payload as JupiterOrder;
}

/** A raw token amount as the API sends it: a string of digits, and never zero. */
function rawAmount(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^\d+$/.test(value) || BigInt(value) <= 0n) {
    throw new Error(`Jupiter returned a quote without a usable ${label}. Get a new quote.`);
  }
  return BigInt(value);
}

/**
 * Turns the venue's order into the quote every later check is made against,
 * and refuses one whose own numbers are outside what was asked for.
 *
 * The order comes from the same party that builds the transaction, so its
 * floor and slippage cannot simply be believed: a response that sets its own
 * floor near zero would make the check before signing pass a swap that
 * returns almost nothing. The floor has to sit within the app's widest
 * slippage of the quoted output, and the input can never be more than the
 * amount requested (every request here is exact-in). A quote outside those
 * bounds is refused, not corrected: a corrected floor would be a number the
 * transaction on chain does not enforce.
 */
function quoteFromOrder(order: JupiterOrder, request: SwapRequest, taker: PublicKey): SwapQuote {
  const inAmount = rawAmount(order.inAmount, "input amount");
  const outAmount = rawAmount(order.outAmount, "output amount");
  if (inAmount > request.amount) {
    throw new Error("Jupiter quoted a larger amount than was asked for. Get a new quote.");
  }

  const slippageBps = order.slippageBps ?? clampSlippageBps(request.slippageBps);
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > MAX_SLIPPAGE_BPS) {
    throw new Error("Jupiter quoted a wider slippage than this app accepts. Get a new quote.");
  }

  // Jupiter's own threshold is what the transaction enforces on chain, so it
  // is the floor when present. Our computed one is only the fallback for a
  // response that omits it.
  const minOutAmount =
    order.otherAmountThreshold == null
      ? minimumOut(outAmount, slippageBps)
      : rawAmount(order.otherAmountThreshold, "minimum");
  if (minOutAmount <= 0n || minOutAmount < minimumOut(outAmount, MAX_SLIPPAGE_BPS)) {
    throw new Error(
      "Jupiter's guaranteed minimum is further below its quote than this app accepts. Get a new quote.",
    );
  }

  return {
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    inAmount,
    outAmount,
    minOutAmount,
    slippageBps,
    priceImpactPct: Number(order.priceImpactPct ?? order.priceImpact ?? 0),
    venue: order.swapType === "rfq" ? "Jupiter RFQ" : "Jupiter",
    expiresAt: order.expireAt ? Number(order.expireAt) * 1000 : undefined,
    gasless: order.gasless === true,
    takerPaysRent: order.rentFeePayer === taker.toBase58(),
    feeBps: typeof order.feeBps === "number" ? order.feeBps : undefined,
    raw: order,
  };
}

/**
 * Jupiter prices and builds in one call, so a quote is taken by asking for
 * the order and holding on to it. `raw` carries that order through to
 * `buildTransaction` unchanged - re-requesting would produce a different
 * route at a different price than the one the user was shown and agreed to.
 */
export function jupiterVenue(taker: PublicKey) {
  return {
    async quote(request: SwapRequest): Promise<SwapQuote> {
      return quoteFromOrder(await getOrder(request, taker), request, taker);
    },

    async buildTransaction(quote: SwapQuote): Promise<BuiltSwap> {
      const order = quote.raw as JupiterOrder;
      if (isExpired(order)) {
        throw new Error("This price has expired. Get a new quote.");
      }
      return {
        transaction: VersionedTransaction.deserialize(
          Buffer.from(orderTransaction(order), "base64"),
        ),
        lastValidBlockHeight: order.lastValidBlockHeight ?? 0,
      };
    },
  };
}

type ExecuteResult = { status?: string; signature?: string; error?: string };

/** How long a submitted swap is watched for on chain before its outcome is called unknown. */
const CONFIRM_WAIT_MS = 20_000;

/**
 * Whether the transaction that landed under `signature` is the one we signed.
 * Needed only when its id was not ours to know in advance: some confirmed
 * transaction existing under a signature the venue named proves nothing, but
 * our own signature among its signatures does, since a signature is only
 * valid over the exact message it was made for.
 */
async function carriesOurSignature(
  signature: string,
  signedTransaction: VersionedTransaction,
): Promise<boolean> {
  const ours = signaturesOf(signedTransaction);
  const landed = await connection
    .getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
    .catch(() => null);
  return ours.length > 0 && ours.every((own) => landed?.transaction.signatures.includes(own));
}

/**
 * Hands the signed transaction back to Jupiter to land, which is what its
 * `/execute` endpoint is for - it retries and confirms rather than leaving
 * a swap to expire against a congested RPC. `requestId` ties the submission
 * to the exact order that was quoted.
 *
 * Its reply is a receipt for the submission, not proof of a trade. A swap is
 * reported as done only once the chain shows it: under the transaction's own
 * signature when that is known, whatever signature the reply names, and
 * otherwise under the named one once it is seen to carry our signature. And
 * since the swap may land whatever the reply says, or without one, only the
 * chain counts as a failure: an error recorded there, or the transaction's
 * time run out with no trace of it. Everything else, Jupiter's own refusal
 * included, is thrown as `UnknownOutcomeError` and settled later.
 */
export async function executeJupiterSwap(
  quote: SwapQuote,
  signedTransaction: VersionedTransaction,
): Promise<string> {
  const order = quote.raw as JupiterOrder;

  let status = 0;
  let result: ExecuteResult | null = null;
  try {
    const response = await authorizedFetch(apiUrl("jupiter", "/swap/v2/execute"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signedTransaction: Buffer.from(signedTransaction.serialize()).toString("base64"),
        requestId: order.requestId,
      }),
    });
    status = response.status;
    result = (await response.json().catch(() => null)) as ExecuteResult | null;
  } catch (error) {
    // NoirWire's server would not take the request, so Jupiter never had the swap.
    if (isChainError(error, "notAvailableNow")) throw error;
    /* no answer; settled against the chain below */
  }

  // Jupiter's refusal, or its word that the swap failed, is not taken as
  // final: it had the signed transaction, and may have passed it on before
  // it answered. Only the chain settles it, now or later: landed, or failed
  // there, or expired with no trace.
  const refused = result?.status === "Failed" || (status >= 400 && status < 500);
  const own = signatureOf(signedTransaction);
  const signature = own ?? result?.signature;
  if (!signature) throw new UnknownOutcomeError(undefined, order.lastValidBlockHeight);
  const submitted = !refused && status >= 200 && status < 300 && Boolean(result?.signature);
  const outcome = await outcomeWithin(
    signature,
    order.lastValidBlockHeight,
    submitted ? CONFIRM_WAIT_MS : 0,
  );
  if (outcome === "failed") throw new Error("The swap did not go through.");
  if (
    outcome === "confirmed" &&
    (own || (await carriesOurSignature(signature, signedTransaction)))
  ) {
    return signature;
  }
  throw new UnknownOutcomeError(signature, order.lastValidBlockHeight);
}
