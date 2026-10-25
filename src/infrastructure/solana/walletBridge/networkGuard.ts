import { connection } from "../client.js";
import { expectedGenesisHash } from "../config.js";
import { TOKEN_PROGRAM, type BridgePins } from "./pins.js";

/**
 * Whether the network a request is for is the one this build trades on, from
 * the wallet's own reads and never from anything the terminal says. Solana
 * is asked through NoirWire's server (its genesis hash, and that the
 * message's blockhash is live there). The rollup is asked directly, at the
 * one pinned URL: who runs it, that the mainnet USDC mint is served there
 * (which tells it from the test rollup, whose validator key is the same),
 * and that the message's blockhash is live there.
 */

export type GuardResult =
  { ok: true } | { ok: false; refusal: "wrongNetwork" | "networkUnchecked" };

export type SolanaReads = {
  genesisHash(): Promise<string>;
  isBlockhashValid(blockhash: string): Promise<boolean>;
};

export type GuardDeps = {
  solana: SolanaReads;
  fetch: typeof fetch;
  /** How long any one read may take. */
  timeoutMs: number;
};

export const GUARD_TIMEOUT_MS = 10_000;

/** Solana as the app reads it, through NoirWire's server. */
export const solanaReadsThroughApi: SolanaReads = {
  genesisHash: () => connection.getGenesisHash(),
  isBlockhashValid: async (blockhash) => (await connection.isBlockhashValid(blockhash)).value,
};

const ok: GuardResult = { ok: true };
const wrong: GuardResult = { ok: false, refusal: "wrongNetwork" };
const unchecked: GuardResult = { ok: false, refusal: "networkUnchecked" };

class Unchecked extends Error {}

async function within<T>(ms: number, read: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const bound = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Unchecked()), ms);
  });
  try {
    return await Promise.race([read, bound]);
  } catch {
    throw new Unchecked();
  } finally {
    clearTimeout(timer!);
    read.catch(() => undefined);
  }
}

type RpcAnswer = { result?: unknown; error?: unknown };

async function rollupCall(
  pins: BridgePins,
  deps: GuardDeps,
  method: string,
  params: unknown[],
): Promise<RpcAnswer> {
  const answer = await within(
    deps.timeoutMs,
    (async () => {
      const response = await deps.fetch(pins.rollupUrl, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if (!response.ok) throw new Unchecked();
      return (await response.json()) as unknown;
    })(),
  );
  if (typeof answer !== "object" || answer === null) throw new Unchecked();
  return answer as RpcAnswer;
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/** Solana: the chain this build is made for, and a blockhash that is live on it. */
export async function guardSolana(blockhash: string, deps: GuardDeps): Promise<GuardResult> {
  try {
    const genesis = await within(deps.timeoutMs, deps.solana.genesisHash());
    if (genesis !== expectedGenesisHash()) return wrong;
    const valid = await within(deps.timeoutMs, deps.solana.isBlockhashValid(blockhash));
    return valid ? ok : wrong;
  } catch {
    return unchecked;
  }
}

/** The rollup: run by the pinned validator, serving the pinned mint, and a blockhash that is live on it. */
export async function guardRollup(
  blockhash: string,
  pins: BridgePins,
  deps: GuardDeps,
): Promise<GuardResult> {
  try {
    const identity = objectOf((await rollupCall(pins, deps, "getIdentity", [])).result);
    if (identity?.identity !== pins.rollupValidator.toBase58()) return wrong;

    const mint = objectOf(
      (
        await rollupCall(pins, deps, "getAccountInfo", [
          pins.usdcMint.toBase58(),
          { encoding: "base64" },
        ])
      ).result,
    );
    const account = objectOf(mint?.value);
    if (!account || account.owner !== TOKEN_PROGRAM.toBase58()) return wrong;

    const live = await rollupCall(pins, deps, "isBlockhashValid", [blockhash]);
    const answer = objectOf(live.result);
    if (typeof answer?.value === "boolean") return answer.value ? ok : wrong;
    // A rollup that does not answer the question is held to the weaker proof:
    // a rollup message must not be a live Solana transaction.
    const onSolana = await within(deps.timeoutMs, deps.solana.isBlockhashValid(blockhash));
    return onSolana ? wrong : ok;
  } catch {
    return unchecked;
  }
}
