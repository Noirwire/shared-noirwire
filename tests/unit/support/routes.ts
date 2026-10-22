import { createHash } from "node:crypto";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";

export const JUPITER = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
export const JUPITER_RFQ = new PublicKey("61DFfeTKM7trxYcPQCM78bJ794ddZprZpAwAnLiwTpYH");
export const DFLOW = new PublicKey("DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH");

/** Anchor's discriminator for an instruction: the first eight bytes of sha256("global:<name>"). */
export const discriminator = (name: string) =>
  createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);

const filler = (count: number) =>
  Array.from({ length: count }, () => ({
    pubkey: Keypair.generate().publicKey,
    isSigner: false,
    isWritable: false,
  }));

const at = <T>(list: T[], position: number, value: T) => {
  list[position] = value;
  return list;
};

const writable = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: true });

/** What every route spends: from which account, and how much (1,000,000 unless given). */
type Spend = { source: PublicKey; inAmount?: bigint };

/**
 * Jupiter's `route_v2`, laid out as its IDL has it: in_amount, quoted_out_amount,
 * slippage_bps, platform_fee_bps, positive_slippage_bps, then an empty route
 * plan. The source is account 1, the destination account 2. `optional` is
 * the destination override at account 7, the program's own id when there is
 * none.
 */
export function routeV2(
  input: Spend & {
    quotedOut: bigint;
    slippageBps: number;
    destination: PublicKey;
    optional?: PublicKey;
  },
): TransactionInstruction {
  const data = Buffer.alloc(34);
  discriminator("route_v2").copy(data);
  data.writeBigUInt64LE(input.inAmount ?? 1_000_000n, 8);
  data.writeBigUInt64LE(input.quotedOut, 16);
  data.writeUInt16LE(input.slippageBps, 24);
  const keys = at(filler(10), 1, writable(input.source));
  at(keys, 2, writable(input.destination));
  at(keys, 7, writable(input.optional ?? JUPITER));
  return new TransactionInstruction({ programId: JUPITER, keys, data });
}

/** Jupiter's `shared_accounts_route_v2`: an `id` byte first, then the same amounts; the source is account 2, the destination account 5. */
export function sharedRouteV2(
  input: Spend & { quotedOut: bigint; slippageBps: number; destination: PublicKey },
): TransactionInstruction {
  const data = Buffer.alloc(35);
  discriminator("shared_accounts_route_v2").copy(data);
  data.writeBigUInt64LE(input.inAmount ?? 1_000_000n, 9);
  data.writeBigUInt64LE(input.quotedOut, 17);
  data.writeUInt16LE(input.slippageBps, 25);
  const keys = at(filler(12), 2, writable(input.source));
  at(keys, 5, writable(input.destination));
  return new TransactionInstruction({ programId: JUPITER, keys, data });
}

/** The RFQ engine's `fill`: input_amount, output_amount, expire_at; the taker's input account is account 2, its output account account 4. */
export function rfqFill(
  input: Spend & { output: bigint; destination: PublicKey },
): TransactionInstruction {
  const data = Buffer.alloc(32);
  discriminator("fill").copy(data);
  data.writeBigUInt64LE(input.inAmount ?? 1_000_000n, 8);
  data.writeBigUInt64LE(input.output, 16);
  const keys = at(filler(11), 2, writable(input.source));
  at(keys, 4, writable(input.destination));
  return new TransactionInstruction({ programId: JUPITER_RFQ, keys, data });
}
