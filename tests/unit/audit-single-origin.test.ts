import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { apiUrl } from "../../src/infrastructure/api.js";
import { verifySwapBeforeSigning } from "../../src/infrastructure/solana/swap/guard.js";
import type { SwapQuote } from "../../src/infrastructure/solana/swap/types.js";
import { mintAccount } from "./support/mintAccount.js";

const JUPITER = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("audit: the swap guard and the order come from one origin", () => {
  const taker = Keypair.generate().publicKey;
  const attacker = Keypair.generate().publicKey;
  const inputAta = Keypair.generate().publicKey;
  const outputAta = Keypair.generate().publicKey;
  const attackerAta = Keypair.generate().publicKey;
  const stockMint = Keypair.generate().publicKey;
  const quote: SwapQuote = {
    inputMint: Keypair.generate().publicKey,
    outputMint: stockMint,
    inAmount: 1_000_000n,
    outAmount: 500_000n,
    minOutAmount: 495_000n,
    slippageBps: 100,
    priceImpactPct: 0,
    venue: "Jupiter",
    raw: {},
  };

  function tokenAccount(owner: PublicKey, amount: bigint): string {
    const data = Buffer.alloc(165);
    owner.toBuffer().copy(data, 32);
    data.writeBigUInt64LE(amount, 64);
    return data.toString("base64");
  }

  function account(data: string, owner: PublicKey, lamports = 2_039_280) {
    return {
      data: [data, "base64"],
      executable: false,
      lamports,
      owner: owner.toBase58(),
      rentEpoch: 0,
      space: Buffer.from(data, "base64").length,
    };
  }

  /** A lookup table's account data as the chain stores it: a 56-byte header, then the addresses. */
  function lookupTableData(addresses: PublicKey[]): string {
    const data = Buffer.alloc(56 + 32 * addresses.length);
    data.writeUInt32LE(1, 0);
    data.writeBigUInt64LE(2n ** 64n - 1n, 4);
    addresses.forEach((address, index) => address.toBuffer().copy(data, 56 + 32 * index));
    return data.toString("base64");
  }

  /**
   * Jupiter's `route_v2` as its IDL lays it out, with an honest floor
   * (500,000 quoted at 1% slippage: 495,000), spending `inAmount` from the
   * taker's input account and paying `destination`.
   */
  function route(destination: PublicKey, inAmount = quote.inAmount): TransactionInstruction {
    const data = Buffer.alloc(34);
    Buffer.from([187, 100, 250, 204, 49, 196, 175, 20]).copy(data);
    data.writeBigUInt64LE(inAmount, 8);
    data.writeBigUInt64LE(quote.outAmount, 16);
    data.writeUInt16LE(100, 24);
    const account = (pubkey: PublicKey, isWritable = false) => ({
      pubkey,
      isSigner: false,
      isWritable,
    });
    return new TransactionInstruction({
      programId: JUPITER,
      keys: [
        { pubkey: taker, isSigner: true, isWritable: true },
        account(inputAta, true),
        account(destination, true),
        account(quote.inputMint),
        account(stockMint),
        account(TOKEN_PROGRAM_ID),
        account(TOKEN_PROGRAM_ID),
        account(JUPITER),
        account(attacker),
        account(JUPITER),
      ],
      data,
    });
  }

  function order(instruction: TransactionInstruction, tables: AddressLookupTableAccount[] = []) {
    return new VersionedTransaction(
      new TransactionMessage({
        payerKey: taker,
        recentBlockhash: PublicKey.default.toBase58(),
        instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1 }), instruction],
      }).compileToV0Message(tables),
    );
  }

  /**
   * Fakes the API origin alone and runs the guard unchanged. Every answer
   * says the swap is exactly what the quote promised; `tables` are the lookup
   * tables the origin claims exist. Returns the verdict and what was asked.
   */
  async function verifyAgainstLyingOrigin(
    transaction: VersionedTransaction,
    tables: AddressLookupTableAccount[] = [],
  ) {
    const rpcRoute = apiUrl("rpc");
    const asked: string[] = [];
    const mint = mintAccount();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        expect(String(input)).toBe(rpcRoute);
        const call = JSON.parse(String(init?.body)) as {
          id: string;
          method: string;
          params: unknown[];
        };
        asked.push(call.method);
        const context = { slot: 1 };
        let result: unknown;
        if (call.method === "getAccountInfo") {
          const table = tables.find((entry) => entry.key.toBase58() === call.params[0]);
          result = {
            context,
            value: table
              ? account(lookupTableData(table.state.addresses), AddressLookupTableProgram.programId)
              : null,
          };
        } else if (call.method === "getTokenAccountsByOwner") {
          result = { context, value: [] };
        } else if (call.method === "getMultipleAccounts") {
          result = {
            context,
            value: [
              account(tokenAccount(taker, 1_000_000n), TOKEN_PROGRAM_ID),
              null,
              account("", SystemProgram.programId, 10_000_000),
              account(mint.data.toString("base64"), mint.owner, 1),
            ],
          };
        } else if (call.method === "simulateTransaction") {
          result = {
            context,
            value: {
              err: null,
              logs: [],
              unitsConsumed: 0,
              accounts: [
                account(tokenAccount(taker, 0n), TOKEN_PROGRAM_ID),
                account(tokenAccount(taker, 500_000n), TOKEN_PROGRAM_ID),
                account("", SystemProgram.programId, 9_995_000),
              ],
            },
          };
        } else {
          throw new Error(`unexpected ${call.method}`);
        }
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: call.id, result }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const verdict = await verifySwapBeforeSigning(
      transaction,
      quote,
      taker,
      inputAta,
      outputAta,
      { mint: stockMint, acquiring: true },
      5_000_000n,
    );
    return { verdict, asked };
  }

  it("refuses a route paying the attacker even when the API answers every RPC call", async () => {
    // The route's destination is the attacker's account. The taker's output
    // account is not even in the transaction.
    const transaction = order(route(attackerAta));
    const { verdict, asked } = await verifyAgainstLyingOrigin(transaction);

    // Every answer the origin gave says the taker was paid. The route itself
    // says otherwise, and it is read before any of those answers is asked for.
    expect(verdict.ok).toBe(false);
    expect(asked).not.toContain("simulateTransaction");
    expect(transaction.message.staticAccountKeys.some((key) => key.equals(outputAta))).toBe(false);
  });

  it("refuses a destination loaded from a lookup table the origin answers for", async () => {
    // The real table could map this index to the attacker. The origin's
    // answer for it maps it to the taker, and is not believed.
    const table = new AddressLookupTableAccount({
      key: Keypair.generate().publicKey,
      state: {
        deactivationSlot: 2n ** 64n - 1n,
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        addresses: [outputAta],
      },
    });
    const transaction = order(route(outputAta), [table]);
    expect(transaction.message.staticAccountKeys.some((key) => key.equals(outputAta))).toBe(false);

    const { verdict, asked } = await verifyAgainstLyingOrigin(transaction, [table]);

    expect(verdict).toMatchObject({ ok: false, reason: expect.stringContaining("not yours") });
    expect(asked).not.toContain("simulateTransaction");
  });

  it("refuses a route spending more than the quote, though the origin's simulation says it does not", async () => {
    // An honest floor into the taker's own account, but the route takes five
    // times the quoted input: the taker's whole balance, say.
    const transaction = order(route(outputAta, quote.inAmount * 5n));
    const { verdict, asked } = await verifyAgainstLyingOrigin(transaction);

    expect(verdict).toMatchObject({ ok: false, reason: expect.stringContaining("spend from") });
    expect(asked).not.toContain("simulateTransaction");
  });
});
