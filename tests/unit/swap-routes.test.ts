import { describe, expect, it } from "vitest";
import {
  AddressLookupTableAccount,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { checkRoutes } from "../../src/infrastructure/solana/swap/routes.js";
import type { SwapQuote } from "../../src/infrastructure/solana/swap/types.js";
import {
  DFLOW,
  discriminator,
  JUPITER,
  rfqFill,
  routeV2,
  sharedRouteV2,
} from "./support/routes.js";

const TAKER = Keypair.generate().publicKey;
const INPUT_ATA = Keypair.generate().publicKey;
const OUTPUT_ATA = Keypair.generate().publicKey;
const STRANGER_ATA = Keypair.generate().publicKey;

const QUOTE = {
  inAmount: 1_000_000n,
  outAmount: 500_000n,
  minOutAmount: 495_000n,
} as SwapQuote;
const LEG = { quote: QUOTE, inputAta: INPUT_ATA, outputAta: OUTPUT_ATA };

/** A lookup table holding `addresses`, as the server would answer for it. */
const table = (...addresses: PublicKey[]) =>
  new AddressLookupTableAccount({
    key: Keypair.generate().publicKey,
    state: {
      deactivationSlot: 2n ** 64n - 1n,
      lastExtendedSlot: 0,
      lastExtendedSlotStartIndex: 0,
      addresses,
    },
  });

/**
 * `checkRoutes` over a transaction of `instructions`, held to `LEG`, or to no
 * order at all with null. Accounts in `tables` are loaded from a lookup table.
 */
function check(
  instructions: TransactionInstruction | TransactionInstruction[],
  leg: typeof LEG | null = LEG,
  tables: AddressLookupTableAccount[] = [],
) {
  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: TAKER,
      recentBlockhash: PublicKey.default.toBase58(),
      instructions: [instructions].flat(),
    }).compileToV0Message(tables),
  );
  const accountKeys = transaction.message.getAccountKeys({ addressLookupTableAccounts: tables });
  return checkRoutes(transaction, accountKeys, leg ?? undefined);
}

/** A `route_v2` from the taker's input account that the quote's own numbers would pass. */
const honest = (overrides: Partial<Parameters<typeof routeV2>[0]> = {}) =>
  routeV2({
    quotedOut: 500_000n,
    slippageBps: 100,
    source: INPUT_ATA,
    destination: OUTPUT_ATA,
    ...overrides,
  });

describe("a pooled route, as Jupiter's route_v2 writes its minimum", () => {
  it("passes a route paying the taker with an on-chain minimum exactly the quote's", () => {
    // 500,000 quoted at 1% slippage: 495,000 enforced on chain.
    expect(check(honest())).toEqual({ ok: true });
  });

  it("refuses a route whose own minimum is one unit below the quote's", () => {
    // 500,000 at 1.01%: 494,950 enforced, against 495,000 quoted.
    expect(check(honest({ slippageBps: 101 }))).toMatchObject({
      ok: false,
      reason: expect.stringContaining("guaranteed minimum"),
    });
  });

  it("refuses a route whose minimum is zero, however honest the quote it came with", () => {
    expect(check(honest({ quotedOut: 1n, slippageBps: 10_000 })).ok).toBe(false);
  });

  it("refuses a slippage over 100%, which no program reads as a minimum", () => {
    expect(check(honest({ slippageBps: 10_001 }))).toMatchObject({
      ok: false,
      reason: expect.stringContaining("cannot be read"),
    });
  });

  it("holds both destinations to the taker's account: the usual one, and an override when set", () => {
    const notYours = { ok: false, reason: expect.stringContaining("not yours") };
    expect(check(honest({ optional: STRANGER_ATA }))).toMatchObject(notYours);
    expect(check(honest({ destination: STRANGER_ATA, optional: OUTPUT_ATA }))).toMatchObject(
      notYours,
    );
    expect(check(honest({ optional: OUTPUT_ATA }))).toEqual({ ok: true });
  });

  it("refuses a route spending from another account, or more than the quote's input", () => {
    const spends = { ok: false, reason: expect.stringContaining("spend from") };
    expect(check(honest({ source: STRANGER_ATA }))).toMatchObject(spends);
    expect(check(honest({ inAmount: QUOTE.inAmount + 1n }))).toMatchObject(spends);
    expect(check(honest({ inAmount: QUOTE.inAmount - 1n }))).toEqual({ ok: true });
  });

  it("holds the shared-accounts form to its own source, destination and minimum", () => {
    const shared = (input: { source?: PublicKey; destination?: PublicKey; slippageBps?: number }) =>
      check(
        sharedRouteV2({
          quotedOut: 500_000n,
          slippageBps: input.slippageBps ?? 100,
          source: input.source ?? INPUT_ATA,
          destination: input.destination ?? OUTPUT_ATA,
        }),
      );
    expect(shared({})).toEqual({ ok: true });
    expect(shared({ destination: STRANGER_ATA }).ok).toBe(false);
    expect(shared({ source: STRANGER_ATA }).ok).toBe(false);
    expect(shared({ slippageBps: 101 }).ok).toBe(false);
  });
});

describe("a market-maker fill", () => {
  const fill = (input: {
    output?: bigint;
    source?: PublicKey;
    destination?: PublicKey;
    inAmount?: bigint;
  }) =>
    check(
      rfqFill({
        output: input.output ?? 495_000n,
        source: input.source ?? INPUT_ATA,
        destination: input.destination ?? OUTPUT_ATA,
        inAmount: input.inAmount,
      }),
    );

  it("is held to its fixed amount out, its input and the taker's accounts", () => {
    expect(fill({})).toEqual({ ok: true });
    expect(fill({ output: 494_999n }).ok).toBe(false);
    expect(fill({ destination: STRANGER_ATA }).ok).toBe(false);
    expect(fill({ source: STRANGER_ATA }).ok).toBe(false);
    expect(fill({ inAmount: QUOTE.inAmount + 1n }).ok).toBe(false);
  });
});

describe("what a lookup table and a second route cannot do", () => {
  it("refuses the taker's accounts when they are loaded from a lookup table, which the server answers for", () => {
    // The table here maps the indexes to the taker's own accounts, as a
    // server faking the read would. The real table could map them anywhere.
    expect(check(honest(), LEG, [table(OUTPUT_ATA)])).toMatchObject({
      ok: false,
      reason: expect.stringContaining("not yours"),
    });
    expect(check(honest(), LEG, [table(INPUT_ATA)])).toMatchObject({
      ok: false,
      reason: expect.stringContaining("spend from"),
    });
  });

  it("still reads a route whose other accounts come from a lookup table", () => {
    const route = honest();
    const pools = route.keys
      .filter((key, position) => ![1, 2, 7].includes(position) && !key.pubkey.equals(JUPITER))
      .map((key) => key.pubkey);
    expect(check(route, LEG, [table(...pools)])).toEqual({ ok: true });
  });

  it("refuses two routes, though each one meets the floor on its own", () => {
    expect(check([honest(), honest()])).toMatchObject({
      ok: false,
      reason: expect.stringContaining("more than one route"),
    });
  });
});

describe("a route whose minimum cannot be read", () => {
  const unreadable = { ok: false, reason: expect.stringContaining("cannot be read") };

  it("refuses Jupiter's first-generation route, whose last bytes can say anything", () => {
    // The program reads its arguments from the front: an empty route plan,
    // then a minimum of zero. The bytes after them are ignored on chain, and
    // here they spell out an honest 500,000 at 1%.
    const args = Buffer.alloc(4 + 8 + 8 + 2 + 1);
    args.writeBigUInt64LE(1_000_000n, 4);
    args.writeBigUInt64LE(1n, 12);
    args.writeUInt16LE(10_000, 20);
    const honestTail = Buffer.alloc(8 + 8 + 2 + 1);
    honestTail.writeBigUInt64LE(1_000_000n, 0);
    honestTail.writeBigUInt64LE(500_000n, 8);
    honestTail.writeUInt16LE(100, 16);
    const forged = new TransactionInstruction({
      programId: JUPITER,
      keys: [{ pubkey: OUTPUT_ATA, isSigner: false, isWritable: true }],
      data: Buffer.concat([discriminator("route"), args, honestTail]),
    });
    expect(check(forged)).toMatchObject(unreadable);
  });

  it("refuses an exact-out route, a DFlow swap, and a Jupiter instruction it does not know", () => {
    const exactOut = honest();
    discriminator("exact_out_route_v2").copy(exactOut.data);
    const dflow = new TransactionInstruction({
      programId: DFLOW,
      keys: [],
      data: Buffer.concat([discriminator("swap"), Buffer.alloc(32)]),
    });
    const claim = new TransactionInstruction({
      programId: JUPITER,
      keys: [],
      data: Buffer.concat([discriminator("claim"), Buffer.alloc(1)]),
    });
    for (const instruction of [exactOut, dflow, claim]) {
      expect(check(instruction)).toMatchObject(unreadable);
    }
  });

  it("refuses a route cut short of its own arguments or accounts", () => {
    const whole = honest();
    const short = new TransactionInstruction({ ...whole, data: whole.data.subarray(0, 33) });
    const fewer = new TransactionInstruction({ ...whole, keys: whole.keys.slice(0, 9) });
    expect(check(short)).toMatchObject(unreadable);
    expect(check(fewer)).toMatchObject(unreadable);
  });

  it("is refused even with no order to hold it to; a readable one then passes", () => {
    const readable = routeV2({
      quotedOut: 1n,
      slippageBps: 0,
      source: STRANGER_ATA,
      destination: STRANGER_ATA,
    });
    expect(check(readable, null)).toEqual({ ok: true });
    const dflow = new TransactionInstruction({ programId: DFLOW, keys: [], data: Buffer.alloc(8) });
    expect(check(dflow, null)).toMatchObject(unreadable);
  });
});
