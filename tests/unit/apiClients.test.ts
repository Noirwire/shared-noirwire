import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/domain/apiError.js";
import { ChainError, UnknownOutcomeError } from "../../src/domain/chainError.js";
import { keepSessionWith } from "../../src/infrastructure/apiSession.js";
import { jupiterThroughApi } from "../../src/infrastructure/solana/config.js";
import { priceHistory } from "../../src/infrastructure/prices/history.js";
import { connection, sendsTransaction } from "../../src/infrastructure/solana/client.js";
import { jupiterLend } from "../../src/infrastructure/solana/earn/jupiterLend.js";
import { submitTransfer } from "../../src/infrastructure/solana/private-payments.js";
import { relayerPins, resetRelayerPins } from "../../src/infrastructure/solana/relayer.js";
import { sendAndSettle } from "../../src/infrastructure/solana/settlement.js";
import { executeJupiterSwap } from "../../src/infrastructure/solana/swap/jupiter.js";
import type { SwapQuote } from "../../src/infrastructure/solana/swap/types.js";
import {
  fakeApi,
  installTestPlatform,
  testEnv,
  unsignedTransaction,
  type ApiCall,
  type FakeApi,
  type FakeSession,
} from "../../src/testing/index.js";

/**
 * Every client's requests, as they leave: to the one server, under its `/v1`
 * paths, carrying the session's token. And what each does when the server
 * turns the token down: a read is made once more, a signed submit never is.
 */

let api: FakeApi;
let session: FakeSession;

const rpcResult = (call: ApiCall, result: unknown) => ({
  jsonrpc: "2.0",
  id: (call.json as { id: string }).id,
  result,
});
const refusal = (code: string, status: number) =>
  new Response(JSON.stringify({ code, error: "A sentence for a person." }), { status });
const unauthorized = () => refusal("unauthorized", 401);
const turnedDownOnce = (answer: (call: ApiCall) => unknown) => (call: ApiCall) =>
  call.headers.authorization === "Bearer test-token-1" ? unauthorized() : answer(call);
const methodsAsked = () =>
  api.callsTo("/v1/rpc").map((call) => (call.json as { method: string }).method);

function signed(): VersionedTransaction {
  const signer = Keypair.generate();
  const transaction = unsignedTransaction(signer);
  transaction.sign([signer]);
  return transaction;
}

beforeEach(() => {
  ({ session } = installTestPlatform());
});

afterEach(() => {
  api?.restore();
  vi.restoreAllMocks();
  installTestPlatform();
});

describe("the chain client", () => {
  it("sends every call to the server's RPC route, with the session's token", async () => {
    api = fakeApi({ "POST /v1/rpc": (call) => rpcResult(call, 4242) });
    expect(await connection.getBlockHeight()).toBe(4242);
    const [call] = api.calls;
    expect(call.url.href).toBe("https://api.noirwire.test/v1/rpc");
    expect(call.headers.authorization).toBe("Bearer test-token-1");
  });

  it("asks a read again with a renewed session after a 401", async () => {
    api = fakeApi({ "POST /v1/rpc": turnedDownOnce((call) => rpcResult(call, 7)) });
    expect(await connection.getBlockHeight()).toBe(7);
    expect(api.callsTo("/v1/rpc").map((call) => call.headers.authorization)).toEqual([
      "Bearer test-token-1",
      "Bearer test-token-2",
    ]);
    expect(session.renewals).toBe(1);
  });

  it("never sends a signed transaction a second time", async () => {
    api = fakeApi({ "POST /v1/rpc": () => unauthorized() });
    const failure = await connection
      .sendRawTransaction(signed().serialize(), { skipPreflight: true })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ code: "unauthorized", status: 401 });
    expect(methodsAsked()).toEqual(["sendTransaction"]);
    // The session is put right for the next attempt all the same.
    await vi.waitFor(() => expect(session.renewals).toBe(1));
  });

  it("throws the server's own errors by their code, and passes the provider's on", async () => {
    api = fakeApi({ "POST /v1/rpc": () => refusal("method_not_allowed", 403) });
    await expect(connection.getBlockHeight()).rejects.toMatchObject({
      name: "ApiError",
      code: "method_not_allowed",
      asksAgain: false,
    });
    api.restore();
    api = fakeApi({ "POST /v1/rpc": () => refusal("rate_limited", 429) });
    await expect(connection.getBlockHeight()).rejects.toMatchObject({
      code: "rate_limited",
      asksAgain: true,
    });
    api.restore();
    api = fakeApi({
      "POST /v1/rpc": (call) => ({
        jsonrpc: "2.0",
        id: (call.json as { id: string }).id,
        error: { code: -32602, message: "Invalid params" },
      }),
    });
    await expect(connection.getBlockHeight()).rejects.toThrow(/Invalid params/);
  });

  it("tells a send from a read by what the request asks for", () => {
    const body = (method: string) => JSON.stringify({ jsonrpc: "2.0", id: 1, method });
    expect(sendsTransaction(body("sendTransaction"))).toBe(true);
    expect(sendsTransaction(body("getBalance"))).toBe(false);
    expect(sendsTransaction(body("simulateTransaction"))).toBe(false);
    expect(sendsTransaction(`[${body("getBalance")},${body("sendTransaction")}]`)).toBe(true);
    expect(sendsTransaction(`[${body("getBalance")},${body("getSlot")}]`)).toBe(false);
    // What cannot be read is never made a second time.
    expect(sendsTransaction("not json")).toBe(true);
    expect(sendsTransaction(undefined)).toBe(true);
  });

  it("goes straight to a named provider, with no session, for code with no visitor behind it", async () => {
    installTestPlatform({ env: testEnv({ rpcUrl: "https://rpc.provider.test/key" }) });
    api = fakeApi({ "POST /key": (call) => rpcResult(call, 9) });
    expect(await connection.getBlockHeight()).toBe(9);
    expect(api.calls[0].url.href).toBe("https://rpc.provider.test/key");
    expect(api.calls[0].headers).not.toHaveProperty("authorization");
  });
});

/** A session that cannot be had: the request is never made. */
function noSession() {
  keepSessionWith({
    token: () => Promise.reject(new ChainError("notAvailableNow")),
    renew: () => Promise.reject(new ChainError("notAvailableNow")),
    drop: async () => undefined,
  });
}

describe("a transaction this wallet sends itself", () => {
  const chainSays = (call: ApiCall, status: object | null, height = 900) => {
    const { method } = call.json as { method: string };
    if (method === "getSignatureStatuses")
      return rpcResult(call, { context: { slot: 1 }, value: [status] });
    if (method === "getBlockHeight") return rpcResult(call, height);
    return unauthorized();
  };
  const send = () =>
    sendAndSettle(signed(), "5".repeat(88), 1_000, () => new Error("failed")).catch(
      (error: unknown) => error,
    );

  it("is unknown, never 'nothing was sent', when the server answers a 401 to the send", async () => {
    api = fakeApi({ "POST /v1/rpc": (call) => chainSays(call, null) });
    const failure = await send();
    expect(failure).toBeInstanceOf(UnknownOutcomeError);
    expect(failure).toMatchObject({ signature: "5".repeat(88), lastValidBlockHeight: 1_000 });
    expect(methodsAsked().filter((method) => method === "sendTransaction")).toHaveLength(1);
  });

  it("is done when the chain shows it landed after that 401", async () => {
    api = fakeApi({
      "POST /v1/rpc": (call) =>
        chainSays(call, { slot: 1, confirmations: 1, err: null, confirmationStatus: "confirmed" }),
    });
    expect(await send()).toBe("5".repeat(88));
  });

  it("fails with nothing sent only when the request never left the device", async () => {
    noSession();
    api = fakeApi({});
    expect(await send()).toMatchObject({ code: "notAvailableNow" });
    expect(api.calls).toHaveLength(0);
  });
});

describe("the swap venue", () => {
  const QUOTE = { raw: { requestId: "request-1", lastValidBlockHeight: 1_000 } } as SwapQuote;

  it("never hands a signed swap over a second time, and calls a 401 unknown", async () => {
    api = fakeApi({
      "POST /v1/jupiter/swap/v2/execute": () => unauthorized(),
      "POST /v1/rpc": (call) =>
        (call.json as { method: string }).method === "getBlockHeight"
          ? rpcResult(call, 900)
          : rpcResult(call, { context: { slot: 1 }, value: [null] }),
    });
    const failure = await executeJupiterSwap(QUOTE, signed()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UnknownOutcomeError);
    expect(api.callsTo("/v1/jupiter/swap/v2/execute")).toHaveLength(1);
    expect(api.calls[0].headers.authorization).toBe("Bearer test-token-1");
  });

  it("fails a swap with nothing sent only when the request never left the device", async () => {
    noSession();
    api = fakeApi({});
    expect(
      await executeJupiterSwap(QUOTE, signed()).catch((error: unknown) => error),
    ).toMatchObject({ code: "notAvailableNow" });
    expect(api.calls).toHaveLength(0);
  });

  it("throws the server's own error for an order, and never shows its sentence", async () => {
    api = fakeApi({ "POST /v1/jupiter/swap/v2/order": () => refusal("upstream_timeout", 504) });
    const failure = await jupiterThroughApi("/swap/v2/order", { method: "POST", body: "{}" }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).message).toBe("504 upstream_timeout");
  });

  it("reads the lending rate through the server, and again after a 401", async () => {
    api = fakeApi({
      "/v1/jupiter/lend/v1/earn/tokens": turnedDownOnce(() => []),
    });
    await jupiterLend.rate().catch(() => undefined);
    expect(api.calls.map((call) => `${call.method} ${call.url.href}`)).toEqual([
      "GET https://api.noirwire.test/v1/jupiter/lend/v1/earn/tokens",
      "GET https://api.noirwire.test/v1/jupiter/lend/v1/earn/tokens",
    ]);
  });
});

describe("a private transfer", () => {
  it.each([
    ["a 401", () => unauthorized()],
    ["a refusal of the server's", () => refusal("rate_limited", 429)],
    [
      "a refusal of the service's",
      () => new Response('{"error":{"message":"no"}}', { status: 400 }),
    ],
  ])("never hands a signed transfer over twice, and calls %s unknown", async (_what, answer) => {
    api = fakeApi({ "POST /v1/private-payments/v1/transaction/send": answer });
    const failure = await submitTransfer({ transactionBase64: "AQID" }, null).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(UnknownOutcomeError);
    expect(api.callsTo("/v1/private-payments/v1/transaction/send")).toHaveLength(1);
  });

  it("fails a transfer with nothing sent only when the request never left the device", async () => {
    noSession();
    api = fakeApi({});
    expect(
      await submitTransfer({ transactionBase64: "AQID" }, null).catch((error: unknown) => error),
    ).toMatchObject({ code: "notAvailableNow" });
    expect(api.calls).toHaveLength(0);
  });
});

describe("the relayer's keys and the charts", () => {
  it("reads the relayer's keys from the server's relayer route", async () => {
    resetRelayerPins();
    api = fakeApi({ "GET /v1/relayer": turnedDownOnce(() => ({ available: false })) });
    expect(await relayerPins()).toBeNull();
    expect(api.callsTo("/v1/relayer")).toHaveLength(2);
    resetRelayerPins();
  });

  it("reads a chart from the server's history route, by symbol and range", async () => {
    api = fakeApi({ "/v1/history/*": () => ({ points: [1, 2, 3] }) });
    expect(await priceHistory("A/B x", "1D")).toEqual([1, 2, 3]);
    expect(api.calls[0].url.href).toBe("https://api.noirwire.test/v1/history/A%2FB%20x/1D");
    expect(api.calls[0].headers.authorization).toBe("Bearer test-token-1");
  });
});
