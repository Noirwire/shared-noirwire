import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RENEW_BEFORE_EXPIRY_MS,
  SESSION_MAX_AGE_MS,
  createSessionKeeper,
  type ApiSession,
} from "../../src/application/apiSession.js";
import { ChainError } from "../../src/domain/chainError.js";
import { apiUrl } from "../../src/infrastructure/api.js";
import {
  authorizedFetch,
  dropSession,
  keepSessionWith,
  sessionRoutes,
} from "../../src/infrastructure/apiSession.js";
import { readFetch } from "../../src/infrastructure/readFetch.js";
import { inProcessLocks, installPlatform } from "../../src/platform.js";
import {
  fakeApi,
  installTestPlatform,
  memoryPlatform,
  memorySessionStore,
  memoryVault,
  testEnv,
  type ApiCall,
  type FakeApi,
} from "../../src/testing/index.js";

const NOW = Date.UTC(2026, 9, 4, 12);
const HOUR = 60 * 60 * 1000;

let store: ReturnType<typeof memorySessionStore>;
let api: FakeApi;
let issued: number;
/** What the session routes answer, for a test to change. */
let startAnswer: () => unknown;
let refreshAnswer: (call: ApiCall) => unknown;

const session = (n: number) => ({
  accessToken: `access-${n}`,
  refreshToken: `refresh-${n}`,
  expiresAt: Math.floor((Date.now() + HOUR) / 1000),
});
const issue = () => session((issued += 1));
const unauthorized = (code?: string) =>
  new Response(JSON.stringify(code ? { error: { code } } : {}), { status: 401 });
const kept = () => JSON.parse(store.value!) as ApiSession;
const bearerOf = (call: ApiCall) => call.headers.authorization;

/** The server: its two session routes, and whatever else a test adds. */
function serve(routes: Parameters<typeof fakeApi>[0] = {}) {
  api?.restore();
  api = fakeApi({
    "POST /v1/session": () => startAnswer(),
    "POST /v1/session/refresh": (call) => refreshAnswer(call),
    ...routes,
  });
  return api;
}

beforeEach(async () => {
  vi.useFakeTimers({ now: NOW });
  issued = 0;
  startAnswer = issue;
  refreshAnswer = issue;
  store = memorySessionStore();
  // The real keeper, over a fresh store: these tests are about it.
  installPlatform(memoryPlatform({ sessionStore: store }));
  keepSessionWith(null);
  await dropSession();
  serve();
});

afterEach(() => {
  api.restore();
  vi.useRealTimers();
  installTestPlatform();
});

describe("starting a session", () => {
  it("asks the server with an empty body and no token, and sends nothing else", async () => {
    serve({ "/v1/prices": () => ({ prices: {} }) });
    await authorizedFetch(apiUrl("prices"));

    const [start] = api.callsTo("/v1/session");
    expect(start.url.origin).toBe("https://api.noirwire.test");
    expect(start.method).toBe("POST");
    expect(start.body).toBe("{}");
    expect(start.headers).toEqual({ "content-type": "application/json" });
  });

  it("keeps it in the session store, not in the vault, and uses it from then on", async () => {
    const vault = memoryVault();
    installPlatform(memoryPlatform({ sessionStore: store, vault }));
    serve({ "/v1/prices": () => ({ prices: {} }) });

    await authorizedFetch(apiUrl("prices"));
    await authorizedFetch(apiUrl("prices"));

    expect(api.callsTo("/v1/session")).toHaveLength(1);
    expect(api.callsTo("/v1/prices").map(bearerOf)).toEqual(["Bearer access-1", "Bearer access-1"]);
    expect(kept()).toEqual({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: NOW + HOUR,
      startedAt: NOW,
    });
    expect(vault.keys()).toEqual([]);
  });

  it("reads a moment given in milliseconds as it is", async () => {
    startAnswer = () => ({ ...issue(), expiresAt: NOW + 2 * HOUR });
    serve({ "/health": () => ({ ok: true }) });
    await authorizedFetch(apiUrl("health"));
    expect(kept().expiresAt).toBe(NOW + 2 * HOUR);
  });

  it("uses the session already stored, asking nobody", async () => {
    store.value = JSON.stringify({
      accessToken: "stored",
      refreshToken: "stored-refresh",
      expiresAt: NOW + HOUR,
      startedAt: NOW - HOUR,
    });
    serve({ "/v1/prices": () => ({ prices: {} }) });
    await authorizedFetch(apiUrl("prices"));
    expect(api.callsTo("/v1/prices").map(bearerOf)).toEqual(["Bearer stored"]);
    expect(api.calls).toHaveLength(1);
  });

  it("starts over from a stored value it cannot read", async () => {
    store.value = "{not json";
    serve({ "/health": () => ({ ok: true }) });
    await authorizedFetch(apiUrl("health"));
    expect(kept().accessToken).toBe("access-1");
  });

  it("goes on in memory when the store takes and gives nothing", async () => {
    const broken = {
      get: () => Promise.reject(new Error("blocked")),
      set: () => Promise.reject(new Error("blocked")),
      remove: () => Promise.reject(new Error("blocked")),
    };
    installPlatform(memoryPlatform({ sessionStore: broken }));
    serve({ "/v1/prices": () => ({ prices: {} }) });
    await authorizedFetch(apiUrl("prices"));
    await authorizedFetch(apiUrl("prices"));
    expect(api.callsTo("/v1/session")).toHaveLength(1);
    await expect(dropSession()).resolves.toBeUndefined();
  });
});

describe("renewing before the token runs out", () => {
  beforeEach(() => serve({ "/v1/prices": () => ({ prices: {} }) }));

  it("leaves it alone until a minute before, then renews with the refresh token alone", async () => {
    await authorizedFetch(apiUrl("prices"));

    vi.setSystemTime(NOW + HOUR - RENEW_BEFORE_EXPIRY_MS - 1);
    await authorizedFetch(apiUrl("prices"));
    expect(api.callsTo("/v1/session/refresh")).toHaveLength(0);

    vi.setSystemTime(NOW + HOUR - RENEW_BEFORE_EXPIRY_MS);
    await authorizedFetch(apiUrl("prices"));
    const [renewal] = api.callsTo("/v1/session/refresh");
    expect(renewal.json).toEqual({ refreshToken: "refresh-1" });
    expect(renewal.headers).toEqual({ "content-type": "application/json" });
    expect(api.callsTo("/v1/prices").map(bearerOf)).toEqual([
      "Bearer access-1",
      "Bearer access-1",
      "Bearer access-2",
    ]);
    // A renewal is the same session: it began when it began.
    expect(kept()).toMatchObject({ accessToken: "access-2", startedAt: NOW });
  });

  it("keeps using a token that is still good when renewing early gets no answer", async () => {
    await authorizedFetch(apiUrl("prices"));
    refreshAnswer = () => new Response("down", { status: 503 });

    vi.setSystemTime(NOW + HOUR - 30_000);
    await authorizedFetch(apiUrl("prices"));
    expect(api.callsTo("/v1/prices").map(bearerOf)).toEqual(["Bearer access-1", "Bearer access-1"]);

    vi.setSystemTime(NOW + HOUR);
    await expect(authorizedFetch(apiUrl("prices"))).rejects.toMatchObject({
      code: "notAvailableNow",
    });
    expect(api.callsTo("/v1/prices")).toHaveLength(2);
  });
});

describe("a session that has run its day", () => {
  beforeEach(() => serve({ "/v1/prices": () => ({ prices: {} }) }));

  it("is a day by default, the same as the server's", () => {
    expect(SESSION_MAX_AGE_MS).toBe(24 * HOUR);
  });

  it("is replaced by a new one, not renewed, however good its token still is", async () => {
    startAnswer = () => ({ ...issue(), expiresAt: Math.floor((Date.now() + 48 * HOUR) / 1000) });
    await authorizedFetch(apiUrl("prices"));

    vi.setSystemTime(NOW + SESSION_MAX_AGE_MS - 1);
    await authorizedFetch(apiUrl("prices"));
    expect(api.callsTo("/v1/session")).toHaveLength(1);

    vi.setSystemTime(NOW + SESSION_MAX_AGE_MS);
    await authorizedFetch(apiUrl("prices"));
    expect(api.callsTo("/v1/session")).toHaveLength(2);
    expect(api.callsTo("/v1/session/refresh")).toHaveLength(0);
    expect(kept()).toMatchObject({ accessToken: "access-2", startedAt: NOW + SESSION_MAX_AGE_MS });
  });

  it("counts its age across renewals", async () => {
    await authorizedFetch(apiUrl("prices"));
    for (let hour = 1; hour < 24; hour += 1) {
      vi.setSystemTime(NOW + hour * HOUR);
      await authorizedFetch(apiUrl("prices"));
    }
    expect(api.callsTo("/v1/session")).toHaveLength(1);
    expect(api.callsTo("/v1/session/refresh")).toHaveLength(23);

    vi.setSystemTime(NOW + 24 * HOUR);
    await authorizedFetch(apiUrl("prices"));
    expect(api.callsTo("/v1/session")).toHaveLength(2);
    expect(api.callsTo("/v1/session/refresh")).toHaveLength(23);
  });

  it("takes another maximum from the environment", async () => {
    installPlatform(
      memoryPlatform({ sessionStore: store, env: testEnv({ sessionMaxAgeMs: 10 * 60_000 }) }),
    );
    await authorizedFetch(apiUrl("prices"));
    vi.setSystemTime(NOW + 10 * 60_000);
    await authorizedFetch(apiUrl("prices"));
    expect(api.callsTo("/v1/session")).toHaveLength(2);
  });

  it("does not use a stored one that is past it", async () => {
    store.value = JSON.stringify({
      accessToken: "old",
      refreshToken: "old-refresh",
      expiresAt: NOW + HOUR,
      startedAt: NOW - SESSION_MAX_AGE_MS,
    });
    await authorizedFetch(apiUrl("prices"));
    expect(api.callsTo("/v1/prices").map(bearerOf)).toEqual(["Bearer access-1"]);
    expect(api.callsTo("/v1/session/refresh")).toHaveLength(0);
  });
});

describe("callers that arrive together", () => {
  it("share one start", async () => {
    serve({ "/v1/prices": () => ({ prices: {} }) });
    await Promise.all(Array.from({ length: 12 }, () => authorizedFetch(apiUrl("prices"))));
    expect(api.callsTo("/v1/session")).toHaveLength(1);
    expect(new Set(api.callsTo("/v1/prices").map(bearerOf))).toEqual(new Set(["Bearer access-1"]));
  });

  it("share one renewal", async () => {
    serve({ "/v1/prices": () => ({ prices: {} }) });
    await authorizedFetch(apiUrl("prices"));
    vi.setSystemTime(NOW + HOUR - 1_000);
    await Promise.all(Array.from({ length: 12 }, () => authorizedFetch(apiUrl("prices"))));
    expect(api.callsTo("/v1/session/refresh")).toHaveLength(1);
  });

  it("share one renewal after the server turns them all down", async () => {
    let turnedDown = 0;
    serve({
      "/v1/prices": (call) =>
        bearerOf(call) === "Bearer access-1" && (turnedDown += 1) ? unauthorized() : { prices: {} },
    });
    const answers = await Promise.all(
      Array.from({ length: 8 }, () => authorizedFetch(apiUrl("prices"))),
    );
    expect(answers.every((answer) => answer.status === 200)).toBe(true);
    expect(turnedDown).toBe(8);
    expect(api.callsTo("/v1/session/refresh")).toHaveLength(1);
  });

  it("in two tabs make one session between them, under the platform lock", async () => {
    const locks = inProcessLocks();
    const tab = () =>
      createSessionKeeper({ gateway: () => sessionRoutes, store: () => store, locks: () => locks });
    const [first, second] = [tab(), tab()];

    expect(await Promise.all([first.token(), second.token(), first.token()])).toEqual([
      "access-1",
      "access-1",
      "access-1",
    ]);
    expect(api.callsTo("/v1/session")).toHaveLength(1);

    // Both are turned down with the same token: one renews, the other finds it done.
    expect(await Promise.all([first.renew("access-1"), second.renew("access-1")])).toEqual([
      "access-2",
      "access-2",
    ]);
    expect(api.callsTo("/v1/session/refresh")).toHaveLength(1);
  });
});

describe("a request the server turns down with a 401", () => {
  it("is made once more with a renewed session when it is a read", async () => {
    serve({
      "/v1/prices": (call) =>
        bearerOf(call) === "Bearer access-1" ? unauthorized() : { prices: { NVDAx: 1 } },
    });
    const response = await authorizedFetch(apiUrl("prices"));

    expect(await response.json()).toEqual({ prices: { NVDAx: 1 } });
    expect(api.callsTo("/v1/prices").map(bearerOf)).toEqual(["Bearer access-1", "Bearer access-2"]);
    expect(api.callsTo("/v1/session/refresh").map((call) => call.json)).toEqual([
      { refreshToken: "refresh-1" },
    ]);
  });

  it("is made once more when it builds an unsigned transaction", async () => {
    serve({
      "POST /v1/jupiter/swap/v2/order": (call) =>
        bearerOf(call) === "Bearer access-1" ? unauthorized() : { transaction: "unsigned" },
    });
    const response = await authorizedFetch(apiUrl("jupiter", "/swap/v2/order"), {
      method: "POST",
      body: "{}",
      asksAgain: true,
    });
    expect(response.status).toBe(200);
    const orders = api.callsTo("/v1/jupiter/swap/v2/order");
    expect(orders).toHaveLength(2);
    // The mark that it may be asked again is ours alone: it is not sent.
    expect(orders[1]).toMatchObject({ method: "POST", body: "{}" });
  });

  it("is made once more through readFetch", async () => {
    serve({
      "/v1/relayer": (call) =>
        bearerOf(call) === "Bearer access-1" ? unauthorized() : { available: false },
    });
    expect((await readFetch(apiUrl("relayer"))).status).toBe(200);
    expect(api.callsTo("/v1/relayer")).toHaveLength(2);
  });

  it("is given up after the one more try, as not available now", async () => {
    serve({ "/v1/prices": () => unauthorized() });
    const failure = await authorizedFetch(apiUrl("prices")).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ChainError);
    expect(failure).toMatchObject({ code: "notAvailableNow" });
    expect(api.callsTo("/v1/prices")).toHaveLength(2);
    expect(api.callsTo("/v1/session/refresh")).toHaveLength(1);
  });

  it("is never made again when it hands over something signed", async () => {
    serve({ "POST /v1/jupiter/swap/v2/execute": () => unauthorized() });
    const failure = await authorizedFetch(apiUrl("jupiter", "/swap/v2/execute"), {
      method: "POST",
      body: JSON.stringify({ signedTransaction: "AQID" }),
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ChainError);
    expect(failure).toMatchObject({ code: "notAvailableNow" });
    expect(api.callsTo("/v1/jupiter/swap/v2/execute")).toHaveLength(1);
    // The session is put right all the same, for the person's next attempt.
    await vi.waitFor(() => expect(kept().accessToken).toBe("access-2"));
  });

  it("starts a new session when the server says this one has run its time", async () => {
    serve({
      "/v1/prices": (call) =>
        bearerOf(call) === "Bearer access-1" ? unauthorized("session_expired") : { prices: {} },
    });
    expect((await authorizedFetch(apiUrl("prices"))).status).toBe(200);
    expect(api.callsTo("/v1/session/refresh")).toHaveLength(0);
    expect(api.callsTo("/v1/session")).toHaveLength(2);
    expect(kept()).toMatchObject({ accessToken: "access-2", startedAt: NOW });
  });

  it.each([{ code: "session_expired" }, { error: "session_expired" }])(
    "reads that code as %j too",
    async (body) => {
      serve({
        "/v1/prices": (call) =>
          bearerOf(call) === "Bearer access-1"
            ? new Response(JSON.stringify(body), { status: 401 })
            : { prices: {} },
      });
      await authorizedFetch(apiUrl("prices"));
      expect(api.callsTo("/v1/session")).toHaveLength(2);
    },
  );

  it("starts a new session when the renewal is refused", async () => {
    refreshAnswer = () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    serve({
      "/v1/prices": (call) =>
        bearerOf(call) === "Bearer access-1" ? unauthorized() : { prices: {} },
    });
    expect((await authorizedFetch(apiUrl("prices"))).status).toBe(200);
    expect(api.callsTo("/v1/session/refresh")).toHaveLength(1);
    expect(api.callsTo("/v1/session")).toHaveLength(2);
    expect(api.callsTo("/v1/prices").map(bearerOf)).toEqual(["Bearer access-1", "Bearer access-2"]);
  });
});

describe("when no session can be had", () => {
  it.each([
    ["never answers", () => Promise.reject(new TypeError("fetch failed"))],
    ["is down", () => new Response("down", { status: 503 })],
    ["is busy", () => new Response("slow down", { status: 429 })],
    ["refuses", () => new Response("no", { status: 403 })],
    ["answers without a session", () => ({ accessToken: "only" })],
  ])("fails as not available now when the server %s, and sends nothing", async (_how, answer) => {
    startAnswer = answer;
    serve({ "/v1/prices": () => ({ prices: {} }) });
    const failure = await authorizedFetch(apiUrl("prices")).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ChainError);
    expect(failure).toMatchObject({ code: "notAvailableNow" });
    expect(api.callsTo("/v1/prices")).toHaveLength(0);
    expect(store.value).toBeNull();
  });

  it("is not asked for again and again by a read's own retries", async () => {
    startAnswer = () => new Response("down", { status: 503 });
    await expect(readFetch(apiUrl("prices"))).rejects.toMatchObject({ code: "notAvailableNow" });
    expect(api.callsTo("/v1/session")).toHaveLength(1);
  });

  it("works again on the next request once the server is back", async () => {
    startAnswer = () => new Response("down", { status: 503 });
    serve({ "/v1/prices": () => ({ prices: {} }) });
    await expect(authorizedFetch(apiUrl("prices"))).rejects.toMatchObject({
      code: "notAvailableNow",
    });
    startAnswer = issue;
    expect((await authorizedFetch(apiUrl("prices"))).status).toBe(200);
  });
});

describe("dropping the session", () => {
  it("forgets it here and in storage, and the next request starts a new one", async () => {
    serve({ "/v1/prices": () => ({ prices: {} }) });
    await authorizedFetch(apiUrl("prices"));
    await dropSession();
    expect(store.value).toBeNull();

    await authorizedFetch(apiUrl("prices"));
    expect(api.callsTo("/v1/session")).toHaveLength(2);
    expect(api.callsTo("/v1/session/refresh")).toHaveLength(0);
    expect(api.callsTo("/v1/prices").map(bearerOf)).toEqual(["Bearer access-1", "Bearer access-2"]);
  });

  it("does not keep a renewal that finishes after it", async () => {
    serve({ "/v1/prices": () => ({ prices: {} }) });
    await authorizedFetch(apiUrl("prices"));
    let answerRenewal!: () => void;
    refreshAnswer = () =>
      new Promise((resolve) => {
        answerRenewal = () => resolve(issue());
      });

    vi.setSystemTime(NOW + HOUR - 1_000);
    const underWay = authorizedFetch(apiUrl("prices"));
    await vi.waitFor(() => expect(api.callsTo("/v1/session/refresh")).toHaveLength(1));
    await dropSession();
    answerRenewal();
    await underWay;

    expect(store.value).toBeNull();
    await authorizedFetch(apiUrl("prices"));
    expect(api.callsTo("/v1/session")).toHaveLength(2);
  });
});
