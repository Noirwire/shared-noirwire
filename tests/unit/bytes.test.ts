import { afterEach, describe, expect, it } from "vitest";
import {
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { bytesEqual, readU32LE, readU64LE } from "../../src/infrastructure/solana/bytes.js";
import { usesDurableNonce } from "../../src/infrastructure/solana/presign-guard.js";
import {
  checkQueuedAmount,
  checkRelayFee,
} from "../../src/infrastructure/solana/private-payments.js";
import {
  decodeAccount,
  readTokenAmount,
  tokenAccountClosed,
  tokenControlChanged,
} from "../../src/infrastructure/solana/swap/guard.js";

/**
 * Node's own Buffer has every reader, so a unit test passes whichever Buffer
 * the code leans on. A browser bundle does not: the bundler's polyfill for a
 * bare `Buffer` has no 64-bit readers, and decoding through it threw on every
 * check before signing. These tests take the readers away, or never hand over
 * a Buffer at all, so they fail if the decoding goes back to depending on one.
 */

const U64_MAX = 18_446_744_073_709_551_615n;
const BIG_READERS = ["readBigUInt64LE", "readBigUint64LE", "readBigInt64LE"] as const;

/** A 165-byte token account as plain bytes, with no Buffer anywhere in its making. */
function tokenAccountBytes(amount: bigint, owner: Uint8Array = new Uint8Array(32)): Uint8Array {
  const data = new Uint8Array(165);
  data.set(owner, 32);
  new DataView(data.buffer).setBigUint64(64, amount, true);
  return data;
}

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

const saved = new Map<string, unknown>();

/** Makes Node's Buffer look like the polyfill a browser bundle substitutes: no 64-bit readers. */
function removeBigReaders() {
  const prototype = Buffer.prototype as unknown as Record<string, unknown>;
  for (const name of BIG_READERS) {
    saved.set(name, prototype[name]);
    delete prototype[name];
  }
}

afterEach(() => {
  const prototype = Buffer.prototype as unknown as Record<string, unknown>;
  for (const [name, reader] of saved) prototype[name] = reader;
  saved.clear();
});

describe("reading bytes without Buffer", () => {
  it("reads little-endian integers at an offset, up to the largest u64", () => {
    const data = new Uint8Array(20);
    const view = new DataView(data.buffer);
    view.setBigUint64(3, U64_MAX, true);
    view.setUint32(12, 0xdeadbeef, true);
    expect(readU64LE(data, 3)).toBe(U64_MAX);
    expect(readU32LE(data, 12)).toBe(0xdeadbeef);
  });

  it("reads through a view into a larger buffer at the view's own offset", () => {
    const backing = new Uint8Array(64);
    new DataView(backing.buffer).setBigUint64(40, 77n, true);
    expect(readU64LE(backing.subarray(32), 8)).toBe(77n);
  });

  it("throws on a read past the end instead of returning something", () => {
    expect(() => readU64LE(new Uint8Array(7), 0)).toThrow(RangeError);
  });

  it("compares bytes by content and length", () => {
    expect(bytesEqual(new Uint8Array([1, 2]), Buffer.from([1, 2]))).toBe(true);
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 0]))).toBe(false);
  });
});

describe("decoding a token account", () => {
  it("reads the amount from plain bytes that have no reader methods at all", () => {
    const data = tokenAccountBytes(123_456_789_012n);
    expect("readBigUInt64LE" in data).toBe(false);
    expect(readTokenAmount(data)).toBe(123_456_789_012n);
    expect(readTokenAmount(tokenAccountBytes(U64_MAX))).toBe(U64_MAX);
    expect(readTokenAmount(undefined)).toBe(0n);
    expect(readTokenAmount(new Uint8Array(10))).toBe(0n);
  });

  it("decodes a simulated account and reads it with the 64-bit readers gone", () => {
    const owner = Keypair.generate().publicKey.toBytes();
    const encoded = base64(tokenAccountBytes(5_000_000n, owner));
    removeBigReaders();

    const decoded = decodeAccount({ data: [encoded, "base64"] });
    expect((decoded as unknown as Record<string, unknown>).readBigUInt64LE).toBeUndefined();
    expect(readTokenAmount(decoded)).toBe(5_000_000n);
    expect(tokenAccountClosed(decoded)).toBe(false);
    expect(decodeAccount({ data: [encoded, "base58"] })).toBeUndefined();
    expect(decodeAccount(null)).toBeUndefined();
  });

  it("compares who controls an account on plain bytes", () => {
    const owner = Keypair.generate().publicKey.toBytes();
    const before = tokenAccountBytes(1n, owner);
    const delegated = tokenAccountBytes(1n, owner);
    new DataView(delegated.buffer).setUint32(72, 1, true);
    const reowned = tokenAccountBytes(1n, Keypair.generate().publicKey.toBytes());

    expect(tokenControlChanged(before, tokenAccountBytes(9n, owner))).toBe(false);
    expect(tokenControlChanged(before, delegated)).toBe(true);
    expect(tokenControlChanged(before, reowned)).toBe(true);
    // An account the transaction creates has nothing before it to compare with.
    expect(tokenControlChanged(undefined, before)).toBe(false);
    expect(tokenControlChanged(undefined, delegated)).toBe(true);
  });
});

describe("decoding instruction data with the 64-bit readers gone", () => {
  const SENDER = Keypair.generate().publicKey;
  const SPONSOR = Keypair.generate().publicKey;
  const MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  const EPHEMERAL = new PublicKey("SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2");

  function compile(instructions: TransactionInstruction[], payerKey: PublicKey) {
    const message = new TransactionMessage({
      payerKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions,
    }).compileToV0Message();
    return new VersionedTransaction(message);
  }

  it("reads a queued private transfer's amount and its relay fee", async () => {
    const queue = new Uint8Array(196);
    queue[0] = 25;
    new DataView(queue.buffer).setBigUint64(5, 10_000_000n, true);
    const transaction = compile(
      [
        new TransactionInstruction({
          programId: EPHEMERAL,
          keys: [{ pubkey: SENDER, isSigner: true, isWritable: false }],
          data: Buffer.from(queue),
        }),
        createTransferInstruction(
          getAssociatedTokenAddressSync(MINT, SENDER),
          getAssociatedTokenAddressSync(MINT, SPONSOR),
          SENDER,
          200_000n,
          [],
          TOKEN_PROGRAM_ID,
        ),
      ],
      SPONSOR,
    );
    removeBigReaders();

    expect(await checkQueuedAmount(transaction, 10_000_000n)).toEqual({ ok: true });
    expect(await checkQueuedAmount(transaction, 9_999_999n)).toMatchObject({ ok: false });
    expect(await checkRelayFee(transaction, SENDER, MINT)).toEqual({
      ok: true,
      relayFeeRaw: 200_000n,
    });
  });

  it("recognises a durable nonce from the instruction's first four bytes", () => {
    const nonce = Keypair.generate().publicKey;
    const transaction = compile(
      [SystemProgram.nonceAdvance({ noncePubkey: nonce, authorizedPubkey: SENDER })],
      SENDER,
    );
    removeBigReaders();
    expect(usesDurableNonce(transaction, transaction.message.getAccountKeys())).toBe(true);
  });
});
