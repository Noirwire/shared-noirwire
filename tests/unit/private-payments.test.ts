import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createApproveInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { connection } from "../../src/infrastructure/solana/client.js";
import { checkPrograms } from "../../src/infrastructure/solana/presign-guard.js";
import {
  checkCreatedAccounts,
  checkKeepsOut,
  checkQueuedAmount,
  checkRelayFee,
  submitTransfer,
  PRIVATE_PAYMENT_PROGRAMS,
} from "../../src/infrastructure/solana/private-payments.js";
import { privacyFeeFor, RELAY_FEE_RAW } from "../../src/domain/privateTransfer.js";

const EPHEMERAL_SPL_PROGRAM = new PublicKey("SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2");
const SENDER = Keypair.generate().publicKey;
const SPONSOR = Keypair.generate().publicKey;
const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const OTHER_MINT = Keypair.generate().publicKey;
const TEN_USDC = 10_000_000n;
const SENDER_USDC = getAssociatedTokenAddressSync(USDC, SENDER);
const SPONSOR_USDC = getAssociatedTokenAddressSync(USDC, SPONSOR);

const ephemeral = (data: Buffer) =>
  new TransactionInstruction({
    programId: EPHEMERAL_SPL_PROGRAM,
    keys: [{ pubkey: SENDER, isSigner: true, isWritable: true }],
    data,
  });

/** The queueing instruction as genuine transfers lay it out, stating `amount`. */
function queueTransfer(amount: bigint, length = 196): TransactionInstruction {
  const data = Buffer.alloc(length);
  data[0] = 25;
  data.writeBigUInt64LE(amount, 5);
  return ephemeral(data);
}

function compile(instructions: TransactionInstruction[], payerKey = SENDER) {
  const message = new TransactionMessage({
    payerKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions,
  }).compileToV0Message();
  return { transaction: new VersionedTransaction(message), keys: message.getAccountKeys() };
}

const genuine = (amount = TEN_USDC) => [
  ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
  ephemeral(Buffer.from([0])),
  ephemeral(Buffer.concat([Buffer.from([4]), Buffer.alloc(32)])),
  queueTransfer(amount),
];

describe("the private-payment program's instructions", () => {
  it("allows the three a genuine transfer is made of", () => {
    const { transaction, keys } = compile(genuine());
    expect(checkPrograms(transaction, keys, PRIVATE_PAYMENT_PROGRAMS)).toEqual({ ok: true });
  });

  it("refuses any other instruction of the same program", () => {
    for (const discriminator of [1, 2, 3, 5, 24, 26, 255]) {
      const { transaction, keys } = compile([
        ...genuine(),
        ephemeral(Buffer.from([discriminator])),
      ]);
      expect(
        checkPrograms(transaction, keys, PRIVATE_PAYMENT_PROGRAMS).ok,
        `${discriminator}`,
      ).toBe(false);
    }
  });
});

describe("checkQueuedAmount", () => {
  const check = (instructions: TransactionInstruction[]) =>
    checkQueuedAmount(compile(instructions).transaction, TEN_USDC);

  it("accepts one transfer queued for exactly the requested amount", async () => {
    expect(await check(genuine())).toEqual({ ok: true });
  });

  it("refuses a transfer queued for a different amount, smaller or larger", async () => {
    // The sender's balance check would pass the smaller one: less than the
    // limit leaves the account. What is queued for the recipient is short.
    for (const amount of [TEN_USDC - 1n, 1n, TEN_USDC + 1n]) {
      expect(await check(genuine(amount))).toMatchObject({
        ok: false,
        reason: expect.stringContaining("different amount"),
      });
    }
  });

  it("refuses a second transfer queued beside the first", async () => {
    expect((await check([...genuine(), queueTransfer(TEN_USDC)])).ok).toBe(false);
  });

  it("refuses a transaction that queues nothing, or in a layout it cannot read", async () => {
    expect((await check(genuine().slice(0, 3))).ok).toBe(false);
    for (const length of [13, 195, 197]) {
      const instructions = [...genuine().slice(0, 3), queueTransfer(TEN_USDC, length)];
      expect(await check(instructions), `${length}`).toMatchObject({
        ok: false,
        reason: expect.stringContaining("cannot read"),
      });
    }
  });
});

/**
 * A gasless transfer as the live service builds one: the sponsor pays, the
 * relay fee is the first instruction, and the sender only signs.
 */
const relayFee = (amount = RELAY_FEE_RAW, destination = SPONSOR_USDC, source = SENDER_USDC) =>
  createTransferInstruction(source, destination, SENDER, amount);

function gasless(fee: TransactionInstruction[] = [relayFee()], payer = SPONSOR) {
  const setup = (data: Buffer) =>
    new TransactionInstruction({
      programId: EPHEMERAL_SPL_PROGRAM,
      keys: [
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: SENDER, isSigner: true, isWritable: false },
      ],
      data,
    });
  const queue = Buffer.alloc(196);
  queue[0] = 25;
  queue.writeBigUInt64LE(TEN_USDC, 5);
  return compile(
    [
      ...fee,
      createAssociatedTokenAccountIdempotentInstruction(payer, SENDER_USDC, SENDER, USDC),
      setup(Buffer.from([0])),
      setup(Buffer.concat([Buffer.from([4]), Buffer.alloc(32)])),
      setup(queue),
    ],
    payer,
  );
}

describe("checkRelayFee", () => {
  const check = (built: ReturnType<typeof gasless>) =>
    checkRelayFee(built.transaction, SENDER, USDC);

  it("accepts the genuine gasless shape and reads the fee off the transaction", async () => {
    const built = gasless();
    expect(checkPrograms(built.transaction, built.keys, PRIVATE_PAYMENT_PROGRAMS)).toEqual({
      ok: true,
    });
    expect(await checkQueuedAmount(built.transaction, TEN_USDC)).toEqual({ ok: true });
    expect(await check(built)).toEqual({ ok: true, relayFeeRaw: RELAY_FEE_RAW });
    expect(await check(gasless([relayFee(150_000n)]))).toEqual({ ok: true, relayFeeRaw: 150_000n });
  });

  it("refuses a relay fee above the published one", async () => {
    for (const amount of [RELAY_FEE_RAW + 1n, TEN_USDC]) {
      expect(await check(gasless([relayFee(amount)]))).toMatchObject({
        ok: false,
        reason: expect.stringContaining("larger relay fee"),
      });
    }
  });

  it("refuses a second token transfer, whatever it is for", async () => {
    expect((await check(gasless([relayFee(), relayFee()]))).ok).toBe(false);
    expect((await check(gasless([relayFee(), relayFee(1n)]))).ok).toBe(false);
    expect((await check(gasless([]))).ok).toBe(false);
  });

  it("refuses a relay fee paid anywhere but the fee payer's own account for this mint", async () => {
    const stranger = Keypair.generate().publicKey;
    const destinations = [
      // An account of an unrelated mint, the sponsor's included.
      getAssociatedTokenAddressSync(OTHER_MINT, SPONSOR),
      getAssociatedTokenAddressSync(USDC, stranger),
      // Pointless, and still not the published shape: the sender's own accounts.
      SENDER_USDC,
      getAssociatedTokenAddressSync(OTHER_MINT, SENDER),
      SPONSOR,
    ];
    for (const destination of destinations) {
      expect(
        await check(gasless([relayFee(RELAY_FEE_RAW, destination)])),
        destination.toBase58(),
      ).toMatchObject({ ok: false, reason: expect.stringContaining("relay fee") });
    }
  });

  it("refuses a relay fee taken from any account but the sender's own for this mint", async () => {
    const source = getAssociatedTokenAddressSync(OTHER_MINT, SENDER);
    expect((await check(gasless([relayFee(RELAY_FEE_RAW, SPONSOR_USDC, source)]))).ok).toBe(false);
  });

  it("refuses every other token instruction, alone or beside the relay fee", async () => {
    const others = [
      createTransferCheckedInstruction(SENDER_USDC, USDC, SPONSOR_USDC, SENDER, RELAY_FEE_RAW, 6),
      createApproveInstruction(SENDER_USDC, SPONSOR, SENDER, TEN_USDC),
    ];
    for (const other of others) {
      const alone = gasless([other]);
      const beside = gasless([relayFee(), other]);
      expect(checkPrograms(alone.transaction, alone.keys, PRIVATE_PAYMENT_PROGRAMS).ok).toBe(false);
      expect((await check(alone)).ok).toBe(false);
      expect((await check(beside)).ok).toBe(false);
    }
  });

  it("refuses the sender as fee payer: a self-paid transfer is not what was asked for", async () => {
    // Both self-paid shapes: with no relay fee, as the service builds one
    // without `gasless`, and with a fee paid to the sender's own account.
    expect(await check(gasless([], SENDER))).toMatchObject({
      ok: false,
      reason: expect.stringContaining("paid for in SOL"),
    });
    expect((await check(gasless([relayFee()], SENDER))).ok).toBe(false);
  });

  it("refuses an arbitrary fee payer that takes no relay fee, and one the sender does not sign", async () => {
    expect((await check(gasless([], Keypair.generate().publicKey))).ok).toBe(false);
    const stranger = Keypair.generate().publicKey;
    const { transaction } = compile(
      [createTransferInstruction(SENDER_USDC, SPONSOR_USDC, stranger, RELAY_FEE_RAW)],
      SPONSOR,
    );
    expect((await checkRelayFee(transaction, SENDER, USDC)).ok).toBe(false);
  });

  it("refuses a sender asked to sign as a writable account", async () => {
    const built = gasless();
    const writable = new TransactionInstruction({
      programId: EPHEMERAL_SPL_PROGRAM,
      keys: [{ pubkey: SENDER, isSigner: true, isWritable: true }],
      data: Buffer.from([0]),
    });
    const { transaction } = compile(
      [
        relayFee(),
        writable,
        ...TransactionMessage.decompile(built.transaction.message).instructions.slice(1),
      ],
      SPONSOR,
    );
    expect(await checkRelayFee(transaction, SENDER, USDC)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("more than its signature"),
    });
  });
});

describe("the token accounts a transfer may open", () => {
  const PORTFOLIO = Keypair.generate().publicKey;
  const create = (owner: PublicKey, mint = USDC, payer = SPONSOR) =>
    createAssociatedTokenAccountIdempotentInstruction(
      payer,
      getAssociatedTokenAddressSync(mint, owner),
      owner,
      mint,
    );
  const check = (extra: TransactionInstruction[]) =>
    checkCreatedAccounts(gasless([relayFee(), ...extra]).transaction, SENDER, USDC);

  it("accepts the one a genuine transfer carries: the sender's own account for this mint", async () => {
    expect(await check([])).toEqual({ ok: true });
  });

  it("refuses an account opened for anyone else, the destination portfolio first of all", async () => {
    // The allowlist passes all of these: they are plain create-idempotent
    // instructions, paid for by the sponsor, moving nothing.
    const others = [create(PORTFOLIO), create(SPONSOR), create(Keypair.generate().publicKey)];
    for (const instruction of others) {
      const built = gasless([relayFee(), instruction]);
      expect(checkPrograms(built.transaction, built.keys, PRIVATE_PAYMENT_PROGRAMS).ok).toBe(true);
      expect(await checkCreatedAccounts(built.transaction, SENDER, USDC)).toMatchObject({
        ok: false,
        reason: expect.stringContaining("no reason to"),
      });
    }
  });

  it("refuses the sender's account for another mint, or at an address that is not its own", async () => {
    expect((await check([create(SENDER, OTHER_MINT)])).ok).toBe(false);
    const elsewhere = createAssociatedTokenAccountIdempotentInstruction(
      SPONSOR,
      Keypair.generate().publicKey,
      SENDER,
      USDC,
    );
    expect((await check([elsewhere])).ok).toBe(false);
  });
});

describe("keeping this wallet's other addresses out of the transaction", () => {
  const RECIPIENT = Keypair.generate().publicKey;
  const SIBLING = Keypair.generate().publicKey;
  const secret = [RECIPIENT, SIBLING];
  /** An instruction of the service's own program that merely reads `address`. */
  const naming = (address: PublicKey) =>
    new TransactionInstruction({
      programId: EPHEMERAL_SPL_PROGRAM,
      keys: [{ pubkey: address, isSigner: false, isWritable: false }],
      data: Buffer.from([0]),
    });
  const check = (extra: TransactionInstruction[]) =>
    checkKeepsOut(gasless([relayFee(), ...extra]).transaction, USDC, secret);

  it("passes a genuine transfer, which names the destination nowhere", async () => {
    expect(await check([])).toEqual({ ok: true });
  });

  it("refuses a transaction that names the recipient portfolio, however harmlessly", async () => {
    const built = gasless([relayFee(), naming(RECIPIENT)]);
    // Every other check passes: nothing moves, and the program is the service's own.
    expect(checkPrograms(built.transaction, built.keys, PRIVATE_PAYMENT_PROGRAMS).ok).toBe(true);
    expect(await checkQueuedAmount(built.transaction, TEN_USDC)).toEqual({ ok: true });
    expect((await checkRelayFee(built.transaction, SENDER, USDC)).ok).toBe(true);
    expect(await checkKeepsOut(built.transaction, USDC, secret)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("name one of your portfolios"),
    });
  });

  it("refuses one that names a sibling portfolio", async () => {
    expect((await check([naming(SIBLING)])).ok).toBe(false);
  });

  it("refuses one that names a portfolio's token account, or opens it", async () => {
    expect((await check([naming(getAssociatedTokenAddressSync(USDC, RECIPIENT))])).ok).toBe(false);
    expect((await check([naming(getAssociatedTokenAddressSync(USDC, SIBLING))])).ok).toBe(false);
    const opened = createAssociatedTokenAccountIdempotentInstruction(
      SPONSOR,
      getAssociatedTokenAddressSync(USDC, RECIPIENT),
      RECIPIENT,
      USDC,
    );
    expect((await check([opened])).ok).toBe(false);
  });

  it("is not tripped by the funding wallet itself, which has to be there", async () => {
    expect(await checkKeepsOut(gasless().transaction, USDC, [])).toEqual({ ok: true });
    expect((await checkKeepsOut(gasless().transaction, USDC, [SENDER])).ok).toBe(false);
  });
});

describe("sending a signed transfer whose answer may be lost", () => {
  const SIGNATURE = "5".repeat(88);
  const BODY = { transactionBase64: "AQID", sendTo: "base", cluster: "devnet" };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function answer(reply: Response | Error) {
    const sent = vi.fn(async () => {
      if (reply instanceof Error) throw reply;
      return reply;
    });
    vi.stubGlobal("fetch", sent);
    return sent;
  }

  /** What the chain says of the signature, and whether its blockhash can still land. */
  function chain(status: object | null, expired = false) {
    vi.spyOn(connection, "getLatestBlockhash").mockResolvedValue({
      blockhash: "hash",
      lastValidBlockHeight: 1_000,
    });
    vi.spyOn(connection, "getBlockHeight").mockResolvedValue(expired ? 1_001 : 900);
    return vi
      .spyOn(connection, "getSignatureStatus")
      .mockResolvedValue({ context: { slot: 1 }, value: status } as never);
  }

  const LANDED = { confirmationStatus: "confirmed", err: null };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

  it("returns the transaction's own signature when the service accepts the send", async () => {
    chain(null);
    answer(json(200, { signature: "whatever-the-service-says" }));
    expect(await submitTransfer(BODY, SIGNATURE, 0)).toBe(SIGNATURE);
  });

  it("treats a timed-out send as started when the chain shows it landed", async () => {
    const asked = chain(LANDED);
    answer(new Error("timeout"));
    expect(await submitTransfer(BODY, SIGNATURE, 0)).toBe(SIGNATURE);
    expect(asked.mock.calls[0][0]).toBe(SIGNATURE);

    answer(json(504, { error: "upstream timed out" }));
    expect(await submitTransfer(BODY, SIGNATURE, 0)).toBe(SIGNATURE);
  });

  it("calls a timed-out send unknown, not failed, while the chain has nothing yet", async () => {
    chain(null);
    for (const reply of [new Error("timeout"), json(502, {}), json(200, {})]) {
      answer(reply);
      await expect(submitTransfer(BODY, SIGNATURE, 0)).rejects.toMatchObject({
        name: "UnknownOutcomeError",
        signature: SIGNATURE,
      });
    }
  });

  it("calls it failed only once the chain shows an error or it can no longer land", async () => {
    chain({ confirmationStatus: "confirmed", err: { InstructionError: [0, "Custom"] } });
    answer(new Error("timeout"));
    await expect(submitTransfer(BODY, SIGNATURE, 0)).rejects.toThrow("did not go through");

    // Expired with no trace: a failure, in the words the service refused it with.
    chain(null, true);
    answer(json(400, { error: { code: "BAD", message: "Signature verification failed." } }));
    await expect(submitTransfer(BODY, SIGNATURE, 0)).rejects.toThrow(
      "Signature verification failed.",
    );
  });

  it("does not take a refusal as final: the service had the transaction, so only the chain settles it", async () => {
    // It may have passed the transaction on before it refused.
    chain(null);
    answer(json(400, { error: { code: "BAD", message: "Signature verification failed." } }));
    const error = await submitTransfer(BODY, SIGNATURE, 0).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ name: "UnknownOutcomeError", signature: SIGNATURE });

    // Once its time has run out with no trace, the refusal stands, as worded.
    chain(null, true);
    answer(json(400, { error: { code: "BAD", message: "Signature verification failed." } }));
    await expect(submitTransfer(BODY, SIGNATURE, 0)).rejects.toThrow(
      "Signature verification failed.",
    );

    chain(LANDED);
    answer(json(400, { error: { code: "BAD", message: "Signature verification failed." } }));
    expect(await submitTransfer(BODY, SIGNATURE, 0)).toBe(SIGNATURE);
  });

  it("cannot confirm anything without a signature of its own, and says unknown", async () => {
    answer(new Error("timeout"));
    await expect(submitTransfer(BODY, null, 0)).rejects.toMatchObject({
      name: "UnknownOutcomeError",
    });
  });
});

describe("the privacy fee the limit is built from", () => {
  it("is rounded up, so the limit never sits below the real charge", () => {
    expect(privacyFeeFor(TEN_USDC)).toBe(10_000n);
    expect(privacyFeeFor(1_234_567_891n)).toBe(1_234_568n);
    expect(privacyFeeFor(500_000n)).toBe(500n);
  });
});
