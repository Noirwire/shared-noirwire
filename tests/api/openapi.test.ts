import { existsSync, readFileSync } from "node:fs";
import { Keypair, PublicKey } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_ERRORS, ApiError } from "../../src/domain/apiError.js";
import { ChainError, UnknownOutcomeError } from "../../src/domain/chainError.js";
import { dropSession, keepSessionWith } from "../../src/infrastructure/apiSession.js";
import { priceHistory } from "../../src/infrastructure/prices/history.js";
import { livePrice, watchLivePrices } from "../../src/infrastructure/prices/live.js";
import { connection } from "../../src/infrastructure/solana/client.js";
import { jupiterLend } from "../../src/infrastructure/solana/earn/jupiterLend.js";
import {
  nudgeSettlement,
  submitTransfer,
} from "../../src/infrastructure/solana/private-payments.js";
import {
  quoteRelayed,
  relayerPins,
  resetRelayerPins,
} from "../../src/infrastructure/solana/relayer.js";
import { settle } from "../../src/infrastructure/solana/pending.js";
import { profileMirror } from "../../src/infrastructure/solana/profile.js";
import { PROFILE_PROGRAM } from "../../src/infrastructure/solana/profileProgram.js";
import { rewardsApi } from "../../src/infrastructure/solana/rewards.js";
import { sendAndSettle } from "../../src/infrastructure/solana/settlement.js";
import { executeJupiterSwap, jupiterVenue } from "../../src/infrastructure/solana/swap/jupiter.js";
import type { SwapQuote } from "../../src/infrastructure/solana/swap/types.js";
import { installPlatform } from "../../src/platform.js";
import {
  fakeApi,
  installTestPlatform,
  memoryPlatform,
  unsignedTransaction,
  type ApiCall,
  type FakeApi,
} from "../../src/testing/index.js";

/**
 * This package's clients, held to the server's own description of itself:
 * the OpenAPI file the server's repository writes from its code. Every
 * request a client makes must be one the file documents, and every answer
 * the file documents must end as the typed result a screen can word.
 *
 * The file is another repository's, so its path comes from the environment:
 *
 *   NOIRWIRE_OPENAPI=../api-noirwire/docs/openapi.json npm run test:api
 *
 * Without it the suite is skipped, and says so.
 */
const FILE = process.env.NOIRWIRE_OPENAPI?.trim();

type Schema = {
  type?: string;
  description?: string;
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean | Schema;
  enum?: unknown[];
  oneOf?: Schema[];
  maxLength?: number;
  minItems?: number;
  pattern?: string;
  nullable?: boolean;
  items?: Schema;
};
type Content = { schema?: Schema; examples?: Record<string, { value: unknown }> };
type Operation = {
  description?: string;
  parameters?: { name: string; in: string; schema?: Schema }[];
  security?: unknown[];
  requestBody?: { content: Record<string, Content> };
  responses: Record<string, { content?: Record<string, Content> }>;
};
type Spec = { paths: Record<string, Record<string, Operation>> };

const spec: Spec | null =
  FILE && existsSync(FILE) ? (JSON.parse(readFileSync(FILE, "utf8")) as Spec) : null;

/** Why `value` is not what `schema` describes, or nothing when it is. Covers what the file uses. */
function problems(value: unknown, schema: Schema, at = "body"): string[] {
  if (schema.oneOf) {
    return schema.oneOf.some((option) => problems(value, option, at).length === 0)
      ? []
      : [`${at} matches none of its alternatives`];
  }
  if (value === null && schema.nullable) return [];
  const found: string[] = [];
  const type = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
  const wanted = schema.type === "integer" ? "number" : schema.type;
  if (wanted && type !== wanted) return [`${at} is ${type}, not ${schema.type}`];
  if (schema.type === "integer" && !Number.isInteger(value)) found.push(`${at} is not whole`);
  if (schema.enum && !schema.enum.includes(value)) found.push(`${at} is not one of the listed`);
  if (typeof value === "string" && schema.maxLength && value.length > schema.maxLength) {
    found.push(`${at} is longer than ${schema.maxLength}`);
  }
  if (typeof value === "string" && schema.pattern && !new RegExp(schema.pattern).test(value)) {
    found.push(`${at} does not match ${schema.pattern}`);
  }
  if (type === "array" && schema.minItems && (value as unknown[]).length < schema.minItems) {
    found.push(`${at} has fewer than ${schema.minItems} items`);
  }
  if (type === "array" && schema.items) {
    (value as unknown[]).forEach((item, index) =>
      found.push(...problems(item, schema.items!, `${at}[${index}]`)),
    );
  }
  if (type === "object") {
    const fields = value as Record<string, unknown>;
    for (const name of schema.required ?? []) {
      if (!(name in fields)) found.push(`${at}.${name} is missing`);
    }
    for (const [name, field] of Object.entries(fields)) {
      const known = schema.properties?.[name];
      const others = schema.additionalProperties;
      if (known) found.push(...problems(field, known, `${at}.${name}`));
      else if (others === false) found.push(`${at}.${name} is not allowed`);
      else if (typeof others === "object") found.push(...problems(field, others, `${at}.${name}`));
    }
  }
  return found;
}

/** The documented operation a request is for, and what its `{path}` stood for. */
function operationFor(method: string, path: string) {
  const templates = Object.keys(spec!.paths).sort(
    (a, b) => Number(a.includes("{")) - Number(b.includes("{")),
  );
  for (const template of templates) {
    const pattern = template
      .replace(/\{path\}/g, "(?<rest>.+)")
      .replace(/\{[^}]+\}/g, "[^/]+")
      .replace(/\//g, "\\/");
    const match = new RegExp(`^${pattern}$`).exec(path);
    const operation = spec!.paths[template][method.toLowerCase()];
    if (match && operation) return { template, operation, rest: match.groups?.rest };
  }
  return null;
}

const jsonOf = (content?: Record<string, Content>) => content?.["application/json"];

/** Everything a documented answer says: its status and each example body. */
function documented(template: string, method: string) {
  const operation = spec!.paths[template][method];
  return Object.entries(operation.responses).flatMap(([status, response]) => {
    const examples = Object.values(jsonOf(response.content)?.examples ?? {});
    return examples.length > 0
      ? examples.map((example) => ({ status: Number(status), body: example.value }))
      : [{ status: Number(status), body: null }];
  });
}

/** The codes a response of `status` may carry, as its schema lists them. */
const codesOf = (response: { content?: Record<string, Content> }) =>
  (jsonOf(response.content)?.schema?.properties?.code?.enum ?? []) as string[];

/**
 * Every error an operation documents: each code its schema lists for each
 * failing status, as the body the server would write. Taken from the lists,
 * not the examples, so a code the file adds is run through its client the
 * same day.
 */
const errorsOf = (template: string, method: string) =>
  Object.entries(spec!.paths[template][method].responses)
    .filter(([status]) => Number(status) >= 400)
    .flatMap(([status, response]) =>
      codesOf(response).map(
        (code) => [code, Number(status), { code, error: "A sentence nobody here reads." }] as const,
      ),
    );

/** The sub-paths a `{path}` operation lists. */
const pathsOf = (template: string, method: string) =>
  (spec!.paths[template][method].parameters?.find((entry) => entry.name === "path")?.schema?.enum ??
    []) as string[];

const answering = (status: number, body: unknown, headers?: Record<string, string>) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers });

/** Runs `work` to its end with every pause skipped, and says how it ended. */
async function ended<T>(work: Promise<T>): Promise<{ value: T } | { error: unknown }> {
  const outcome = work.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.runAllTimersAsync();
  return outcome;
}

const failure = async (work: Promise<unknown>) => {
  const outcome = await ended(work);
  return "error" in outcome ? outcome.error : null;
};

const rpc = (call: ApiCall, result: unknown) => ({
  jsonrpc: "2.0",
  id: (call.json as { id: string }).id,
  result,
});

/** A chain that has seen nothing and can still land a transaction, for the settling after a submit. */
function quietChain(call: ApiCall) {
  const { method } = call.json as { method: string };
  if (method === "getBlockHeight") return rpc(call, 900);
  if (method === "getLatestBlockhash") {
    return rpc(call, {
      context: { slot: 1 },
      value: { blockhash: PublicKey.default.toBase58(), lastValidBlockHeight: 1_000 },
    });
  }
  if (method === "getSignatureStatuses") return rpc(call, { context: { slot: 1 }, value: [null] });
  return rpc(call, null);
}

function signed() {
  const signer = Keypair.generate();
  const transaction = unsignedTransaction(signer);
  transaction.sign([signer]);
  return transaction;
}

const FEE_PAYER = Keypair.generate().publicKey;
const PAYMENT_WALLET = Keypair.generate().publicKey;
const PINS = {
  available: true,
  feePayers: [FEE_PAYER.toBase58()],
  paymentWallet: PAYMENT_WALLET.toBase58(),
  accountCreation: true,
};
const QUOTE = { raw: { requestId: "request-1", lastValidBlockHeight: 1_000 } } as SwapQuote;
const ORDER = {
  inputMint: Keypair.generate().publicKey,
  outputMint: Keypair.generate().publicKey,
  amount: 10_000_000n,
  slippageBps: 50,
};
const VISIBLE = { hidden: () => false, subscribe: () => () => undefined };

/** The profile routes as a server that keeps profiles answers them, with nothing stored yet. */
const PROFILE_ROUTES = {
  "GET /v1/profile/config": () => ({
    enabled: true,
    programId: PROFILE_PROGRAM.toBase58(),
    gate: FEE_PAYER.toBase58(),
    maxDataLen: 2048,
  }),
  "POST /v1/profile/challenge": () => ({ challenge: "a challenge to sign" }),
  "POST /v1/profile/session": () => ({ token: "a-read-token", expiresAt: 1_790_000_000 }),
  "POST /v1/profile/read": () => ({ data: null }),
  "POST /v1/profile/blockhash": () => ({
    blockhash: PublicKey.default.toBase58(),
    lastValidBlockHeight: 1_000,
  }),
  "POST /v1/profile/submit": () => ({ signature: "5".repeat(88) }),
};
const PROFILE_SENDING = { keepOut: [], stillUnlocked: () => true };

/** A member outside the season, as the server writes one. */
const REWARDS_STATE = {
  code: "K7M2QX9R",
  codeActive: true,
  invited: 2,
  wasInvited: false,
  points: "1250",
  week: null,
};

/** The rewards routes as a server that runs rewards answers them. */
const REWARDS_ROUTES = {
  "GET /v1/rewards/config": () => ({
    enabled: true,
    seasonStart: "2026-10-19T00:00:00.000Z",
    seasonWeeks: 12,
    weeklyPoints: 100_000,
  }),
  "POST /v1/rewards/join": () => REWARDS_STATE,
  "POST /v1/rewards/state": () => REWARDS_STATE,
  "POST /v1/rewards/claims": () => ({
    credited: true,
    feeMicroUsdc: "61000",
    state: REWARDS_STATE,
  }),
};
const TRADE_ID = "5".repeat(88);

/** A relayed action with nothing in it but its payment: enough to be priced. */
const emptyDraft = async () => ({
  instructions: [],
  intent: { kind: "open" as const },
  opens: null,
  mints: [],
  limits: () => ({}) as never,
});

let api: FakeApi | undefined;

if (!spec) {
  console.info(
    FILE
      ? `The API contract suite is skipped: no file at NOIRWIRE_OPENAPI (${FILE}).`
      : "The API contract suite is skipped: set NOIRWIRE_OPENAPI to the path of the API's docs/openapi.json.",
  );
}

describe.skipIf(!spec)("the server's OpenAPI file (NOIRWIRE_OPENAPI)", () => {
  // Each test starts an hour after the last, so the prices one of them read are long stale in the next.
  let now = Date.UTC(2026, 9, 4, 12);

  beforeEach(() => {
    now += 60 * 60_000;
    vi.useFakeTimers({ now });
    installTestPlatform();
    resetRelayerPins();
  });

  afterEach(() => {
    api?.restore();
    api = undefined;
    vi.restoreAllMocks();
    vi.useRealTimers();
    installTestPlatform();
  });

  describe("its error codes", () => {
    it("are exactly the ones this package knows, each with the status it knows", () => {
      const listed = new Map<string, Set<number>>();
      for (const [template, operations] of Object.entries(spec!.paths)) {
        for (const [method, operation] of Object.entries(operations)) {
          for (const [status, response] of Object.entries(operation.responses)) {
            if (Number(status) < 400) continue;
            const where = `${method} ${template} ${status}`;
            const codes = codesOf(response);
            // An error with no list of codes is one no client can be held to.
            expect(codes.length, `${where} lists no codes`).toBeGreaterThan(0);
            const schema = jsonOf(response.content)!.schema!;
            expect(schema.required?.slice().sort(), where).toEqual(["code", "error"]);
            for (const code of codes) {
              listed.set(code, (listed.get(code) ?? new Set()).add(Number(status)));
            }
            for (const example of Object.values(jsonOf(response.content)?.examples ?? {})) {
              expect(problems(example.value, schema), where).toEqual([]);
            }
          }
        }
      }
      // Both ways: a code the server added is unknown here, and one it dropped is dead here.
      expect([...listed.keys()].sort()).toEqual(Object.keys(API_ERRORS).sort());
      for (const [code, statuses] of listed) {
        expect([...statuses], code).toEqual([API_ERRORS[code as keyof typeof API_ERRORS].status]);
      }
    });

    it("are all worded for a person by what the app was doing, an unknown one included", async () => {
      const { failedOf } = await import("../../src/application/actions/common.js");
      const { failureMessage } = await import("../../src/presentation/actionResult.js");
      for (const code of [...Object.keys(API_ERRORS), "a_code_from_the_future"]) {
        const status = API_ERRORS[code as keyof typeof API_ERRORS]?.status ?? 418;
        const said = failureMessage(failedOf("earnFailed", new ApiError(code, status)));
        expect(said, code).toBe("This did not go through. Nothing was moved. Try again.");
      }
    });

    it("never offer a 401 for anything but the caller's own session", () => {
      for (const [template, operations] of Object.entries(spec!.paths)) {
        for (const method of Object.keys(operations)) {
          for (const [code, status] of errorsOf(template, method)) {
            if (status === 401)
              expect(code).toMatch(/^(unauthorized|session_expired|session_invalid)$/);
          }
        }
      }
    });
  });

  describe("every request this package makes", () => {
    /** Each client run once against a server that answers well, and everything it asked. */
    async function everyRequest(): Promise<ApiCall[]> {
      const session = () => ({ accessToken: "a", refreshToken: "r", expiresAt: 1_790_000_000 });
      api = fakeApi({
        "POST /v1/session": session,
        "POST /v1/session/refresh": session,
        "GET /v1/prices": () => ({ prices: { SOL: { usd: 150, change24h: 1 } } }),
        "GET /v1/history/*": () => ({ points: [1, 2, 3] }),
        "GET /v1/relayer": () => PINS,
        "POST /v1/relayer": (call) =>
          (call.json as { method: string }).method === "getPayerSigner"
            ? { result: { signer_address: PINS.feePayers[0], payment_address: PINS.paymentWallet } }
            : { result: { fee_in_token: 20_000 } },
        "POST /v1/rpc": quietChain,
        "GET /v1/jupiter/*": () => [],
        "POST /v1/jupiter/*": () => ({}),
        "POST /v1/private-payments/*": () => ({}),
        ...PROFILE_ROUTES,
        ...REWARDS_ROUTES,
      });

      // The real session, so its own two requests are among those checked.
      installPlatform(memoryPlatform());
      keepSessionWith(null);
      await dropSession();
      const { authorizedFetch } = await import("../../src/infrastructure/apiSession.js");
      const { apiUrl } = await import("../../src/infrastructure/api.js");
      await authorizedFetch(apiUrl("health"), {}).catch(() => undefined);
      vi.setSystemTime(Date.now() + 59 * 60_000 + 30_000);

      const stop = watchLivePrices(VISIBLE);
      await vi.advanceTimersByTimeAsync(1_000);
      stop();
      const owner = Keypair.generate().publicKey;
      await ended(
        Promise.allSettled([
          priceHistory("NVDAx", "1W"),
          relayerPins(),
          quoteRelayed(owner, emptyDraft),
          connection.getGenesisHash(),
          connection.getBalance(owner),
          connection.getAccountInfo(owner),
          connection.getMultipleAccountsInfo([owner]),
          connection.getLatestBlockhash("confirmed"),
          connection.getSignatureStatus("5".repeat(88), { searchTransactionHistory: true }),
          connection.getBlockHeight("finalized"),
          connection.sendRawTransaction(signed().serialize()),
          connection.simulateTransaction(signed(), { sigVerify: false }),
          jupiterLend.rate(),
          jupiterVenue(owner).quote(ORDER),
          executeJupiterSwap(QUOTE, signed()),
          submitTransfer({ transactionBase64: "AQID", sendTo: "base", cluster: "devnet" }, null),
          nudgeSettlement(Keypair.generate().publicKey),
          (async () => {
            const profileOwner = Keypair.generate();
            await profileMirror.limits();
            await profileMirror.read(profileOwner, () => true);
            // The largest record a deployment plans for: the request must still be one the file allows.
            const record = new Uint8Array(2048);
            await profileMirror.create(profileOwner, record, PROFILE_SENDING);
            await profileMirror.write(profileOwner, 1n, record, PROFILE_SENDING);
          })(),
          (async () => {
            const member = Keypair.generate();
            const stillUnlocked = () => true;
            await rewardsApi.config();
            await rewardsApi.join(member, "K7M2QX9R", stillUnlocked);
            await rewardsApi.state(member, stillUnlocked);
            await rewardsApi.claim({
              member,
              portfolio: Keypair.generate(),
              transaction: TRADE_ID,
              stillUnlocked,
            });
          })(),
        ]),
      );
      return api.calls.filter((call) => call.path !== "/health");
    }

    it("is one the file documents: its method, path, session, query and body", async () => {
      const calls = await everyRequest();
      const asked = new Set<string>();
      for (const call of calls) {
        const what = `${call.method} ${call.path}`;
        const found = operationFor(call.method, call.path);
        expect(found, `${what} is not a documented route`).not.toBeNull();
        const { operation, rest, template } = found!;
        asked.add(`${call.method} ${template}`);

        expect(call.url.search, `${what} carries a query string`).toBe("");
        const needsSession = (operation.security ?? []).length > 0;
        expect(Boolean(call.headers.authorization), `${what} and its session`).toBe(needsSession);
        if (rest) {
          expect(
            pathsOf(template, call.method.toLowerCase()),
            `${what} is not a listed path`,
          ).toContain(rest);
        }
        const schema = jsonOf(operation.requestBody?.content)?.schema;
        if (schema) {
          expect(call.headers["content-type"], what).toMatch(/^application\/json/);
          expect(problems(call.json, schema), what).toEqual([]);
        } else {
          expect(call.body, `${what} takes no body`).toBeNull();
        }
      }
      // Every route the file documents is one a client here asks, but the two an app asks itself.
      const routes = Object.entries(spec!.paths).flatMap(([template, operations]) =>
        Object.keys(operations).map((method) => `${method.toUpperCase()} ${template}`),
      );
      expect(routes.filter((route) => !asked.has(route)).sort()).toEqual([
        "GET /health",
        "POST /v1/events",
      ]);
    });

    it("asks the RPC for exactly the methods the server allows: none it refuses, none it allows for nothing", () => {
      const allowed = jsonOf(spec!.paths["/v1/rpc"].post.requestBody?.content)?.schema?.properties
        ?.method.enum;
      // What this package's connection calls come to on the wire.
      const used = [
        "getAccountInfo",
        "getBalance",
        "getBlockHeight",
        "getFeeForMessage",
        "getGenesisHash",
        "getLatestBlockhash",
        "getMinimumBalanceForRentExemption",
        "getMultipleAccounts",
        "getSignatureStatuses",
        "getSignaturesForAddress",
        "getTokenAccountsByOwner",
        "getTransaction",
        "isBlockhashValid",
        "sendTransaction",
        "simulateTransaction",
      ];
      expect([...(allowed as string[])].sort()).toEqual(used);
    });

    it("looks for a transaction with no recorded id the way the server allows: one address, a stated limit of 50 at most", async () => {
      api = fakeApi({
        "POST /v1/rpc": (call) => {
          const { method } = call.json as { method: string };
          if (method === "getBlockHeight") return rpc(call, 2_000);
          return rpc(call, []);
        },
      });
      const signer = Keypair.generate().publicKey.toBase58();
      expect(await settle({ lastValidBlockHeight: 1_000, blockhash: "hash", signer })).toBe(
        "expired",
      );
      const search = api.calls
        .map((call) => call.json as { method: string; params: [string, { limit: number }] })
        .find((call) => call.method === "getSignaturesForAddress")!;
      expect(search.params[0]).toBe(signer);
      expect(search.params[1].limit).toBeGreaterThanOrEqual(1);
      expect(search.params[1].limit).toBeLessThanOrEqual(50);
      expect(
        spec!.paths["/v1/rpc"].post.requestBody?.content["application/json"].schema?.properties
          ?.params.description,
      ).toContain("limit");
    });

    it("uses exactly the venue and private-payment paths the server lists", () => {
      expect(pathsOf("/v1/jupiter/{path}", "post").sort()).toEqual([
        "lend/v1/earn/deposit",
        "lend/v1/earn/deposit-instructions",
        "lend/v1/earn/earnings",
        "lend/v1/earn/withdraw",
        "lend/v1/earn/withdraw-instructions",
        "swap/v2/execute",
        "swap/v2/order",
      ]);
      expect(pathsOf("/v1/jupiter/{path}", "get")).toEqual(["lend/v1/earn/tokens"]);
      expect(pathsOf("/v1/private-payments/{path}", "post").sort()).toEqual([
        "v1/spl/transfer",
        "v1/spl/transfer-queue/ensure-crank",
        "v1/transaction/send",
      ]);
    });

    it("has a test here for every operation the file documents, and no other", () => {
      const documentedHere = Object.entries(spec!.paths)
        .flatMap(([template, operations]) =>
          Object.keys(operations).map((method) => `${method.toUpperCase()} ${template}`),
        )
        .sort();
      expect(documentedHere).toEqual([
        "GET /health",
        "GET /v1/history/{symbol}/{range}",
        "GET /v1/jupiter/{path}",
        "GET /v1/prices",
        "GET /v1/profile/config",
        "GET /v1/relayer",
        "GET /v1/rewards/config",
        "POST /v1/events",
        "POST /v1/jupiter/{path}",
        "POST /v1/private-payments/{path}",
        "POST /v1/profile/blockhash",
        "POST /v1/profile/challenge",
        "POST /v1/profile/read",
        "POST /v1/profile/session",
        "POST /v1/profile/submit",
        "POST /v1/relayer",
        "POST /v1/rewards/claims",
        "POST /v1/rewards/join",
        "POST /v1/rewards/state",
        "POST /v1/rpc",
        "POST /v1/session",
        "POST /v1/session/refresh",
      ]);
    });
  });

  describe("every documented success", () => {
    it("has a schema its own examples fit, so a client can be held to it", () => {
      for (const [template, operations] of Object.entries(spec!.paths)) {
        for (const [method, operation] of Object.entries(operations)) {
          for (const [status, response] of Object.entries(operation.responses)) {
            if (Number(status) >= 300 || !response.content) continue;
            const { schema, examples } = jsonOf(response.content)!;
            const where = `${method} ${template} ${status}`;
            expect(schema?.type ?? schema?.oneOf, `${where} has no schema`).toBeDefined();
            for (const example of Object.values(examples ?? {})) {
              expect(problems(example.value, schema!), where).toEqual([]);
            }
          }
        }
      }
    });

    it("names every field this package reads from an answer the server writes itself", () => {
      const fields = (template: string, method: string) =>
        jsonOf(spec!.paths[template][method].responses["200"].content)!.schema!;
      const session = fields("/v1/session", "post");
      expect(session.required?.slice().sort()).toEqual([
        "accessToken",
        "expiresAt",
        "refreshToken",
      ]);
      expect(fields("/v1/session/refresh", "post").required?.slice().sort()).toEqual(
        session.required?.slice().sort(),
      );
      const price = fields("/v1/prices", "get").properties!.prices.additionalProperties as Schema;
      expect(price.required?.slice().sort()).toEqual(["change24h", "usd"]);
      expect(fields("/v1/history/{symbol}/{range}", "get").properties!.points.items?.type).toBe(
        "number",
      );
      expect(Object.keys(fields("/v1/relayer", "get").properties!).sort()).toEqual([
        "accountCreation",
        "available",
        "feePayers",
        "paymentWallet",
      ]);
      const answers = fields("/v1/relayer", "post").oneOf!;
      const read = (wanted: string[]) =>
        answers.some((answer) => {
          const result = answer.properties?.result?.properties ?? answer.properties ?? {};
          return wanted.every((name) => name in result);
        });
      expect(read(["signer_address", "payment_address"])).toBe(true);
      expect(read(["fee_in_token"])).toBe(true);
      expect(read(["transaction", "signature"])).toBe(true);
      const order = fields("/v1/jupiter/{path}", "post").properties!;
      for (const name of [
        "transaction",
        "requestId",
        "inAmount",
        "outAmount",
        "status",
        "signature",
      ]) {
        expect(order, name).toHaveProperty(name);
      }
    });

    it("is read by its client as the file gives it: a session, prices, a chart, the relayer's keys", async () => {
      const example = (template: string, method: string) =>
        documented(template, method).find((answer) => answer.status === 200)!.body;
      const session = example("/v1/session", "post") as { accessToken: string; expiresAt: number };
      api = fakeApi({
        "POST /v1/session": () => session,
        "/v1/history/*": () => answering(200, example("/v1/history/{symbol}/{range}", "get")),
        "/v1/relayer": () => answering(200, example("/v1/relayer", "get")),
      });
      const { sessionRoutes } = await import("../../src/infrastructure/apiSession.js");
      expect(await sessionRoutes.start()).toMatchObject({
        accessToken: session.accessToken,
        expiresAt: session.expiresAt * 1000,
      });
      const points = (example("/v1/history/{symbol}/{range}", "get") as { points: number[] })
        .points;
      expect(await priceHistory("EXAMPLE", "1M")).toEqual(points);
      const keys = example("/v1/relayer", "get") as { feePayers: string[]; paymentWallet: string };
      const pins = await relayerPins();
      expect(pins?.feePayers.map((key) => key.toBase58())).toEqual(keys.feePayers);
      expect(pins?.paymentWallet.toBase58()).toBe(keys.paymentWallet);
    });
  });

  describe("every documented answer to a read", () => {
    const expectRefused = (error: unknown, code: string, status: number) => {
      if (status === 401) {
        expect(error).toBeInstanceOf(ChainError);
        expect(error).toMatchObject({ code: "notAvailableNow" });
      } else {
        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({ code, status });
      }
    };

    it.each(spec ? errorsOf("/v1/prices", "get") : [])(
      "prices: %s (%i) shows no price, and throws nothing",
      async (_code, status, body) => {
        api = fakeApi({ "/v1/prices": () => answering(status, body) });
        const stop = watchLivePrices(VISIBLE);
        await vi.advanceTimersByTimeAsync(5_000);
        stop();
        expect(api.calls.length).toBeGreaterThan(0);
        expect(livePrice("SOL")).toBeUndefined();
      },
    );

    it("prices: the documented answer is read, aged by its Age header", async () => {
      const [ok] = documented("/v1/prices", "get");
      vi.setSystemTime(Date.now() + 10 * 60_000);
      api = fakeApi({ "/v1/prices": () => answering(200, ok.body, { Age: "100" }) });
      const stop = watchLivePrices(VISIBLE);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(livePrice("SOL")).toEqual({ usd: 150.12, change24h: -1.2 });
      // Two minutes is as old as a price may be: twenty seconds more and it is no longer shown.
      vi.setSystemTime(Date.now() + 20_000);
      expect(livePrice("SOL")).toBeUndefined();
      stop();
    });

    it.each(spec ? documented("/v1/history/{symbol}/{range}", "get") : [])(
      "history: $status is a series or no chart, never an error",
      async ({ status, body }) => {
        api = fakeApi({ "/v1/history/*": () => answering(status, body) });
        const symbol = `T${status}${(body as { code?: string }).code ?? ""}`;
        const outcome = await ended(priceHistory(symbol, "1D"));
        expect(outcome).toEqual({ value: status === 200 ? [761.2, 762.9, 764.15] : null });
      },
    );

    it.each(spec ? documented("/v1/relayer", "get") : [])(
      "the relayer's keys: $status is keys or no relayer, never an error",
      async ({ status, body }) => {
        api = fakeApi({ "/v1/relayer": () => answering(status, body) });
        const outcome = await ended(relayerPins());
        expect(outcome).toHaveProperty("value");
        const pins = (outcome as { value: Awaited<ReturnType<typeof relayerPins>> }).value;
        const available = status === 200 && (body as { available: boolean }).available;
        if (available) {
          expect(pins?.feePayers.map((key) => key.toBase58())).toEqual(
            (body as { feePayers: string[] }).feePayers,
          );
        } else {
          expect(pins).toBeNull();
        }
      },
    );

    it.each(spec ? errorsOf("/v1/rpc", "post") : [])(
      "an RPC read: %s (%i) is thrown by its code",
      async (code, status, body) => {
        api = fakeApi({ "POST /v1/rpc": () => answering(status, body) });
        expectRefused(await failure(connection.getGenesisHash()), code, status);
      },
    );

    it.each(spec ? errorsOf("/v1/jupiter/{path}", "get") : [])(
      "the lending rate: %s (%i) is thrown by its code",
      async (code, status, body) => {
        api = fakeApi({ "/v1/jupiter/*": () => answering(status, body) });
        expectRefused(await failure(jupiterLend.rate()), code, status);
      },
    );

    it.each(spec ? errorsOf("/v1/jupiter/{path}", "post") : [])(
      "a swap order: %s (%i) is thrown by its code, and its sentence is never the message",
      async (code, status, body) => {
        api = fakeApi({ "POST /v1/jupiter/*": () => answering(status, body) });
        const error = await failure(jupiterVenue(Keypair.generate().publicKey).quote(ORDER));
        expectRefused(error, code, status);
        expect((error as Error).message).not.toContain((body as { error: string }).error);
      },
    );

    it.each(spec ? errorsOf("/v1/relayer", "post") : [])(
      "a relayer price: %s (%i) is never a price",
      async (_code, status, body) => {
        api = fakeApi({
          "GET /v1/relayer": () => PINS,
          "POST /v1/rpc": quietChain,
          "POST /v1/relayer": (call) =>
            (call.json as { method: string }).method === "getPayerSigner" &&
            !(call.json as { params?: { not?: string[] } }).params?.not
              ? {
                  result: {
                    signer_address: PINS.feePayers[0],
                    payment_address: PINS.paymentWallet,
                  },
                }
              : answering(status, body),
        });
        const error = await failure(quoteRelayed(Keypair.generate().publicKey, emptyDraft));
        expect(error).toBeInstanceOf(Error);
        if (status === 401) expect(error).toMatchObject({ code: "notAvailableNow" });
      },
    );
  });

  describe("every documented answer to a signed submit, short of a clear success", () => {
    const submits = [
      {
        name: "a transaction sent over RPC",
        errors: () => errorsOf("/v1/rpc", "post"),
        route: "POST /v1/rpc",
        path: "/v1/rpc",
        run: () => sendAndSettle(signed(), "5".repeat(88), 1_000, () => new Error("failed")),
      },
      {
        name: "a swap handed to the venue",
        errors: () => errorsOf("/v1/jupiter/{path}", "post"),
        route: "POST /v1/jupiter/swap/v2/execute",
        path: "/v1/jupiter/swap/v2/execute",
        run: () => executeJupiterSwap(QUOTE, signed()),
      },
      {
        name: "a private transfer handed to the service",
        errors: () => errorsOf("/v1/private-payments/{path}", "post"),
        route: "POST /v1/private-payments/v1/transaction/send",
        path: "/v1/private-payments/v1/transaction/send",
        run: () => submitTransfer({ transactionBase64: "AQID" }, "5".repeat(88)),
      },
    ];

    for (const submit of submits) {
      it.each(spec ? submit.errors() : [])(
        `${submit.name}: %s (%i) is an unknown outcome, sent once, never "nothing was sent"`,
        async (_code, status, body) => {
          const isSend = (call: ApiCall) =>
            call.path !== "/v1/rpc" ||
            (call.json as { method: string }).method === "sendTransaction";
          api = fakeApi({
            "POST /v1/rpc": (call) => (isSend(call) ? answering(status, body) : quietChain(call)),
            [submit.route]: () => answering(status, body),
          });
          const error = await failure(submit.run());
          expect(error).toBeInstanceOf(UnknownOutcomeError);
          expect(api.callsTo(submit.path).filter(isSend)).toHaveLength(1);
        },
      );
    }
  });

  describe("every documented answer to a profile request", () => {
    const owner = () => Keypair.generate();
    const profileApi = (over: Record<string, () => unknown>) =>
      fakeApi({ ...PROFILE_ROUTES, ...over });
    const success = (template: string, method: string) =>
      documented(template, method).filter((answer) => answer.status === 200);

    it("names every field this package reads from each success", () => {
      const required = (template: string, method = "post") =>
        jsonOf(spec!.paths[template][method].responses["200"].content)!.schema!.required;
      const config = jsonOf(spec!.paths["/v1/profile/config"].get.responses["200"].content)!;
      expect(Object.keys(config.schema!.properties!).sort()).toEqual([
        "enabled",
        "gate",
        "maxDataLen",
        "programId",
      ]);
      expect(required("/v1/profile/challenge")).toEqual(["challenge"]);
      expect(required("/v1/profile/session")).toContain("token");
      expect(required("/v1/profile/read")).toEqual(["data"]);
      expect(required("/v1/profile/blockhash")?.slice().sort()).toEqual([
        "blockhash",
        "lastValidBlockHeight",
      ]);
    });

    it.each(spec ? success("/v1/profile/config", "get") : [])(
      "the settings: the documented answer is on with its size for the pinned program, or off",
      async ({ body }) => {
        const { enabled, maxDataLen } = body as { enabled: boolean; maxDataLen?: number };
        // The file's example names a program of its own, which this client takes for off.
        api = profileApi({ "GET /v1/profile/config": () => answering(200, body) });
        expect(await ended(profileMirror.limits())).toEqual({ value: null });
        api.restore();
        const pinned = enabled ? { ...(body as object), programId: PROFILE_PROGRAM } : body;
        api = profileApi({ "GET /v1/profile/config": () => answering(200, pinned) });
        expect(await ended(profileMirror.limits())).toEqual({
          value: enabled ? { maxDataLen } : null,
        });
      },
    );

    it.each(spec ? errorsOf("/v1/profile/config", "get") : [])(
      "the settings: %s (%i) is a failure, never taken for on",
      async (_code, status, body) => {
        api = profileApi({ "GET /v1/profile/config": () => answering(status, body) });
        expect(await failure(profileMirror.limits())).toBeInstanceOf(Error);
      },
    );

    for (const step of ["challenge", "session", "read"]) {
      it.each(spec ? errorsOf(`/v1/profile/${step}`, "post") : [])(
        `a read whose ${step} is answered %s (%i) fails, and is never taken for "no profile"`,
        async (_code, status, body) => {
          api = profileApi({ [`POST /v1/profile/${step}`]: () => answering(status, body) });
          expect(await failure(profileMirror.read(owner(), () => true))).toBeInstanceOf(Error);
        },
      );
    }

    it("a read: the documented answers are no profile, or the account as it is stored", async () => {
      for (const { body } of success("/v1/profile/read", "post")) {
        api = profileApi({ "POST /v1/profile/read": () => answering(200, body) });
        const outcome = await ended(profileMirror.read(owner(), () => true));
        // A stored example is some other owner's account, which this owner's read refuses.
        const stored = (body as { data: string | null }).data !== null;
        expect(outcome).toHaveProperty(
          stored ? "error" : "value",
          stored ? expect.anything() : null,
        );
        api.restore();
      }
    });

    it.each(spec ? errorsOf("/v1/profile/blockhash", "post") : [])(
      "a write whose blockhash is answered %s (%i) fails with nothing handed over",
      async (_code, status, body) => {
        api = profileApi({ "POST /v1/profile/blockhash": () => answering(status, body) });
        await ended(profileMirror.limits());
        const sent = profileMirror.write(owner(), 1n, new Uint8Array(8), PROFILE_SENDING);
        expect(await failure(sent)).toBeInstanceOf(Error);
        expect(api.callsTo("/v1/profile/submit")).toHaveLength(0);
      },
    );

    it.each(spec ? errorsOf("/v1/profile/submit", "post") : [])(
      "a write answered %s (%i) is stale or a failure, and is handed over once",
      async (code, status, body) => {
        api = profileApi({ "POST /v1/profile/submit": () => answering(status, body) });
        await ended(profileMirror.limits());
        const outcome = await ended(
          profileMirror.write(owner(), 1n, new Uint8Array(8), PROFILE_SENDING),
        );
        const moved = ["StaleRevision", "ProfileExists", "ProfileMissing"].includes(code);
        if (moved) expect(outcome).toEqual({ value: "stale" });
        else expect(outcome).toHaveProperty("error");
        expect(api.callsTo("/v1/profile/submit")).toHaveLength(1);
      },
    );
  });

  describe("every documented answer to a rewards request", () => {
    const stillUnlocked = () => true;
    const rewardsServer = (over: Record<string, () => unknown>) =>
      fakeApi({ ...REWARDS_ROUTES, ...over });
    const success = (template: string, method = "post") =>
      documented(template, method).filter((answer) => answer.status === 200);
    const claim = () =>
      rewardsApi.claim({
        member: Keypair.generate(),
        portfolio: Keypair.generate(),
        transaction: TRADE_ID,
        stillUnlocked,
      });

    it("names every field this package reads from each success", () => {
      const fields = (template: string, method = "post") =>
        jsonOf(spec!.paths[template][method].responses["200"].content)!.schema!;
      const standing = ["code", "codeActive", "invited", "points", "wasInvited", "week"];
      const week = ["endsAt", "feeMicroUsdc", "index", "shareBps"];
      expect(fields("/v1/rewards/config", "get").required?.slice().sort()).toEqual([
        "enabled",
        "seasonStart",
        "seasonWeeks",
        "weeklyPoints",
      ]);
      const states = [
        fields("/v1/rewards/join"),
        fields("/v1/rewards/state"),
        fields("/v1/rewards/claims").properties!.state,
      ];
      for (const state of states) {
        expect(state.required?.slice().sort()).toEqual(standing);
        expect(state.properties!.week.required?.slice().sort()).toEqual(week);
      }
      expect(fields("/v1/rewards/claims").required?.slice().sort()).toEqual([
        "credited",
        "feeMicroUsdc",
        "state",
      ]);
    });

    it.each(spec ? success("/v1/rewards/config", "get") : [])(
      "the settings: the documented answer is the season, or off",
      async ({ body }) => {
        const { enabled, ...season } = body as { enabled: boolean };
        api = rewardsServer({ "GET /v1/rewards/config": () => answering(200, body) });
        expect(await ended(rewardsApi.config())).toEqual({ value: enabled ? season : null });
      },
    );

    it.each(spec ? errorsOf("/v1/rewards/config", "get") : [])(
      "the settings: %s (%i) is a failure, never taken for on",
      async (_code, status, body) => {
        api = rewardsServer({ "GET /v1/rewards/config": () => answering(status, body) });
        expect(await failure(rewardsApi.config())).toBeInstanceOf(Error);
      },
    );

    it("a joining, a read and a claim: the documented answers are read as the file gives them", async () => {
      for (const { body } of success("/v1/rewards/join")) {
        api = rewardsServer({ "POST /v1/rewards/join": () => answering(200, body) });
        expect(await ended(rewardsApi.join(Keypair.generate(), undefined, stillUnlocked))).toEqual({
          value: { kind: "joined", state: body },
        });
        api.restore();
      }
      for (const { body } of success("/v1/rewards/state")) {
        api = rewardsServer({ "POST /v1/rewards/state": () => answering(200, body) });
        expect(await ended(rewardsApi.state(Keypair.generate(), stillUnlocked))).toEqual({
          value: body,
        });
        api.restore();
      }
      for (const { body } of success("/v1/rewards/claims")) {
        api = rewardsServer({ "POST /v1/rewards/claims": () => answering(200, body) });
        const { feeMicroUsdc, state } = body as { feeMicroUsdc: string; state: object };
        expect(await ended(claim())).toEqual({ value: { kind: "credited", feeMicroUsdc, state } });
        api.restore();
      }
    });

    it.each(spec ? errorsOf("/v1/rewards/join", "post") : [])(
      "a joining answered %s (%i) blames the invite code only when the server does, and is a failure otherwise",
      async (code, status, body) => {
        api = rewardsServer({ "POST /v1/rewards/join": () => answering(status, body) });
        const outcome = await ended(rewardsApi.join(Keypair.generate(), "K7M2QX9R", stillUnlocked));
        if (code === "invite_code_invalid")
          expect(outcome).toEqual({ value: { kind: "inviteNotValid" } });
        else expect(outcome).toHaveProperty("error");
      },
    );

    it.each(spec ? errorsOf("/v1/rewards/state", "post") : [])(
      "a read answered %s (%i) is no member only when the server says so, and a failure otherwise",
      async (code, status, body) => {
        api = rewardsServer({ "POST /v1/rewards/state": () => answering(status, body) });
        const outcome = await ended(rewardsApi.state(Keypair.generate(), stillUnlocked));
        if (code === "not_a_member") expect(outcome).toEqual({ value: null });
        else expect(outcome).toHaveProperty("error");
      },
    );

    it.each(spec ? errorsOf("/v1/rewards/claims", "post") : [])(
      "a claim answered %s (%i) is settled only by the server's word on that trade, and waits otherwise",
      async (code, status, body) => {
        api = rewardsServer({ "POST /v1/rewards/claims": () => answering(status, body) });
        const outcome = await ended(claim());
        const settled: Record<string, unknown> = {
          not_a_member: { kind: "notMember" },
          already_claimed: { kind: "alreadyClaimed" },
          signature_invalid: { kind: "refused", code },
          transaction_failed: { kind: "refused", code },
          not_a_signer: { kind: "refused", code },
          no_referral_fee: { kind: "refused", code },
          outside_claim_window: { kind: "refused", code },
        };
        if (code === "transaction_not_finalized") {
          expect(outcome).toEqual({ value: { kind: "notFinalized" } });
        } else if (code in settled) {
          expect(outcome).toEqual({ value: settled[code] });
        } else {
          // Left in line: the server was busy, runs no rewards right now, or would not take the request as made.
          expect(outcome).toHaveProperty("error");
        }
        // Asked once, but for the one more a renewed session is given.
        expect(api.callsTo("/v1/rewards/claims")).toHaveLength(status === 401 ? 2 : 1);
      },
    );
  });

  describe("every documented answer to a session request", () => {
    const real = async () => {
      installPlatform(memoryPlatform());
      keepSessionWith(null);
      await dropSession();
      return import("../../src/infrastructure/apiSession.js");
    };

    it.each(spec ? errorsOf("/v1/session", "post") : [])(
      "starting one: %s (%i) is 'not available now', and nothing is sent without one",
      async (_code, status, body) => {
        api = fakeApi({
          "POST /v1/session": () => answering(status, body),
          "/v1/prices": () => ({ prices: {} }),
        });
        const { authorizedFetch } = await real();
        const { apiUrl } = await import("../../src/infrastructure/api.js");
        expect(await failure(authorizedFetch(apiUrl("prices")))).toMatchObject({
          code: "notAvailableNow",
        });
        expect(api.callsTo("/v1/prices")).toHaveLength(0);
      },
    );

    it.each(spec ? errorsOf("/v1/session/refresh", "post") : [])(
      "renewing one: %s (%i) starts a new session only when this one cannot be renewed",
      async (code, status, body) => {
        const [ok] = documented("/v1/session", "post");
        api = fakeApi({
          "POST /v1/session": () => ({
            ...(ok.body as object),
            expiresAt: Math.floor(Date.now() / 1000) + 3_600,
          }),
          "POST /v1/session/refresh": () => answering(status, body),
          "/v1/prices": () => ({ prices: {} }),
        });
        const { authorizedFetch } = await real();
        const { apiUrl } = await import("../../src/infrastructure/api.js");
        await authorizedFetch(apiUrl("prices"));
        vi.setSystemTime(Date.now() + 3_600_000);
        const outcome = await ended(authorizedFetch(apiUrl("prices")));

        const startsOver = status === 401 || code === "invalid_request";
        expect(api.callsTo("/v1/session")).toHaveLength(startsOver ? 2 : 1);
        if (startsOver) expect(outcome).toHaveProperty("value");
        else expect(outcome).toMatchObject({ error: { code: "notAvailableNow" } });
      },
    );
  });
});
