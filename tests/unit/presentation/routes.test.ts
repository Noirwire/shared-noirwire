import { describe, expect, it } from "vitest";
import { FUNDING } from "../../../src/application/pendingActions.js";
import {
  fundingReceiveParams,
  fundingSendParams,
  isAddressFreeParam,
  pieOrderParams,
  portfolioParams,
  publicViewParams,
  readPieMode,
  readPortfolioParam,
  readPublicView,
  readReceiveTarget,
  readSendSource,
  readSide,
  readsFunding,
  tradeParams,
} from "../../../src/presentation/routes.js";

const ADDRESS = "7xKp4tRmQ9wZ2b8nV3cL5dF6gH1jK2mN3pQ4rS5tU6v";

describe("route parameters", () => {
  it("writes portfolio=<id> on every sheet, portfolio=funding for the funding wallet, and view=public", () => {
    expect(portfolioParams("acc_1")).toEqual({ portfolio: "acc_1" });
    expect(fundingReceiveParams(false)).toEqual({ portfolio: "funding" });
    expect(fundingReceiveParams(true)).toEqual({ portfolio: "funding", reveal: "1" });
    expect(fundingSendParams()).toEqual({ portfolio: "funding" });
    expect(publicViewParams()).toEqual({ view: "public" });
    expect(tradeParams({ side: "sell", symbol: "NVDAx", portfolioId: "acc_1" })).toEqual({
      side: "sell",
      symbol: "NVDAx",
      portfolio: "acc_1",
    });
    expect(tradeParams({ side: "buy" })).toEqual({ side: "buy" });
    expect(pieOrderParams("acc_1", "rebalance")).toEqual({ portfolio: "acc_1", mode: "rebalance" });
  });

  it("reads them back, and refuses anything shaped like an address", () => {
    expect(isAddressFreeParam("acc_1")).toBe(true);
    expect(isAddressFreeParam(ADDRESS)).toBe(false);
    expect(isAddressFreeParam(["acc_1"])).toBe(false);
    expect(isAddressFreeParam("")).toBe(false);
    expect(readPortfolioParam("acc_1")).toBe("acc_1");
    expect(readPortfolioParam("funding")).toBeNull();
    expect(readPortfolioParam(ADDRESS)).toBeNull();
    expect(readsFunding("funding")).toBe(true);
    expect(readSendSource("acc_1")).toBe("acc_1");
    expect(readSendSource("funding")).toBe(FUNDING);
    expect(readSendSource(ADDRESS)).toBeNull();
    expect(readSendSource(undefined)).toBeNull();
    expect(readPublicView("public")).toBe(true);
    expect(readPublicView(undefined)).toBe(false);
    expect(readSide("sell")).toBe("sell");
    expect(readSide("anything")).toBe("buy");
    expect(readPieMode("rebalance")).toBe("rebalance");
    expect(readPieMode(undefined)).toBe("invest");
  });

  it("reads the receive sheet's target: the funding wallet unless a portfolio is named", () => {
    expect(readReceiveTarget({})).toEqual({ kind: "funding", reveal: false });
    expect(readReceiveTarget({ portfolio: "funding", reveal: "1" })).toEqual({
      kind: "funding",
      reveal: true,
    });
    expect(readReceiveTarget({ portfolio: "acc_123" })).toEqual({
      kind: "portfolio",
      id: "acc_123",
    });
    expect(readReceiveTarget({ portfolio: ADDRESS, reveal: "1" })).toEqual({
      kind: "funding",
      reveal: false,
    });
  });
});
