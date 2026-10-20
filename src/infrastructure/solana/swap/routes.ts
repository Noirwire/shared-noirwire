import "../buffer-polyfill.js";

import { PublicKey, type MessageAccountKeys, type VersionedTransaction } from "@solana/web3.js";
import { bytesEqual, readU16LE, readU64LE } from "../bytes.js";
import type { SwapQuote } from "./types.js";

/**
 * The minimum a swap is held to when it lands is not the venue's order JSON
 * and not the simulation: it is the minimum written into the route
 * instruction itself, which the venue's program enforces on chain. A builder
 * can state an honest floor in the order and sign a route whose own floor is
 * zero. The simulation, run against the pool as it stands now, would pass
 * it, and whoever controls when it lands could take almost all of it. So
 * the route instruction is read, and held to the quote: it must spend from
 * the taker's own input account and no more than the quote's input, it must
 * pay only into the taker's own output account, and its on-chain minimum
 * must be no lower than the quote's. A transaction carries one route; a
 * second one is refused, since each could meet the floor on its own.
 *
 * The accounts it spends from and pays into must be named in the
 * transaction itself, not loaded from a lookup table. A table is read from
 * the same server that built the transaction, and a server that also faked
 * that read could make an account index look like the taker's while the real
 * table maps it to someone else. Genuine orders keep both of the taker's
 * accounts among the transaction's own keys.
 *
 * An instruction of a venue program that cannot be read is refused, the same
 * way a program that is not listed is. What can be read, each layout taken
 * from the program's own published (on-chain Anchor) IDL:
 *
 * - Jupiter's aggregator: `route_v2` and `shared_accounts_route_v2`, whose
 *   amounts come first, at fixed offsets, before the route plan.
 * - Jupiter's RFQ order engine: `fill`, a fixed amount out, nothing else.
 *
 * What cannot, and is therefore refused: Jupiter's first-generation routes
 * (`route`, `shared_accounts_route` and their token-ledger forms) and
 * DFlow's swaps. Each puts its minimum after a route plan of variable
 * length, and Anchor reads arguments from the front without requiring them
 * to end where the data does, so the last bytes of the data can be anything
 * at all. Finding where the plan really ends means decoding every kind of
 * pool the router supports, a list of two hundred that grows with each
 * upgrade. OKX's swaps are refused for a different reason: the IDL its
 * program publishes on chain is not known to match what is deployed, and
 * how the program treats its minimum has not been verified. Exact-out routes
 * are refused as well: every order here is exact-in.
 */

/** Jupiter's aggregator, the pooled route. */
export const JUPITER_AGGREGATOR = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
/** Jupiter's RFQ order engine, the market-maker route. */
export const JUPITER_RFQ = new PublicKey("61DFfeTKM7trxYcPQCM78bJ794ddZprZpAwAnLiwTpYH");
/** DFlow's aggregator, which the router picks for some pooled orders. */
export const DFLOW_AGGREGATOR = new PublicKey("DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH");
/**
 * OKX's DEX router, the fourth router Jupiter's order endpoint lets compete.
 * This id was taken from documentation, not from a captured order: it is the
 * Solana "DEX router address" in OKX's developer documentation, and the
 * program's own on-chain IDL names it "OKX: DEX Router".
 */
export const OKX_ROUTER = new PublicKey("proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u");

const VENUE_PROGRAMS = [JUPITER_AGGREGATOR, JUPITER_RFQ, DFLOW_AGGREGATOR, OKX_ROUTER];

/**
 * What a route instruction commits to on chain: what it spends from and how
 * much, every account it may pay into, and the least it may pay. An account
 * loaded from a lookup table reads as undefined.
 */
type Route = {
  source: PublicKey | undefined;
  inAmount: bigint;
  destinations: (PublicKey | undefined)[];
  minOut: bigint;
};

type Layout = {
  program: PublicKey;
  /** Anchor's eight-byte instruction discriminator. */
  discriminator: number[];
  /** The fewest data bytes and accounts an instruction of this kind can have. */
  minData: number;
  minAccounts: number;
  read(data: Uint8Array, account: (position: number) => PublicKey | undefined): Route | null;
};

const BPS = 10_000n;

/** The program's own floor: the quoted output less the slippage, rounded down. */
function floorOf(quotedOut: bigint, slippageBps: number): bigint | null {
  if (slippageBps > 10_000) return null;
  return (quotedOut * (BPS - BigInt(slippageBps))) / BPS;
}

function route(
  source: PublicKey | undefined,
  inAmount: bigint,
  destinations: (PublicKey | undefined)[],
  minOut: bigint | null,
): Route | null {
  return minOut === null ? null : { source, inAmount, destinations, minOut };
}

const LAYOUTS: Layout[] = [
  {
    // route_v2(in_amount: u64, quoted_out_amount: u64, slippage_bps: u16,
    //   platform_fee_bps: u16, positive_slippage_bps: u16, route_plan: Vec)
    // Accounts: ..., [1] user_source_token_account, [2] user_destination_token_account,
    //   ..., [7] destination_token_account (optional: the program's own id when absent).
    // Both [2] and a [7] that is set are held to the taker's account: an order
    // here never names a separate destination.
    program: JUPITER_AGGREGATOR,
    discriminator: [187, 100, 250, 204, 49, 196, 175, 20],
    minData: 34,
    minAccounts: 10,
    read: (data, account) => {
      const optional = account(7);
      return route(
        account(1),
        readU64LE(data, 8),
        optional?.equals(JUPITER_AGGREGATOR) ? [account(2)] : [account(2), optional],
        floorOf(readU64LE(data, 16), readU16LE(data, 24)),
      );
    },
  },
  {
    // shared_accounts_route_v2(id: u8, in_amount: u64, quoted_out_amount: u64,
    //   slippage_bps: u16, platform_fee_bps: u16, positive_slippage_bps: u16, route_plan: Vec)
    // Accounts: ..., [2] source_token_account, ..., [5] destination_token_account, ...
    program: JUPITER_AGGREGATOR,
    discriminator: [209, 152, 83, 147, 124, 254, 216, 233],
    minData: 35,
    minAccounts: 12,
    read: (data, account) =>
      route(
        account(2),
        readU64LE(data, 9),
        [account(5)],
        floorOf(readU64LE(data, 17), readU16LE(data, 25)),
      ),
  },
  {
    // fill(input_amount: u64, output_amount: u64, expire_at: i64)
    // Accounts: ..., [2] taker_input_mint_token_account, ...,
    //   [4] taker_output_mint_token_account, ...
    program: JUPITER_RFQ,
    discriminator: [168, 96, 183, 163, 92, 10, 40, 160],
    minData: 32,
    minAccounts: 11,
    read: (data, account) =>
      route(account(2), readU64LE(data, 8), [account(4)], readU64LE(data, 16)),
  },
];

/** The leg a route is held to: the quote, and the taker's own accounts it must spend from and pay into. */
export type RouteLeg = { quote: SwapQuote; inputAta: PublicKey; outputAta: PublicKey };

type RouteVerification = { ok: true } | { ok: false; reason: string };

const UNREADABLE: RouteVerification = {
  ok: false,
  reason:
    "This swap uses a route whose guaranteed minimum cannot be read, so it cannot be checked. Get a new quote. Not signed.",
};

/**
 * Every instruction of a venue program, read and held to `leg`: there may
 * be only one, and the accounts it names are taken from the transaction's
 * own keys, never a lookup table. Without a leg, only that each one can be
 * read. Instructions of other programs are not this function's to judge: the
 * program allowlist does that.
 */
export function checkRoutes(
  transaction: VersionedTransaction,
  accountKeys: MessageAccountKeys,
  leg?: RouteLeg,
): RouteVerification {
  const { staticAccountKeys } = transaction.message;
  let routes = 0;
  for (const instruction of transaction.message.compiledInstructions) {
    const program = accountKeys.get(instruction.programIdIndex);
    if (!program || !VENUE_PROGRAMS.some((venue) => venue.equals(program))) continue;
    const { data, accountKeyIndexes } = instruction;
    const layout = LAYOUTS.find(
      (candidate) =>
        candidate.program.equals(program) &&
        data.length >= candidate.minData &&
        accountKeyIndexes.length >= candidate.minAccounts &&
        bytesEqual(data.subarray(0, 8), Uint8Array.from(candidate.discriminator)),
    );
    const read = layout?.read(data, (position) => staticAccountKeys[accountKeyIndexes[position]]);
    if (!read) return UNREADABLE;
    if (!leg) continue;
    routes += 1;
    if (routes > 1) {
      return { ok: false, reason: "This swap carries more than one route. Not signed." };
    }
    if (!read.source?.equals(leg.inputAta) || read.inAmount > leg.quote.inAmount) {
      return {
        ok: false,
        reason:
          "This swap would spend from an account, or an amount, its quote does not. Not signed.",
      };
    }
    if (!read.destinations.every((destination) => destination?.equals(leg.outputAta))) {
      return {
        ok: false,
        reason: "This swap would pay out to an account that is not yours. Not signed.",
      };
    }
    if (read.minOut < leg.quote.minOutAmount) {
      return {
        ok: false,
        reason: `This swap's own guaranteed minimum is below its quote's. Quoted at least ${leg.quote.minOutAmount}, the transaction enforces ${read.minOut}. Not signed.`,
      };
    }
  }
  return { ok: true };
}
