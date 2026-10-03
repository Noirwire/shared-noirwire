import { describe, expect, it } from "vitest";
import {
  ageBand,
  arrivalFrom,
  cleanEvent,
  failureReason,
  isOnChain,
  reportedPath,
  tradeBand,
} from "../../src/domain/usageEvents.js";

describe("reportedPath", () => {
  it("drops the portfolio id, so a visit is counted per screen and not per portfolio", () => {
    expect(reportedPath("/portfolios/acc_k3j2h1g0")).toBe("/portfolios/:id");
  });

  it("drops the stock symbol, so what someone looks at stays in the browser", () => {
    expect(reportedPath("/markets/NVDAx")).toBe("/markets/:symbol");
  });

  it("leaves every other screen as it is", () => {
    expect(reportedPath("/portfolio")).toBe("/portfolio");
  });
});

describe("cleanEvent", () => {
  it("passes a page view and a listed event with listed values", () => {
    expect(cleanEvent({ path: "/markets/:symbol", display: "390x844" })).toEqual({
      path: "/markets/:symbol",
      display: "390x844",
    });
    expect(
      cleanEvent({ path: "/portfolios/:id", name: "account_created", data: { kind: "pie" } }),
    ).toEqual({ path: "/portfolios/:id", name: "account_created", data: { kind: "pie" } });
  });

  it("refuses a path that still carries a portfolio id or a query", () => {
    expect(cleanEvent({ path: "/portfolios/acc_k3j2h1g0" })).toBeNull();
    expect(cleanEvent({ path: "/portfolio?next=/x" })).toBeNull();
  });

  it("refuses anything free-form: unknown events, extra fields, unlisted values", () => {
    const base = { path: "/portfolio" };
    expect(cleanEvent({ ...base, name: "anything_else" })).toBeNull();
    expect(cleanEvent({ ...base, name: "sent", data: { to: "9xQe...address" } })).toBeNull();
    expect(cleanEvent({ ...base, name: "watchlist_toggled" })).not.toBeNull();
    for (const symbol of ["9xQe", "SPYx", "NVDAx"]) {
      expect(cleanEvent({ ...base, name: "watchlist_toggled", data: { symbol } })).toBeNull();
    }
    expect(cleanEvent({ ...base, data: { note: "no name" } })).toBeNull();
    expect(cleanEvent({ ...base, visitor: "3f1c2a9e-5b7d-4c1e-9a2f-0d6b8e4c7a11" })).toBeNull();
  });

  it("gives a trade no room for an asset or a size, before or after signing", () => {
    const base = { path: "/portfolios/:id" };
    for (const name of ["trade_quoted", "trade_placed"]) {
      expect(cleanEvent({ ...base, name, data: { side: "buy" } })).not.toBeNull();
      expect(cleanEvent({ ...base, name, data: { side: "buy", symbol: "SPYx" } })).toBeNull();
      expect(cleanEvent({ ...base, name, data: { side: "buy", size: "10 to 100" } })).toBeNull();
    }
  });
});

describe("isOnChain", () => {
  it("marks what lands on chain, and nothing before signing", () => {
    expect(isOnChain("trade_placed")).toBe(true);
    expect(isOnChain("private_funding_arrived")).toBe(true);
    expect(isOnChain("trade_failed")).toBe(true);
    expect(isOnChain("trade_quoted")).toBe(false);
    expect(isOnChain("trade_reviewed")).toBe(false);
    expect(isOnChain("wallet_unlocked")).toBe(false);
  });
});

describe("the unlock snapshot", () => {
  const state = {
    age: "8-30d",
    accounts: "2+",
    pies: "1",
    trades: "2-5",
    funded: "yes",
    invested: "yes",
    has_funded: "yes",
    has_traded: "yes",
  };

  it("passes bands and yes/no answers", () => {
    expect(cleanEvent({ path: "/", name: "wallet_unlocked", data: state })?.data).toEqual(state);
  });

  it("refuses an exact count where a band belongs", () => {
    expect(
      cleanEvent({ path: "/", name: "wallet_unlocked", data: { ...state, trades: 37 } }),
    ).toBeNull();
  });

  it("bands a wallet's age and its number of trades", () => {
    const day = 86_400_000;
    expect(ageBand(0, day / 2)).toBe("new");
    expect(ageBand(0, 5 * day)).toBe("1-7d");
    expect(ageBand(0, 200 * day)).toBe("90d+");
    expect([0, 1, 4, 40].map(tradeBand)).toEqual(["0", "1", "2-5", "6+"]);
  });
});

describe("failureReason", () => {
  it("turns a message into one of a few fixed reasons", () => {
    expect(failureReason("This portfolio needs at least 0.002 SOL")).toBe("no_sol");
    expect(failureReason("This price has expired. Get a new quote.")).toBe("expired");
    expect(failureReason("This swap would deliver less than quoted.")).toBe("price_moved");
    expect(failureReason("Jupiter returned 429.")).toBe("rate_limited");
    expect(failureReason("Insufficient funds")).toBe("no_funds");
    expect(failureReason("Failed to fetch")).toBe("network");
    expect(failureReason("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin failed")).toBe("other");
  });
});

describe("arrivalFrom", () => {
  it("names a known referrer and ignores the site's own pages", () => {
    expect(arrivalFrom("https://x.com/some/post", "", "app.noirwire.com")).toEqual({ source: "x" });
    expect(arrivalFrom("https://noirwire.com/", "", "app.noirwire.com")).toEqual({
      source: "noirwire",
    });
    expect(arrivalFrom("https://app.noirwire.com/markets", "", "app.noirwire.com")).toEqual({});
  });

  it("reduces anything unlisted to other, so a link made for one person cannot mark them", () => {
    expect(arrivalFrom("https://alice-7f3a.example.org/", "", "app.noirwire.com")).toEqual({
      source: "other",
    });
    expect(
      arrivalFrom(
        "",
        "?utm_source=alice-7f3a&utm_medium=dm&utm_campaign=launch",
        "app.noirwire.com",
      ),
    ).toEqual({ source: "other", medium: "other", campaign: "launch" });
  });

  it("survives the server check only as listed names", () => {
    const sent = { path: "/", arrival: { source: "reddit", medium: "social", campaign: "launch" } };
    expect(cleanEvent(sent)?.arrival).toEqual(sent.arrival);
    expect(cleanEvent({ path: "/", arrival: { source: "alice-7f3a" } })?.arrival).toBeUndefined();
    expect(cleanEvent({ path: "/", arrival: { campaign: "for-alice" } })?.arrival).toBeUndefined();
    expect(cleanEvent({ path: "/", name: "wallet_created", arrival: sent.arrival })).toBeNull();
  });
});
