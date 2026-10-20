import { afterEach, describe, expect, it, vi } from "vitest";
import {
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

  it("signs a route paying the attacker when the API answers every RPC call", async () => {
    // The route's only writable destination is the attacker's account. The
    // taker's output account is not even in the transaction.
    const route = new TransactionInstruction({
      programId: JUPITER,
      keys: [
        { pubkey: taker, isSigner: true, isWritable: true },
        { pubkey: inputAta, isSigner: false, isWritable: true },
        { pubkey: attackerAta, isSigner: false, isWritable: true },
        { pubkey: attacker, isSigner: false, isWritable: false },
      ],
      data: Buffer.alloc(24),
    });
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: taker,
        recentBlockhash: PublicKey.default.toBase58(),
        instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1 }), route],
      }).compileToV0Message(),
    );

    const rpcRoute = apiUrl("rpc");
    const asked: string[] = [];
    const mint = mintAccount();
    // Only the API origin is faked. The Connection, the guard and every
    // check inside it run unchanged.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        expect(String(input)).toBe(rpcRoute);
        const call = JSON.parse(String(init?.body)) as { id: string; method: string };
        asked.push(call.method);
        const context = { slot: 1 };
        let result: unknown;
        if (call.method === "getTokenAccountsByOwner") {
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

    expect(asked).toContain("simulateTransaction");
    // The guard accepts it: every input it judged by came from the same
    // origin that would have built the order.
    expect(verdict).toEqual({ ok: true, expectedOut: 500_000n });
    expect(transaction.message.staticAccountKeys.some((key) => key.equals(outputAta))).toBe(false);
  });
});
