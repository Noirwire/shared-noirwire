import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ComputeBudgetProgram,
  Keypair,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
} from "@solana/spl-token";
import { connection } from "../../src/infrastructure/solana/client.js";
import {
  checkBalanceChanges,
  checkPrograms,
  COMPUTE_BUDGET_RULE,
  CREATE_ATA_RULE,
  verifyBalancesBeforeSigning,
  type BalanceSnapshot,
} from "../../src/infrastructure/solana/presign-guard.js";
import { tokenControlChanged } from "../../src/infrastructure/solana/swap/guard.js";

const CASH = Keypair.generate().publicKey;
const STOCK = Keypair.generate().publicKey;
const TRUSTED_PROGRAM = Keypair.generate().publicKey;

const LIMITS = {
  cashAccount: CASH,
  maxCashSpent: 10_010_000n,
  maxLamportsSpent: 2_500_000n,
  programs: [],
};

function snapshot(lamports: bigint, cash: bigint, stock: bigint): BalanceSnapshot {
  return {
    lamports,
    tokens: new Map([
      [CASH.toBase58(), cash],
      [STOCK.toBase58(), stock],
    ]),
  };
}

const BEFORE = snapshot(10_000_000n, 50_000_000n, 3_00000000n);

describe("checkBalanceChanges", () => {
  it("accepts the amount plus its fee and the budgeted rent", () => {
    const after = snapshot(10_000_000n - 2_044_280n, 50_000_000n - 10_010_000n, 3_00000000n);
    expect(checkBalanceChanges(BEFORE, after, LIMITS)).toEqual({ ok: true });
  });

  it("refuses a transfer that takes more cash than asked", () => {
    const after = snapshot(10_000_000n, 50_000_000n - 10_010_001n, 3_00000000n);
    expect(checkBalanceChanges(BEFORE, after, LIMITS).ok).toBe(false);
  });

  it("refuses a transfer that spends more SOL than budgeted", () => {
    const after = snapshot(10_000_000n - 2_500_001n, 50_000_000n - 10_000_000n, 3_00000000n);
    expect(checkBalanceChanges(BEFORE, after, LIMITS).ok).toBe(false);
  });

  it("refuses a transfer that also moves any other asset", () => {
    const after = snapshot(10_000_000n, 50_000_000n - 10_000_000n, 3_00000000n - 1n);
    expect(checkBalanceChanges(BEFORE, after, LIMITS).ok).toBe(false);
  });

  it("treats a closed token account as fully drained", () => {
    const after: BalanceSnapshot = {
      lamports: 10_000_000n,
      tokens: new Map([[CASH.toBase58(), 40_000_000n]]),
    };
    expect(checkBalanceChanges(BEFORE, after, LIMITS).ok).toBe(false);
  });
});

describe("tokenControlChanged", () => {
  const account = () => Buffer.alloc(165);
  const withDelegate = (data: Buffer) => {
    const copy = Buffer.from(data);
    copy.writeUInt32LE(1, 72);
    Keypair.generate().publicKey.toBuffer().copy(copy, 76);
    return copy;
  };

  it("passes an account whose owner, delegate and close authority are untouched", () => {
    const before = account();
    const after = Buffer.from(before);
    after.writeBigUInt64LE(5n, 64);
    expect(tokenControlChanged(before, after)).toBe(false);
  });

  it("catches a delegate approved on an existing account", () => {
    const before = account();
    expect(tokenControlChanged(before, withDelegate(before))).toBe(true);
  });

  it("catches an owner change", () => {
    const before = account();
    const after = Buffer.from(before);
    Keypair.generate().publicKey.toBuffer().copy(after, 32);
    expect(tokenControlChanged(before, after)).toBe(true);
  });

  it("catches a delegate on an account the transaction creates", () => {
    expect(tokenControlChanged(undefined, withDelegate(account()))).toBe(true);
    expect(tokenControlChanged(undefined, account())).toBe(false);
  });

  it("leaves a closed account to the balance check", () => {
    expect(tokenControlChanged(account(), undefined)).toBe(false);
  });
});

describe("checkPrograms", () => {
  const payer = Keypair.generate().publicKey;
  const source = Keypair.generate().publicKey;
  const attacker = Keypair.generate().publicKey;
  const RULES = [COMPUTE_BUDGET_RULE, CREATE_ATA_RULE, { programId: TRUSTED_PROGRAM }];

  function compile(instructions: TransactionInstruction[]) {
    const message = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions,
    }).compileToV0Message();
    const transaction = new VersionedTransaction(message);
    return { transaction, keys: message.getAccountKeys() };
  }

  it("allows the trusted program, compute budget and ATA creation", () => {
    const { transaction, keys } = compile([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
      createAssociatedTokenAccountIdempotentInstruction(payer, source, payer, CASH),
      new TransactionInstruction({ programId: TRUSTED_PROGRAM, keys: [], data: Buffer.from([25]) }),
    ]);
    expect(checkPrograms(transaction, keys, RULES)).toEqual({ ok: true });
  });

  it("refuses a direct token transfer, even one that debits exactly the requested amount", () => {
    const { transaction, keys } = compile([
      createTransferInstruction(source, attacker, payer, 10_000_000n),
    ]);
    expect(checkPrograms(transaction, keys, RULES).ok).toBe(false);
  });

  it("refuses a durable-nonce transaction even when the System program is allowed", () => {
    const { transaction, keys } = compile([
      SystemProgram.nonceAdvance({ noncePubkey: source, authorizedPubkey: payer }),
      new TransactionInstruction({ programId: TRUSTED_PROGRAM, keys: [], data: Buffer.from([25]) }),
    ]);
    const rules = [...RULES, { programId: SystemProgram.programId }];
    expect(checkPrograms(transaction, keys, rules)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("indefinitely"),
    });
  });

  it("refuses an ATA-program instruction other than create", () => {
    const { transaction, keys } = compile([
      new TransactionInstruction({
        programId: ASSOCIATED_TOKEN_PROGRAM_ID,
        keys: [],
        data: Buffer.from([2]),
      }),
    ]);
    expect(checkPrograms(transaction, keys, RULES).ok).toBe(false);
  });
});

describe("tokenControlChanged on allowance", () => {
  it("catches a raised allowance for the same delegate", () => {
    const before = Buffer.alloc(165);
    before.writeUInt32LE(1, 72);
    before.writeBigUInt64LE(1n, 121);
    const after = Buffer.from(before);
    after.writeBigUInt64LE(10_000_000_000n, 121);
    expect(tokenControlChanged(before, after)).toBe(true);
  });
});

describe("verifyBalancesBeforeSigning", () => {
  const sender = Keypair.generate().publicKey;
  const recipient = Keypair.generate().publicKey;
  const cash = Keypair.generate().publicKey;
  /** Another token account of the sender's, empty, which the transaction names. */
  const idle = Keypair.generate().publicKey;

  const limits = {
    cashAccount: cash,
    maxCashSpent: 10_000_000n,
    maxLamportsSpent: 2_500_000n,
    programs: [COMPUTE_BUDGET_RULE, { programId: TRUSTED_PROGRAM }],
  };

  function tokenData(amount: bigint): Buffer {
    const data = Buffer.alloc(165);
    sender.toBuffer().copy(data, 32);
    data.writeBigUInt64LE(amount, 64);
    return data;
  }
  const simulated = (data: Buffer) => ({ data: [data.toString("base64"), "base64"] });

  function transfer(): VersionedTransaction {
    const message = new TransactionMessage({
      payerKey: sender,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [
        new TransactionInstruction({
          programId: TRUSTED_PROGRAM,
          keys: [cash, idle, recipient].map((pubkey) => ({
            pubkey,
            isSigner: false,
            isWritable: true,
          })),
          data: Buffer.from([7]),
        }),
      ],
    }).compileToV0Message();
    return new VersionedTransaction(message);
  }

  function mockChain(idleAfter: Buffer | null) {
    vi.spyOn(connection, "getTokenAccountsByOwner").mockImplementation((async (
      _owner: unknown,
      filter: { programId: { toBase58(): string } },
    ) => ({
      value:
        filter.programId.toBase58() === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
          ? [{ pubkey: cash }, { pubkey: idle }]
          : [],
    })) as never);
    vi.spyOn(connection, "getMultipleAccountsInfo").mockResolvedValue([
      { lamports: 10_000_000, data: Buffer.alloc(0) },
      { data: tokenData(50_000_000n) },
      { data: tokenData(0n) },
    ] as never);
    return vi.spyOn(connection, "simulateTransaction").mockResolvedValue({
      context: { slot: 1 },
      value: {
        err: null,
        logs: [],
        accounts: [
          { lamports: 9_995_000, owner: SystemProgram.programId.toBase58(), data: ["", "base64"] },
          simulated(tokenData(40_000_000n)),
          idleAfter && simulated(idleAfter),
        ],
        unitsConsumed: 0,
      },
    } as never);
  }

  afterEach(() => vi.restoreAllMocks());

  it("accepts a transfer that leaves the sender's other accounts standing", async () => {
    mockChain(tokenData(0n));
    expect(await verifyBalancesBeforeSigning(transfer(), sender, limits)).toEqual({ ok: true });
  });

  it("refuses a transfer that closes an empty token account, which no balance check would notice", async () => {
    mockChain(null);
    expect(await verifyBalancesBeforeSigning(transfer(), sender, limits)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("close one of your token accounts"),
    });
  });
});
