import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { connection } from "../../src/infrastructure/solana/client.js";
import { usdcMint } from "../../src/infrastructure/solana/config.js";
import { prepareEarn } from "../../src/infrastructure/solana/earn/jupiterLend.js";
import {
  COMPUTE_BUDGET_RULE,
  verifyBalancesBeforeSigning,
} from "../../src/infrastructure/solana/presign-guard.js";

const LEND_PROGRAM = new PublicKey("jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9");
const RECEIPT_MINT = new PublicKey("9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D");
const LENDING_ACCOUNT = new PublicKey("2vVYHYM8VYnvZqQWpTJSj8o8DBf1wM8pVs3bsTgYZiqJ");
const ONE_SHARE_PRICE = 1_000_000_000_000n;
const ATA_RENT = 2_039_280;

function tokenData(owner: PublicKey, amount: bigint): Buffer {
  const data = Buffer.alloc(165);
  owner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  return data;
}

const simulatedToken = (data: Buffer) => ({ data: [data.toString("base64"), "base64"] });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("audit: an Earn transaction built by the lending API", () => {
  const owner = Keypair.generate().publicKey;
  const attacker = Keypair.generate().publicKey;
  const cash = getAssociatedTokenAddressSync(new PublicKey(usdcMint()), owner, true);
  const receipt = getAssociatedTokenAddressSync(RECEIPT_MINT, owner, true);

  /**
   * The API answers a 10 USDC deposit with the real deposit plus two token
   * accounts opened for a stranger, funded by the depositor. The stranger
   * owns those accounts and can close them to collect the rent.
   */
  const hostileLendApi = () => lendApi(2);

  /** The API's deposit, preceded by `strangers` token accounts opened for a stranger at the depositor's expense. */
  function lendApi(strangers: number) {
    const strangerMints = Array.from({ length: strangers }, () => Keypair.generate().publicKey);
    const built = new VersionedTransaction(
      new TransactionMessage({
        payerKey: owner,
        recentBlockhash: Keypair.generate().publicKey.toBase58(),
        instructions: [
          ...strangerMints.map((mint) =>
            createAssociatedTokenAccountIdempotentInstruction(
              owner,
              getAssociatedTokenAddressSync(mint, attacker, true),
              attacker,
              mint,
            ),
          ),
          new TransactionInstruction({
            programId: LEND_PROGRAM,
            keys: [owner, cash, receipt].map((pubkey, index) => ({
              pubkey,
              isSigner: index === 0,
              isWritable: true,
            })),
            data: Buffer.alloc(16),
          }),
        ],
      }).compileToV0Message(),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ transaction: Buffer.from(built.serialize()).toString("base64") }),
      ),
    );
  }

  /** The chain around a deposit that spends `lamportsSpent`. Of the owner's token accounts, only `existing` are there before it. */
  function chainAfterDeposit(lamportsSpent: number, existing: PublicKey[] = []) {
    const lending = Buffer.alloc(196);
    new PublicKey(usdcMint()).toBuffer().copy(lending, 8);
    RECEIPT_MINT.toBuffer().copy(lending, 40);
    lending.writeBigUInt64LE(ONE_SHARE_PRICE, 115);
    vi.spyOn(connection, "getAccountInfo").mockImplementation((async (key: PublicKey) => {
      if (key.equals(LENDING_ACCOUNT)) return { owner: LEND_PROGRAM, data: lending };
      return existing.some((account) => account.equals(key))
        ? { data: tokenData(owner, 0n) }
        : null;
    }) as never);
    vi.spyOn(connection, "getTokenAccountsByOwner").mockImplementation((async (
      _owner: PublicKey,
      filter: { programId: PublicKey },
    ) => ({
      value:
        filter.programId.toBase58() === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
          ? [{ pubkey: cash }, { pubkey: receipt }]
          : [],
    })) as never);
    vi.spyOn(connection, "getMultipleAccountsInfo").mockResolvedValue([
      { lamports: 10_000_000, data: Buffer.alloc(0) },
      { data: tokenData(owner, 50_000_000n) },
      { data: tokenData(owner, 0n) },
    ] as never);
    vi.spyOn(connection, "simulateTransaction").mockResolvedValue({
      context: { slot: 1 },
      value: {
        err: null,
        logs: [],
        accounts: [
          {
            lamports: 10_000_000 - lamportsSpent,
            owner: SystemProgram.programId.toBase58(),
            data: ["", "base64"],
          },
          simulatedToken(tokenData(owner, 40_000_000n)),
          simulatedToken(tokenData(owner, 10_000_000n)),
        ],
        unitsConsumed: 0,
      },
    } as never);
  }

  it("refuses a deposit that also pays rent into token accounts a stranger owns", async () => {
    hostileLendApi();
    // Two stranger accounts' rent plus the network fee: inside the fixed
    // 5,000,000 lamport ceiling every Earn transaction is held to, although
    // the depositor's own receipt account already exists and needs none.
    chainAfterDeposit(2 * ATA_RENT + 5_000);

    const { transaction, limits } = await prepareEarn("deposit", owner, 10);
    const verdict = await verifyBalancesBeforeSigning(transaction, owner, limits);

    expect(verdict.ok).toBe(false);
  });

  it("passes a first deposit that opens only the depositor's own receipt account", async () => {
    lendApi(0);
    chainAfterDeposit(ATA_RENT + 5_000);
    const { transaction, limits } = await prepareEarn("deposit", owner, 10);
    expect(await verifyBalancesBeforeSigning(transaction, owner, limits)).toEqual({ ok: true });
  });

  it("holds a deposit into a receipt account that already exists to the network fee", async () => {
    lendApi(0);
    chainAfterDeposit(5_000, [receipt]);
    const paid = await prepareEarn("deposit", owner, 10);
    expect(await verifyBalancesBeforeSigning(paid.transaction, owner, paid.limits)).toEqual({
      ok: true,
    });

    // The rent of one more account: nothing this deposit needs.
    chainAfterDeposit(ATA_RENT + 5_000, [receipt]);
    const overspent = await prepareEarn("deposit", owner, 10);
    expect(
      await verifyBalancesBeforeSigning(overspent.transaction, owner, overspent.limits),
    ).toMatchObject({ ok: false, reason: expect.stringContaining("more SOL") });
  });

  it("allows a withdrawal the rent of a USDC account only when it has none", async () => {
    lendApi(0);
    chainAfterDeposit(0);
    expect((await prepareEarn("withdraw", owner, 10)).limits.maxLamportsSpent).toBe(
      50_000n + BigInt(ATA_RENT),
    );
    chainAfterDeposit(0, [cash]);
    expect((await prepareEarn("withdraw", owner, 10)).limits.maxLamportsSpent).toBe(50_000n);
  });
});

describe("audit: an account the transaction creates for what is owed back", () => {
  const sender = Keypair.generate().publicKey;
  const stranger = Keypair.generate().publicKey;
  const cash = Keypair.generate().publicKey;
  const receipt = Keypair.generate().publicKey;
  const trusted = Keypair.generate().publicKey;

  /** The receive account is created by the transaction and comes out owned by `ownerAfter`, holding enough. */
  function receiptCreatedFor(ownerAfter: PublicKey, receiveOwner?: PublicKey) {
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: sender,
        recentBlockhash: Keypair.generate().publicKey.toBase58(),
        instructions: [
          new TransactionInstruction({
            programId: trusted,
            keys: [cash, receipt].map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })),
            data: Buffer.from([1]),
          }),
        ],
      }).compileToV0Message(),
    );
    vi.spyOn(connection, "getTokenAccountsByOwner").mockImplementation((async (
      _owner: PublicKey,
      filter: { programId: PublicKey },
    ) => ({
      value:
        filter.programId.toBase58() === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
          ? [{ pubkey: cash }]
          : [],
    })) as never);
    vi.spyOn(connection, "getMultipleAccountsInfo").mockResolvedValue([
      { lamports: 10_000_000, data: Buffer.alloc(0) },
      { data: tokenData(sender, 50_000_000n) },
      null,
    ] as never);
    vi.spyOn(connection, "simulateTransaction").mockResolvedValue({
      context: { slot: 1 },
      value: {
        err: null,
        logs: [],
        accounts: [
          { lamports: 9_995_000, owner: SystemProgram.programId.toBase58(), data: ["", "base64"] },
          simulatedToken(tokenData(sender, 40_000_000n)),
          simulatedToken(tokenData(ownerAfter, 10_000_000n)),
        ],
        unitsConsumed: 0,
      },
    } as never);

    return verifyBalancesBeforeSigning(transaction, sender, {
      cashAccount: cash,
      maxCashSpent: 10_000_000n,
      maxLamportsSpent: 5_000n,
      receive: {
        account: receipt,
        minAmount: 9_950_000n,
        ...(receiveOwner ? { owner: receiveOwner } : {}),
      },
      programs: [COMPUTE_BUDGET_RULE, { programId: trusted }],
    });
  }

  it("refuses when the receipt arrives in an account the sender does not own", async () => {
    // The swap guard holds every account still standing to the taker
    // (guard.ts, "tokens delivered to an account someone else owns were not
    // delivered"). The general guard compares amounts at the address only.
    const verdict = await receiptCreatedFor(stranger);

    expect(verdict.ok).toBe(false);
  });

  it("holds what is received to the owner the action names, when that is not the sender", async () => {
    // A send's recipient: their account, and no one else's, must gain it.
    expect(await receiptCreatedFor(stranger, stranger)).toEqual({ ok: true });
    expect((await receiptCreatedFor(sender, stranger)).ok).toBe(false);
  });
});
