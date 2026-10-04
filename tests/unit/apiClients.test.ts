import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChainError } from "../../src/domain/chainError.js";
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
const unauthorized = () => new Response("{}", { status: 401 });
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
    expect(failure).toBeInstanceOf(ChainError);
    expect(failure).toMatchObject({ code: "notAvailableNow" });
    expect(methodsAsked()).toEqual(["sendTransaction"]);
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

describe("a transaction this wallet sends itself", () => {
  it("ends as not available now, with nothing sent, when the server turns the send down", async () => {
    api = fakeApi({ "POST /v1/rpc": () => unauthorized() });
    const transaction = signed();
    const failure = await sendAndSettle(transaction, "signature", 1_000, () => new Error("failed"))
      .then(() => null)
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "notAvailableNow" });
    // Not called unknown, and the chain is not asked about a transaction nobody received.
    expect(methodsAsked()).toEqual(["sendTransaction"]);
  });
});

describe("the swap venue", () => {
  const QUOTE = { raw: { requestId: "request-1", lastValidBlockHeight: 1_000 } } as SwapQuote;

  it("never hands a signed swap over a second time, and says nothing was sent", async () => {
    api = fakeApi({ "POST /v1/jupiter/swap/v2/execute": () => unauthorized() });
    const failure = await executeJupiterSwap(QUOTE, signed()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ChainError);
    expect(failure).toMatchObject({ code: "notAvailableNow" });
    expect(api.calls.map((call) => call.path)).toEqual(["/v1/jupiter/swap/v2/execute"]);
    expect(api.calls[0].headers.authorization).toBe("Bearer test-token-1");
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
  it("never hands a signed transfer over a second time, and does not call it unknown", async () => {
    api = fakeApi({
      "POST /v1/rpc": (call) => rpcResult(call, null),
      "POST /v1/private-payments/v1/transaction/send": () => unauthorized(),
    });
    const failure = await submitTransfer({ transactionBase64: "AQID" }, null).catch(
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({ code: "notAvailableNow" });
    expect(api.callsTo("/v1/private-payments/v1/transaction/send")).toHaveLength(1);
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
