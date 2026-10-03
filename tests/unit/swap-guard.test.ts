import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCloseAccountInstruction,
  createTransferCheckedInstruction,
  ExtensionType,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  SystemProgram,
} from "@solana/web3.js";
import { connection } from "../../src/infrastructure/solana/client.js";
import {
  checkSwapPrograms,
  verifySigners,
  verifySwapBeforeSigning,
} from "../../src/infrastructure/solana/swap/guard.js";
import type { SwapQuote } from "../../src/infrastructure/solana/swap/types.js";
import { mintAccount } from "./support/mintAccount.js";

const TAKER = Keypair.generate();
const INPUT_ATA = Keypair.generate().publicKey;
const OUTPUT_ATA = Keypair.generate().publicKey;
const MINT = Keypair.generate().publicKey;
/** Another token account the taker owns, which the swap has no business touching. */
const OTHER_ATA = Keypair.generate().publicKey;

const QUOTE: SwapQuote = {
  inputMint: Keypair.generate().publicKey,
  outputMint: Keypair.generate().publicKey,
  inAmount: 1_000_000n,
  outAmount: 500_000n,
  minOutAmount: 495_000n,
  slippageBps: 100,
  priceImpactPct: 0.1,
  venue: "test",
  raw: {},
};

/** A 165-byte SPL token account the taker owns holding `amount`, optionally with a delegate set. */
function tokenData(amount: bigint, delegated = false, owner = TAKER.publicKey): Buffer {
  const data = Buffer.alloc(165);
  owner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  if (delegated) data.writeUInt32LE(1, 72);
  return data;
}

const simulatedToken = (data: Buffer) => ({ data: [data.toString("base64"), "base64"] });
const wallet = (lamports: number, owner = SystemProgram.programId) => ({
  lamports,
  owner,
  data: Buffer.alloc(0),
});
const simulatedWallet = (lamports: number, owner = SystemProgram.programId) => ({
  lamports,
  owner: owner.toBase58(),
  data: ["", "base64"],
});

function compile(payer: PublicKey, instructions: TransactionInstruction[]): VersionedTransaction {
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: PublicKey.default.toBase58(),
    instructions,
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

/**
 * A transaction that only calls a program a swap is allowed to call, naming
 * the extra signers and the touched accounts on it so they are part of the
 * message without bringing another program in.
 */
function transactionSignedBy(
  signers: PublicKey[],
  touching: PublicKey[] = [],
): VersionedTransaction {
  return compile(signers[0], [
    new TransactionInstruction({
      programId: ComputeBudgetProgram.programId,
      keys: [
        ...signers.slice(1).map((pubkey) => ({ pubkey, isSigner: true, isWritable: true })),
        ...touching.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })),
      ],
      data: Buffer.from([2, 0, 0, 0, 0]),
    }),
  ]);
}

type Chain = {
  /** Input and output token amounts before and after. A null `before` is an account that does not exist yet. */
  before: [bigint, bigint | null];
  after: [bigint, bigint];
  lamports?: [number, number];
  walletOwnerAfter?: PublicKey;
  /** The other owned account's data before and after, when the transaction touches it. */
  other?: [Buffer, Buffer];
  mint?: ReturnType<typeof mintAccount> | null;
  err?: unknown;
};

function mockChain(chain: Chain) {
  const [lamportsBefore, lamportsAfter] = chain.lamports ?? [10_000_000, 9_995_000];
  vi.spyOn(connection, "getTokenAccountsByOwner").mockImplementation((async (
    _owner: PublicKey,
    filter: { programId: PublicKey },
  ) => ({
    value:
      filter.programId.toBase58() === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        ? [{ pubkey: INPUT_ATA }, { pubkey: OUTPUT_ATA }, { pubkey: OTHER_ATA }]
        : [],
  })) as never);
  vi.spyOn(connection, "getMultipleAccountsInfo").mockResolvedValue([
    { data: tokenData(chain.before[0]) },
    chain.before[1] === null ? null : { data: tokenData(chain.before[1]) },
    wallet(lamportsBefore),
    ...(chain.other ? [{ data: chain.other[0] }] : []),
    chain.mint === undefined ? mintAccount() : chain.mint,
  ] as never);
  return vi.spyOn(connection, "simulateTransaction").mockResolvedValue({
    context: { slot: 1 },
    value: {
      err: chain.err ?? null,
      logs: [],
      accounts: [
        simulatedToken(tokenData(chain.after[0])),
        simulatedToken(tokenData(chain.after[1])),
        simulatedWallet(lamportsAfter, chain.walletOwnerAfter),
        ...(chain.other ? [simulatedToken(chain.other[1])] : []),
      ],
      unitsConsumed: 0,
    },
  } as never);
}

/** Fee, a new token account's rent and headroom, as the trade path budgets them. */
const BUDGET = 5_000_000n;

const verify = (
  acquiring = true,
  transaction = transactionSignedBy([TAKER.publicKey]),
  maxLamportsSpent = BUDGET,
) =>
  verifySwapBeforeSigning(
    transaction,
    QUOTE,
    TAKER.publicKey,
    INPUT_ATA,
    OUTPUT_ATA,
    { mint: MINT, acquiring },
    maxLamportsSpent,
  );

afterEach(() => vi.restoreAllMocks());

describe("verifySwapBeforeSigning", () => {
  it("accepts a swap that delivers exactly what it committed to", async () => {
    mockChain({ before: [1_000_000n, 0n], after: [0n, 495_000n] });
    expect((await verify()).ok).toBe(true);
  });

  it("accepts a swap that delivers more than its floor", async () => {
    mockChain({ before: [1_000_000n, 0n], after: [0n, 510_000n] });
    expect(await verify()).toMatchObject({ ok: true, expectedOut: 510_000n });
  });

  it("refuses a swap that would deliver one base unit less than its floor", async () => {
    // The exact boundary: a venue that quotes a minimum and then honours it
    // by a hair less is the failure this whole check exists to catch.
    mockChain({ before: [1_000_000n, 0n], after: [0n, 494_999n] });
    expect(await verify()).toMatchObject({
      ok: false,
      reason: expect.stringContaining("less than quoted"),
    });
  });

  it("refuses a swap that spends more input than it quoted, even if the output is right", async () => {
    // Output alone is not enough: a transaction can deliver the promised
    // amount while quietly taking far more than it said it would.
    mockChain({ before: [5_000_000n, 0n], after: [1_000_000n, 500_000n] });
    expect(await verify()).toMatchObject({
      ok: false,
      reason: expect.stringContaining("more than quoted"),
    });
  });

  it("refuses a swap that fails in simulation rather than letting it fail on chain", async () => {
    mockChain({
      before: [1_000_000n, 0n],
      after: [0n, 0n],
      err: { InstructionError: [0, "Custom"] },
    });
    expect(await verify()).toMatchObject({
      ok: false,
      reason: expect.stringContaining("would fail on chain"),
    });
  });

  it("refuses when the simulation returns no account state to check", async () => {
    mockChain({ before: [1_000_000n, 0n], after: [0n, 500_000n] });
    vi.spyOn(connection, "simulateTransaction").mockResolvedValue({
      context: { slot: 1 },
      value: { err: null, logs: [], accounts: null, unitsConsumed: 0 },
    } as never);
    expect(await verify()).toMatchObject({
      ok: false,
      reason: expect.stringContaining("could not be checked"),
    });
  });

  it("counts a token account that did not exist before the swap as starting from zero", async () => {
    mockChain({ before: [1_000_000n, null], after: [0n, 500_000n] });
    expect(await verify()).toMatchObject({ ok: true, expectedOut: 500_000n });
  });

  it("refuses when the balances before the swap cannot be read", async () => {
    // Read as zero, whatever the account already held would count as
    // delivered by this swap and a short delivery would pass.
    const simulate = mockChain({ before: [1_000_000n, 0n], after: [0n, 500_000n] });
    vi.spyOn(connection, "getMultipleAccountsInfo").mockRejectedValue(new Error("rpc down"));
    expect(await verify()).toMatchObject({
      ok: false,
      reason: expect.stringContaining("could not be checked"),
    });
    expect(simulate).not.toHaveBeenCalled();
  });

  it("refuses when the taker's own token accounts cannot be listed", async () => {
    const simulate = mockChain({ before: [1_000_000n, 0n], after: [0n, 500_000n] });
    vi.spyOn(connection, "getTokenAccountsByOwner").mockRejectedValue(new Error("rpc down"));
    expect((await verify()).ok).toBe(false);
    expect(simulate).not.toHaveBeenCalled();
  });
});

describe("what a swap may do to the rest of the account", () => {
  const settled = { before: [1_000_000n, 0n], after: [0n, 500_000n] } satisfies Chain;
  const touchingOther = () => transactionSignedBy([TAKER.publicKey], [OTHER_ATA]);

  it("watches the taker's SOL and every other token account the transaction can touch", async () => {
    const simulate = mockChain({ ...settled, other: [tokenData(7n), tokenData(7n)] });

    expect((await verify(true, touchingOther())).ok).toBe(true);
    expect(connection.getMultipleAccountsInfo).toHaveBeenCalledWith([
      INPUT_ATA,
      OUTPUT_ATA,
      TAKER.publicKey,
      OTHER_ATA,
      MINT,
    ]);
    expect(simulate.mock.calls[0][1]).toMatchObject({
      accounts: {
        addresses: [INPUT_ATA, OUTPUT_ATA, TAKER.publicKey, OTHER_ATA].map((key) => key.toBase58()),
      },
    });
  });

  it("does not watch an owned token account the transaction cannot reach", async () => {
    mockChain(settled);
    expect((await verify()).ok).toBe(true);
    expect(connection.getMultipleAccountsInfo).toHaveBeenCalledWith([
      INPUT_ATA,
      OUTPUT_ATA,
      TAKER.publicKey,
      MINT,
    ]);
  });

  it("refuses a swap that settles the quote exactly and also drains another holding", async () => {
    mockChain({ ...settled, other: [tokenData(7n), tokenData(6n)] });
    expect(await verify(true, touchingOther())).toMatchObject({
      ok: false,
      reason: expect.stringContaining("another asset"),
    });
  });

  it("refuses a swap that puts a delegate on another holding without moving it", async () => {
    mockChain({ ...settled, other: [tokenData(7n), tokenData(7n, true)] });
    expect(await verify(true, touchingOther())).toMatchObject({
      ok: false,
      reason: expect.stringContaining("control"),
    });
  });

  it("lets a swap spend what its fee and rent were budgeted at, and not a lamport more", async () => {
    mockChain({ ...settled, lamports: [50_000_000, 45_000_000] });
    expect((await verify()).ok).toBe(true);

    vi.restoreAllMocks();
    mockChain({ ...settled, lamports: [50_000_000, 44_999_999] });
    expect(await verify()).toMatchObject({
      ok: false,
      reason: expect.stringContaining("more SOL"),
    });
  });

  it("lets an order the venue pays for take no SOL at all", async () => {
    mockChain({ ...settled, lamports: [50_000_000, 50_000_000] });
    expect((await verify(true, undefined, 0n)).ok).toBe(true);

    vi.restoreAllMocks();
    mockChain({ ...settled, lamports: [50_000_000, 49_995_000] });
    expect((await verify(true, undefined, 0n)).ok).toBe(false);
  });

  it("refuses when an account that has to exist comes back missing", async () => {
    const simulate = mockChain(settled);
    vi.spyOn(connection, "getMultipleAccountsInfo").mockResolvedValue([
      null,
      null,
      wallet(10_000_000),
      mintAccount(),
    ] as never);
    expect(await verify()).toMatchObject({
      ok: false,
      reason: expect.stringContaining("could not be checked"),
    });
    expect(simulate).not.toHaveBeenCalled();
  });

  it("refuses a sell when the stock's mint cannot be read, since the pause cannot be ruled out", async () => {
    mockChain({ ...settled, mint: null });
    expect(await verify(false)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("could not be checked"),
    });
  });

  it("refuses a swap that closes another, empty holding, whose rent would go elsewhere", async () => {
    mockChain({ ...settled, other: [tokenData(0n), Buffer.alloc(0)] });
    expect(await verify(true, touchingOther())).toMatchObject({
      ok: false,
      reason: expect.stringContaining("close another"),
    });
  });

  it("lets a swap close the account it spends from only when the rent comes back", async () => {
    const closing = (lamports: [number, number]) => {
      mockChain({ ...settled, lamports });
      vi.spyOn(connection, "getMultipleAccountsInfo").mockResolvedValue([
        { data: tokenData(1_000_000n), lamports: 2_000_000 },
        { data: tokenData(0n) },
        wallet(lamports[0]),
        mintAccount(),
      ] as never);
      vi.spyOn(connection, "simulateTransaction").mockResolvedValue({
        context: { slot: 1 },
        value: {
          err: null,
          logs: [],
          accounts: [null, simulatedToken(tokenData(500_000n)), simulatedWallet(lamports[1])],
          unitsConsumed: 0,
        },
      } as never);
    };

    closing([10_000_000, 11_995_000]);
    expect((await verify(false, undefined, 5_000n)).ok).toBe(true);

    vi.restoreAllMocks();
    closing([10_000_000, 9_995_000]);
    expect(await verify(false, undefined, 5_000n)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("keep its rent"),
    });
  });

  it("refuses a swap that reassigns the wallet itself to a program", async () => {
    mockChain({ ...settled, walletOwnerAfter: Keypair.generate().publicKey });
    expect(await verify()).toMatchObject({
      ok: false,
      reason: expect.stringContaining("hand your wallet"),
    });
  });
});

describe("what a swap transaction may be made of", () => {
  const settled = { before: [1_000_000n, 0n], after: [0n, 500_000n] } satisfies Chain;

  it("refuses a program the venue has no reason to call, even when every balance comes out right", async () => {
    // The simulated balances are exactly what the quote promised. What the
    // unknown program does to accounts nobody is watching is not in them.
    const simulate = mockChain(settled);
    const transaction = compile(TAKER.publicKey, [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
      new TransactionInstruction({
        programId: Keypair.generate().publicKey,
        keys: [{ pubkey: TAKER.publicKey, isSigner: true, isWritable: true }],
        data: Buffer.from([1]),
      }),
    ]);

    expect(await verify(true, transaction)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("no reason to"),
    });
    expect(simulate).not.toHaveBeenCalled();
    expect((await checkSwapPrograms(transaction, TAKER.publicKey, INPUT_ATA)).ok).toBe(false);
  });

  it("lets through the documented OKX router, with every balance check still applied", async () => {
    const okx = compile(TAKER.publicKey, [
      new TransactionInstruction({
        programId: new PublicKey("proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u"),
        keys: [{ pubkey: TAKER.publicKey, isSigner: true, isWritable: true }],
        data: Buffer.from([1]),
      }),
    ]);
    expect(await checkSwapPrograms(okx, TAKER.publicKey, INPUT_ATA)).toEqual({ ok: true });
    mockChain(settled);
    expect((await verify(true, okx)).ok).toBe(true);
    mockChain({ before: [1_000_000n, 0n], after: [0n, 494_999n] });
    expect((await verify(true, okx)).ok).toBe(false);
    // The router OKX's own repository still names was closed on chain, and is not listed.
    const retired = compile(TAKER.publicKey, [
      new TransactionInstruction({
        programId: new PublicKey("6m2CDdhRgxpH4WjvdzxAYbGxwdGUz5MziiL5jek2kBma"),
        keys: [],
        data: Buffer.from([1]),
      }),
    ]);
    expect((await checkSwapPrograms(retired, TAKER.publicKey, INPUT_ATA)).ok).toBe(false);
  });

  it("refuses a top-level token transfer when no fee is configured, whatever it claims to pay", async () => {
    const simulate = mockChain(settled);
    const transaction = compile(TAKER.publicKey, [
      createTransferCheckedInstruction(
        INPUT_ATA,
        QUOTE.inputMint,
        Keypair.generate().publicKey,
        TAKER.publicKey,
        1n,
        6,
      ),
    ]);
    expect(await verify(true, transaction)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("transfer tokens"),
    });
    expect(simulate).not.toHaveBeenCalled();
    expect(
      (
        await checkSwapPrograms(transaction, TAKER.publicKey, INPUT_ATA, {
          quote: QUOTE,
          outputAta: OUTPUT_ATA,
        })
      ).ok,
    ).toBe(false);
  });

  it("refuses a direct System transfer out of the wallet", async () => {
    mockChain(settled);
    const transaction = compile(TAKER.publicKey, [
      SystemProgram.transfer({
        fromPubkey: TAKER.publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1,
      }),
    ]);
    expect((await verify(true, transaction)).ok).toBe(false);
  });

  describe("closing an account", () => {
    const wrappedSol = getAssociatedTokenAddressSync(NATIVE_MINT, TAKER.publicKey);
    const close = (account: PublicKey, destination: PublicKey, authority = TAKER.publicKey) =>
      compile(TAKER.publicKey, [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        createCloseAccountInstruction(account, destination, authority),
      ]);

    it("passes what a genuine order does: the taker's wrapped-SOL account, closed back to the taker", async () => {
      mockChain(settled);
      expect((await verify(false, close(wrappedSol, TAKER.publicKey))).ok).toBe(true);
    });

    it("passes the input account closed back to the taker", async () => {
      const transaction = close(INPUT_ATA, TAKER.publicKey);
      expect(await checkSwapPrograms(transaction, TAKER.publicKey, INPUT_ATA)).toEqual({
        ok: true,
      });
    });

    it("refuses a close that pays the lamports to someone else, whatever the balances say", async () => {
      // The simulated balances are a clean, fully settled swap. An account
      // opened and closed inside the transaction is in none of them.
      const simulate = mockChain(settled);
      const stolen = close(wrappedSol, Keypair.generate().publicKey);
      expect(await verify(false, stolen)).toMatchObject({
        ok: false,
        reason: expect.stringContaining("close an account"),
      });
      expect(simulate).not.toHaveBeenCalled();
    });

    it("refuses a close of any other account the taker owns", async () => {
      const simulate = mockChain(settled);
      for (const account of [OTHER_ATA, OUTPUT_ATA]) {
        expect((await verify(false, close(account, TAKER.publicKey))).ok).toBe(false);
      }
      expect(simulate).not.toHaveBeenCalled();
    });

    it("refuses a close on someone else's authority, or with extra signers attached", async () => {
      mockChain(settled);
      const stranger = Keypair.generate().publicKey;
      expect((await verify(false, close(wrappedSol, TAKER.publicKey, stranger))).ok).toBe(false);
      const multisig = compile(TAKER.publicKey, [
        createCloseAccountInstruction(wrappedSol, TAKER.publicKey, TAKER.publicKey, [stranger]),
      ]);
      expect((await verify(false, multisig)).ok).toBe(false);
    });
  });

  it("refuses a swap on a durable nonce, which could be held and landed later", async () => {
    const simulate = mockChain(settled);
    const transaction = compile(TAKER.publicKey, [
      SystemProgram.nonceAdvance({
        noncePubkey: Keypair.generate().publicKey,
        authorizedPubkey: Keypair.generate().publicKey,
      }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
    ]);

    expect(await verify(true, transaction)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("indefinitely"),
    });
    expect(simulate).not.toHaveBeenCalled();
  });

  it("refuses a swap whose output lands in a new account somebody else owns", async () => {
    // The amount arrives in full at the watched address. It is just not the
    // taker's account: it was created with another owner.
    mockChain({ before: [1_000_000n, null], after: [0n, 500_000n] });
    const stolen = tokenData(500_000n, false, Keypair.generate().publicKey);
    vi.spyOn(connection, "simulateTransaction").mockResolvedValue({
      context: { slot: 1 },
      value: {
        err: null,
        logs: [],
        accounts: [
          simulatedToken(tokenData(0n)),
          simulatedToken(stolen),
          simulatedWallet(9_995_000),
        ],
        unitsConsumed: 0,
      },
    } as never);

    expect(await verify()).toMatchObject({
      ok: false,
      reason: expect.stringContaining("do not own"),
    });
  });
});

describe("the stock's mint, read with the balances", () => {
  const settled = { before: [1_000_000n, null], after: [0n, 500_000n] } satisfies Chain;

  it("refuses to buy a token the issuer has changed since it was listed", async () => {
    for (const changed of [
      mintAccount({ paused: true }),
      mintAccount({ defaultState: 2 }),
      mintAccount({ hookProgram: Keypair.generate().publicKey }),
      mintAccount({ extra: [ExtensionType.TransferFeeConfig] }),
      null,
    ]) {
      const simulate = mockChain({ ...settled, mint: changed });
      expect(await verify()).toMatchObject({
        ok: false,
        reason: expect.stringContaining("Not signed"),
      });
      expect(simulate).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    }
  });

  it("lets a changed token be sold, since only a buy is held to the listing profile", async () => {
    mockChain({ ...settled, mint: mintAccount({ hookProgram: Keypair.generate().publicKey }) });
    expect((await verify(false)).ok).toBe(true);
  });

  it("signs nothing in the minutes around a new multiplier taking effect, buying or selling", async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const acquiring of [true, false]) {
      for (const [scheduledAt, paused] of [
        [now + 120, true],
        [now - 120, true],
        [now + 3_600, false],
        [now - 3_600, false],
      ] as const) {
        mockChain({ ...settled, mint: mintAccount({ multiplier: [1, scheduledAt, 1.01] }) });
        expect((await verify(acquiring)).ok, `${acquiring} ${scheduledAt - now}`).toBe(!paused);
        vi.restoreAllMocks();
      }
    }
  });
});

describe("verifySigners", () => {
  it("accepts a transaction only the taker has to sign", () => {
    expect(verifySigners(transactionSignedBy([TAKER.publicKey]), TAKER.publicKey).ok).toBe(true);
  });

  it("accepts a real RFQ shape: three required signers, none of them filled in yet", () => {
    // Verified against the live API, not assumed. A Jupiter RFQ swap requires
    // the market maker, a gas-station account, and the taker - and at quote
    // time none have signed, because Jupiter collects the other two itself at
    // /execute. Anything stricter than "the taker is a party to this" rejects
    // every real stock trade, which two earlier versions of this check did.
    const maker = Keypair.generate().publicKey;
    const gasStation = Keypair.generate().publicKey;
    const transaction = transactionSignedBy([maker, gasStation, TAKER.publicKey]);

    expect(verifySigners(transaction, TAKER.publicKey).ok).toBe(true);
  });

  it("refuses a transaction the taker is not a party to at all", () => {
    const stranger = Keypair.generate().publicKey;
    const other = Keypair.generate().publicKey;
    const result = verifySigners(transactionSignedBy([stranger, other]), TAKER.publicKey);

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringContaining("does not involve") });
  });
});
