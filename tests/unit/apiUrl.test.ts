import { afterEach, describe, expect, it } from "vitest";
import { apiUrl, type ApiRoute } from "../../src/infrastructure/api.js";
import { envFrom } from "../../src/infrastructure/solana/config.js";
import { installTestPlatform, testEnv } from "../../src/testing/index.js";

afterEach(() => {
  installTestPlatform();
});

const ROUTES: [ApiRoute, string, string][] = [
  ["session", "", "/v1/session"],
  ["session", "/refresh", "/v1/session/refresh"],
  ["rpc", "", "/v1/rpc"],
  ["jupiter", "/swap/v2/order", "/v1/jupiter/swap/v2/order"],
  ["jupiter", "/swap/v2/execute", "/v1/jupiter/swap/v2/execute"],
  ["jupiter", "/lend/v1/earn/tokens", "/v1/jupiter/lend/v1/earn/tokens"],
  ["privatePayments", "/v1/spl/transfer", "/v1/private-payments/v1/spl/transfer"],
  ["privatePayments", "/v1/transaction/send", "/v1/private-payments/v1/transaction/send"],
  ["relayer", "", "/v1/relayer"],
  ["prices", "", "/v1/prices"],
  ["history", "/NVDAx/1D", "/v1/history/NVDAx/1D"],
  ["events", "", "/v1/events"],
  ["health", "", "/health"],
];

describe("the address of a request", () => {
  it.each(ROUTES)("puts %s%s under the server's origin", (route, rest, path) => {
    installTestPlatform({ env: testEnv({ apiBaseUrl: "https://api.noirwire.com" }) });
    expect(apiUrl(route, rest)).toBe(`https://api.noirwire.com${path}`);
  });

  it.each(ROUTES)("puts %s%s under the web's own path", (route, rest, path) => {
    installTestPlatform({ env: testEnv({ apiBaseUrl: "/api" }) });
    expect(apiUrl(route, rest)).toBe(`/api${path}`);
  });

  it("reads where the server is when asked, not when loaded", () => {
    installTestPlatform({ env: testEnv({ apiBaseUrl: "http://localhost:8787" }) });
    expect(apiUrl("prices")).toBe("http://localhost:8787/v1/prices");
    installTestPlatform({ env: testEnv({ apiBaseUrl: "http://10.0.2.2:8787" }) });
    expect(apiUrl("prices")).toBe("http://10.0.2.2:8787/v1/prices");
  });
});

describe("where the server is, from an app's settings", () => {
  const base = (apiBaseUrl: string | undefined, more: object = {}) =>
    envFrom({ apiBaseUrl, ...more }).apiBaseUrl;

  it("takes an https origin, with or without a trailing slash or a port", () => {
    expect(base("https://api.noirwire.com")).toBe("https://api.noirwire.com");
    expect(base(" https://api.noirwire.com/ ")).toBe("https://api.noirwire.com");
    expect(base("https://api.noirwire.com:8443")).toBe("https://api.noirwire.com:8443");
  });

  it.each(["http://localhost:8787", "http://127.0.0.1:8787", "http://10.0.2.2:8787"])(
    "takes %s in a development build only",
    (url) => {
      expect(base(url, { development: true })).toBe(url);
      expect(() => base(url)).toThrow(/must be https/);
      expect(() => base(url, { development: false })).toThrow(/must be https/);
    },
  );

  it("refuses plain http to anywhere else, in development too", () => {
    expect(() => base("http://api.noirwire.com", { development: true })).toThrow(/must be https/);
    expect(() => base("http://192.168.1.20:8787", { development: true })).toThrow(/must be https/);
    expect(() => base("ftp://api.noirwire.com")).toThrow(/must be https/);
  });

  it.each([
    "https://api.noirwire.com/v1",
    "https://api.noirwire.com/?key=1",
    "https://api.noirwire.com/#top",
    "https://someone:secret@api.noirwire.com",
  ])("refuses %s: an origin has nothing after its host", (url) => {
    expect(() => base(url)).toThrow(/origin with no path/);
  });

  it("refuses a missing or unreadable value", () => {
    expect(() => base(undefined)).toThrow(/is not set/);
    expect(() => base("  ")).toThrow(/is not set/);
    expect(() => base("api.noirwire.com")).toThrow(/is not a URL/);
  });

  it("takes a path on the page's own origin in a browser, and nowhere else", () => {
    expect(base("/api", { platform: "web" })).toBe("/api");
    expect(base("/api/", { platform: "web" })).toBe("/api");
    expect(() => base("/api", { platform: "mobile" })).toThrow(/only in a browser/);
    expect(() => base("/api")).toThrow(/only in a browser/);
  });

  it.each(["//evil.example/api", "/api?key=1", "/api#top", "/a pi", "/api\\x"])(
    "refuses the path %s",
    (path) => {
      expect(() => base(path, { platform: "web" })).toThrow(/must start with one slash/);
    },
  );

  it("still takes an origin on the web, and keeps the rest of the settings", () => {
    const env = envFrom({
      network: "mainnet",
      apiBaseUrl: "https://api.noirwire.com",
      platform: "web",
      rpcUrl: " https://rpc.example ",
    });
    expect(env).toEqual({
      network: "mainnet-beta",
      referralAccount: null,
      feeBps: 0,
      apiBaseUrl: "https://api.noirwire.com",
      rpcUrl: "https://rpc.example",
    });
    expect(envFrom({ apiBaseUrl: "https://api.noirwire.com" })).not.toHaveProperty("rpcUrl");
  });
});
