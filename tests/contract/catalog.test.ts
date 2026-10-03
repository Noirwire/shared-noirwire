import { beforeEach, describe, expect, it } from "vitest";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { connection } from "../../src/infrastructure/solana/client.js";
import { JUPITER_UPSTREAM_URL, jupiterKeyHeaders } from "./setup/upstreams.js";
import { jupiterFetch } from "../../src/infrastructure/solana/config.js";
import { inspectMint } from "../../src/infrastructure/solana/mintPolicy.mjs";
import { ALL_STOCKS, TRADABLE_STOCKS } from "../../src/infrastructure/solana/tokenRegistry.js";

/**
 * Every stock in the generated catalog, pinned against the chain and against
 * Jupiter's index as they are right now.
 *
 * The catalog is a file, and the things it describes can change under it: an
 * issuer can pause a mint or attach a transfer hook, and the index can drop a
 * token. Each of those would make the app quietly wrong about something it
 * shows or signs, so each is checked here per mint rather than assumed.
 */

/** Jupiter's keyless tier allows 0.5 requests per second. */
const KEYLESS_INTERVAL_MS = 2_500;
const throttled = !process.env.JUPITER_API_KEY?.trim();

beforeEach(async () => {
  if (throttled) await new Promise((resolve) => setTimeout(resolve, KEYLESS_INTERVAL_MS));
});

const MINTS = ALL_STOCKS.map((stock) => stock.mint);

function batches<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

async function jupiter<T>(path: string): Promise<T> {
  const response = await jupiterFetch(`${JUPITER_UPSTREAM_URL}${path}`, {
    headers: jupiterKeyHeaders(),
  });
  expect(response.ok, path).toBe(true);
  if (throttled) await new Promise((resolve) => setTimeout(resolve, KEYLESS_INTERVAL_MS));
  return (await response.json()) as T;
}

async function mintAccounts() {
  const infos = [];
  for (const batch of batches(MINTS, 100)) {
    infos.push(...(await connection.getMultipleAccountsInfo(batch)));
  }
  return infos;
}

describe("the generated catalog against mainnet", () => {
  it("lists more than the original ten stocks", () => {
    expect(TRADABLE_STOCKS.length).toBeGreaterThan(10);
  });

  it("finds every mint on chain under the program and decimals the registry says", async () => {
    const infos = await mintAccounts();
    ALL_STOCKS.forEach((stock, index) => {
      const info = infos[index];
      expect(info, stock.symbol).not.toBeNull();
      expect(info!.owner.equals(TOKEN_2022_PROGRAM_ID), stock.symbol).toBe(true);
      expect(stock.programId.equals(TOKEN_2022_PROGRAM_ID), stock.symbol).toBe(true);
      const mint = inspectMint(stock.mint.toBase58(), info);
      // A retired stock may have left the profile; that can be why it was retired.
      if (stock.retired) return;
      expect(mint.problem, stock.symbol).toBeNull();
      expect(mint.problem === null && mint.decimals, stock.symbol).toBe(stock.decimals);
    });
  });

  it(
    "finds every mint in Jupiter's token index under the same symbol",
    { timeout: 120_000 },
    async () => {
      type IndexedToken = {
        id: string;
        symbol: string;
        decimals: number;
        tokenProgram: string;
        isVerified?: boolean | null;
      };
      const indexed = new Map<string, IndexedToken>();
      for (const batch of batches(MINTS, 100)) {
        const tokens = await jupiter<IndexedToken[]>(`/tokens/v2/search?query=${batch.join(",")}`);
        for (const token of tokens) indexed.set(token.id, token);
      }
      for (const stock of ALL_STOCKS) {
        const token = indexed.get(stock.mint.toBase58());
        expect(token, stock.symbol).toBeDefined();
        expect(token!.symbol, stock.symbol).toBe(stock.symbol);
        expect(token!.decimals, stock.symbol).toBe(stock.decimals);
        expect(token!.tokenProgram, stock.symbol).toBe(TOKEN_2022_PROGRAM_ID.toBase58());
        if (!stock.retired) expect(token!.isVerified, stock.symbol).toBe(true);
      }
    },
  );
});
