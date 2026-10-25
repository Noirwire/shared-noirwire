import { PublicKey } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  guardRollup,
  guardSolana,
  type GuardDeps,
  type SolanaReads,
} from "../../../src/infrastructure/solana/walletBridge/networkGuard.js";
import type { BridgePins } from "../../../src/infrastructure/solana/walletBridge/pins.js";

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const VALIDATOR = "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo";
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const BLOCKHASH = "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM";

const PINS: BridgePins = {
  orderbookProgram: new PublicKey("BrUoDsreaeXWypVxh6LoGseqwB4TZVJZBxvhfxXprvwP"),
  rollupUrl: "https://mainnet-tee.magicblock.app",
  rollupValidator: new PublicKey(VALIDATOR),
  usdcMint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  custodyAuthority: null,
  marketIds: [0],
  privateBalance: true,
};

type Handler = (params: unknown[]) => unknown;

/** A rollup that answers JSON-RPC from `handlers`, and remembers what it was asked. */
function rollup(handlers: Record<string, Handler>) {
  const asked: { url: string; method: string; contentType: string | null }[] = [];
  const answer = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
    asked.push({
      url: String(input),
      method: body.method,
      contentType: new Headers(init?.headers).get("content-type"),
    });
    const handler = handlers[body.method];
    const payload = handler
      ? { jsonrpc: "2.0", id: 1, result: handler(body.params) }
      : { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } };
    return new Response(JSON.stringify(payload));
  });
  return { answer: answer as unknown as typeof fetch, asked };
}

const healthy: Record<string, Handler> = {
  getIdentity: () => ({ identity: VALIDATOR }),
  getAccountInfo: () => ({ context: { slot: 1 }, value: { owner: TOKEN_PROGRAM, lamports: 1 } }),
  isBlockhashValid: () => ({ context: { slot: 1 }, value: true }),
};

function solana(over: Partial<SolanaReads> = {}): SolanaReads {
  return {
    genesisHash: async () => DEVNET_GENESIS,
    isBlockhashValid: async () => true,
    ...over,
  };
}

const deps = (fetchFn: typeof fetch, reads: SolanaReads = solana()): GuardDeps => ({
  fetch: fetchFn,
  solana: reads,
  timeoutMs: 1_000,
});

const never = () => new Promise<never>(() => undefined);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the rollup guard", () => {
  it("passes a rollup run by the pinned validator, serving the mint, with a live blockhash", async () => {
    const { answer, asked } = rollup(healthy);
    expect(await guardRollup(BLOCKHASH, PINS, deps(answer))).toEqual({ ok: true });
    expect(asked.map((call) => call.method)).toEqual([
      "getIdentity",
      "getAccountInfo",
      "isBlockhashValid",
    ]);
    expect(asked.every((call) => call.url === PINS.rollupUrl)).toBe(true);
    expect(asked.every((call) => call.contentType === "text/plain")).toBe(true);
  });

  it("refuses a rollup run by another validator", async () => {
    const { answer } = rollup({
      ...healthy,
      getIdentity: () => ({ identity: PINS.usdcMint.toBase58() }),
    });
    expect(await guardRollup(BLOCKHASH, PINS, deps(answer))).toEqual({
      ok: false,
      refusal: "wrongNetwork",
    });
  });

  it("refuses the right validator without the mainnet USDC mint, as the test rollup is", async () => {
    const { answer } = rollup({ ...healthy, getAccountInfo: () => ({ value: null }) });
    expect(await guardRollup(BLOCKHASH, PINS, deps(answer))).toEqual({
      ok: false,
      refusal: "wrongNetwork",
    });
  });

  it("refuses a mint account that the token program does not own", async () => {
    const { answer } = rollup({
      ...healthy,
      getAccountInfo: () => ({ value: { owner: VALIDATOR } }),
    });
    expect(await guardRollup(BLOCKHASH, PINS, deps(answer))).toEqual({
      ok: false,
      refusal: "wrongNetwork",
    });
  });

  it("refuses a blockhash the rollup does not know", async () => {
    const { answer } = rollup({ ...healthy, isBlockhashValid: () => ({ value: false }) });
    expect(await guardRollup(BLOCKHASH, PINS, deps(answer))).toEqual({
      ok: false,
      refusal: "wrongNetwork",
    });
  });

  it("is unchecked when the rollup does not answer in time", async () => {
    const result = guardRollup(BLOCKHASH, PINS, deps(never as unknown as typeof fetch));
    await vi.advanceTimersByTimeAsync(1_001);
    expect(await result).toEqual({ ok: false, refusal: "networkUnchecked" });
  });

  it("is unchecked when the rollup fails", async () => {
    const failing = (async () => new Response("down", { status: 503 })) as typeof fetch;
    expect(await guardRollup(BLOCKHASH, PINS, deps(failing))).toEqual({
      ok: false,
      refusal: "networkUnchecked",
    });
    const broken = (async () => {
      throw new TypeError("offline");
    }) as typeof fetch;
    expect(await guardRollup(BLOCKHASH, PINS, deps(broken))).toEqual({
      ok: false,
      refusal: "networkUnchecked",
    });
  });

  describe("when the rollup cannot say whether a blockhash is live", () => {
    const withoutBlockhashMethod = () => {
      const { isBlockhashValid, ...rest } = healthy;
      void isBlockhashValid;
      return rollup(rest);
    };

    it("refuses a blockhash that is live on Solana", async () => {
      const { answer } = withoutBlockhashMethod();
      const live = solana({ isBlockhashValid: async () => true });
      expect(await guardRollup(BLOCKHASH, PINS, deps(answer, live))).toEqual({
        ok: false,
        refusal: "wrongNetwork",
      });
    });

    it("passes a blockhash that Solana does not know", async () => {
      const { answer } = withoutBlockhashMethod();
      const unknown = solana({ isBlockhashValid: async () => false });
      expect(await guardRollup(BLOCKHASH, PINS, deps(answer, unknown))).toEqual({ ok: true });
    });

    it("is unchecked when Solana cannot be asked either", async () => {
      const { answer } = withoutBlockhashMethod();
      const down = solana({
        isBlockhashValid: async () => {
          throw new Error("offline");
        },
      });
      expect(await guardRollup(BLOCKHASH, PINS, deps(answer, down))).toEqual({
        ok: false,
        refusal: "networkUnchecked",
      });
    });
  });
});

describe("the Solana guard", () => {
  const unused = (async () => new Response("")) as typeof fetch;

  it("passes the chain this build is made for, with a live blockhash", async () => {
    expect(await guardSolana(BLOCKHASH, deps(unused))).toEqual({ ok: true });
  });

  it("refuses another chain", async () => {
    const other = solana({
      genesisHash: async () => "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    });
    expect(await guardSolana(BLOCKHASH, deps(unused, other))).toEqual({
      ok: false,
      refusal: "wrongNetwork",
    });
  });

  it("refuses a blockhash that is not live", async () => {
    const stale = solana({ isBlockhashValid: async () => false });
    expect(await guardSolana(BLOCKHASH, deps(unused, stale))).toEqual({
      ok: false,
      refusal: "wrongNetwork",
    });
  });

  it("is unchecked when the chain does not answer in time", async () => {
    const silent = solana({ genesisHash: never });
    const result = guardSolana(BLOCKHASH, deps(unused, silent));
    await vi.advanceTimersByTimeAsync(1_001);
    expect(await result).toEqual({ ok: false, refusal: "networkUnchecked" });
  });
});
