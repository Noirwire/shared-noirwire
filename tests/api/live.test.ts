import { beforeAll, describe, expect, it } from "vitest";
import { apiUrl } from "../../src/infrastructure/api.js";
import {
  authorizedFetch,
  dropSession,
  sessionRoutes,
} from "../../src/infrastructure/apiSession.js";
import { priceHistory } from "../../src/infrastructure/prices/history.js";
import { readFetch } from "../../src/infrastructure/readFetch.js";
import { connection } from "../../src/infrastructure/solana/client.js";
import { expectedGenesisHash } from "../../src/infrastructure/solana/config.js";
import { relayerPins } from "../../src/infrastructure/solana/relayer.js";
import { TRADABLE_STOCKS } from "../../src/infrastructure/solana/tokenRegistry.js";
import { installPlatform } from "../../src/platform.js";
import { memoryPlatform, memorySessionStore, testEnv } from "../../src/testing/index.js";

/**
 * The read paths, through a server that is really running:
 *
 *   NOIRWIRE_API_URL=http://localhost:4000 npm run test:api:live
 *
 * NOIRWIRE_API_NETWORK is "devnet" (the default) or "mainnet", whichever the
 * server was started for.
 */
const URL_ = process.env.NOIRWIRE_API_URL?.trim().replace(/\/+$/, "");
const network = process.env.NOIRWIRE_API_NETWORK === "mainnet" ? "mainnet-beta" : "devnet";

if (!URL_) {
  console.info(
    "The live API suite is skipped: set NOIRWIRE_API_URL to a running server, such as http://localhost:4000.",
  );
}

describe.skipIf(!URL_)("a running server (NOIRWIRE_API_URL)", () => {
  const store = memorySessionStore();

  beforeAll(async () => {
    installPlatform(
      memoryPlatform({ sessionStore: store, env: testEnv({ apiBaseUrl: URL_!, network }) }),
    );
    await dropSession();
  });

  it("is up", async () => {
    const response = await fetch(apiUrl("health"));
    expect(response.status).toBe(200);
  });

  it("starts a session with nothing sent, and renews it", async () => {
    const started = await sessionRoutes.start();
    expect(started.accessToken).not.toBe("");
    // About an hour on, in milliseconds here: the server gives seconds.
    expect(started.expiresAt).toBeGreaterThan(Date.now() + 60_000);
    expect(started.expiresAt).toBeLessThan(Date.now() + 24 * 60 * 60_000);
    const renewed = await sessionRoutes.refresh(started.refreshToken);
    expect(renewed.refreshToken).not.toBe(started.refreshToken);
  });

  it("refuses a request with no session by its code, and takes one with it", async () => {
    const bare = await fetch(apiUrl("relayer"));
    expect(bare.status).toBe(401);
    expect(await bare.json()).toMatchObject({ code: "unauthorized" });
    expect((await authorizedFetch(apiUrl("relayer"))).status).toBe(200);
    expect(JSON.parse(store.value!)).toMatchObject({ accessToken: expect.any(String) });
  });

  it("serves prices by symbol, with their age", async () => {
    const response = await readFetch(apiUrl("prices"));
    expect(response.status).toBe(200);
    expect(response.headers.get("age")).toMatch(/^\d+$/);
    const { prices } = (await response.json()) as { prices: Record<string, { usd: number }> };
    expect(prices.SOL.usd).toBeGreaterThan(0);
  });

  it("serves a chart as a series or says there is none, and nothing else", async () => {
    const symbol = TRADABLE_STOCKS[0].symbol;
    const response = await readFetch(apiUrl("history", `/${symbol}/1D`));
    expect([200, 404]).toContain(response.status);
    const points = await priceHistory(symbol, "1D");
    if (response.status === 200) expect(points!.length).toBeGreaterThanOrEqual(2);
    else expect(points).toBeNull();
  });

  it("reads the chain through the RPC route: the network the server says it is on", async () => {
    expect(await connection.getGenesisHash()).toBe(expectedGenesisHash());
  });

  it("refuses an RPC method outside its list by its code", async () => {
    await expect(connection.getSlot()).rejects.toMatchObject({
      name: "ApiError",
      code: "method_not_allowed",
    });
  });

  it("says whether there is a relayer, and its keys when there is", async () => {
    const pins = await relayerPins();
    if (pins) expect(pins.feePayers.length).toBeGreaterThan(0);
    else expect(pins).toBeNull();
  });
});
