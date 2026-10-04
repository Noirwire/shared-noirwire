import { describe, expect, it } from "vitest";
import type { Wallet } from "../../../src/domain/wallet.js";
import {
  newPortfolioView,
  portfolioSettingsView,
  portfolioView,
  publicView,
  settingsDraft,
  type PortfolioDetailView,
} from "../../../src/presentation/portfolio.js";
import {
  READ,
  UPDATED_AT,
  activity,
  holding,
  testReads,
  testWallet,
  withFirst,
  withHolding,
} from "../support/screens.js";

const reads = testReads();

function found(wallet: Wallet, at: number | null = UPDATED_AT): PortfolioDetailView {
  const view = portfolioView(reads, wallet, wallet.portfolios[0].id, at, READ);
  if (view.kind !== "found") throw new Error("expected a portfolio");
  return view;
}

describe("portfolioView", () => {
  it("counts what the portfolio has in Earn in its value, the same on every platform", () => {
    const wallet = withFirst((entry) => withHolding(entry, holding("USDC", 396.12)));
    const id = wallet.portfolios[0].id;
    const value = (inEarn?: number | null) => {
      const view = portfolioView(reads, wallet, id, UPDATED_AT, READ, inEarn);
      if (view.kind !== "found") throw new Error("expected a portfolio");
      return { value: view.value, inEarn: view.inEarn };
    };
    expect(value(24.99)).toEqual({
      value: "$421.11",
      inEarn: { label: "Earning", value: "$24.99" },
    });
    expect(value(null)).toEqual({
      value: "$396.12",
      inEarn: { label: "Earning", value: "Unavailable" },
    });
    expect(value()).toEqual({ value: "$396.12", inEarn: null });
  });

  it("says a stale route's portfolio does not exist", () => {
    expect(portfolioView(reads, testWallet(), "gone", UPDATED_AT, READ)).toEqual({
      kind: "missing",
      message: "That portfolio does not exist.",
      back: "Back to Home",
    });
  });

  it("leads an empty portfolio with moving money in, as the one primary", () => {
    const view = found(testWallet());
    expect(view.kindLine).toBe("Portfolio · Created 3 Sep 2026");
    expect(view.value).toBe("$0.00");
    expect(view.cashLine).toBe("0.00 USDC ready to invest");
    expect(view.primary).toBeNull();
    expect(view.empty).toEqual({
      title: "Nothing here yet.",
      button: { label: "Move to portfolio", action: { to: "fund" } },
      caption: "Move money in first, then choose a tracker.",
    });
    expect(view.quiet.map((button) => [button.label, !!button.disabled])).toEqual([
      ["Receive", false],
      ["Send", true],
    ]);
    expect(view.sendReason).toBe("Nothing to send yet.");
    expect(view.activity.empty).toBe(
      "Nothing has moved yet. Move money into this portfolio to begin.",
    );
  });

  it("offers the first tracker once there is cash", () => {
    const view = found(withFirst((p) => withHolding(p, holding("USDC", 50))));
    expect(view.empty?.button).toEqual({ label: "Add your first tracker", action: { to: "buy" } });
    expect(view.empty?.caption).toBeNull();
    expect(view.quiet.map((button) => button.label)).toEqual([
      "Receive",
      "Send",
      "Move to portfolio",
    ]);
  });

  it("lists cash first, then trackers by value, then anything else without an action", () => {
    const view = found(
      withFirst((p) =>
        withHolding(
          withHolding(
            withHolding(withHolding(p, holding("USDC", 457.33)), holding("NVDAx", 1)),
            holding("SPYx", 1),
          ),
          holding("SOL", 0.5),
        ),
      ),
    );
    expect(view.primary).toEqual({ label: "Buy a tracker", action: { to: "buy" } });
    expect(view.holdings?.title).toBe("Holdings");
    expect(view.holdings?.rows.map((row) => [row.name, row.amount, row.value])).toEqual([
      ["Cash", "457.33 USDC", null],
      ["SP500 tracker", "1.0000 SPYx", "$500.00"],
      ["NVIDIA tracker", "1.0000 NVDAx", "$100.00"],
      ["Solana", "0.5000 SOL", null],
    ]);
    expect(view.holdings?.rows[3].sell).toBeNull();
    expect(view.holdings?.rows[1].sell).toEqual({
      label: "Sell SP500 tracker",
      disabled: false,
      reason: null,
    });
    expect(view.value).toBe("Value unavailable");
  });

  it("shows no value and no price while prices are missing, but keeps token amounts", () => {
    const view = found(
      withFirst((p) => withHolding(p, holding("NVDAx", 2))),
      null,
    );
    expect(view.value).toBe("Value unavailable");
    expect(view.valueUnavailable).toBe(true);
    expect(view.holdings?.rows[0]).toMatchObject({
      amount: "2.0000 NVDAx",
      value: "Price unavailable right now.",
    });
  });

  it("draws a pie's mix, says which slices drifted in words, and offers Rebalance", () => {
    const view = found(
      withFirst((p) => ({
        ...withHolding(
          withHolding(withHolding(p, holding("USDC", 10)), holding("NVDAx", 4)),
          holding("SPYx", 1),
        ),
        pie: [
          { symbol: "NVDAx", weight: 50 },
          { symbol: "SPYx", weight: 50 },
        ],
      })),
    );
    expect(view.kindLine).toMatch(/^Pie · Created/);
    expect(view.primary?.label).toBe("Invest");
    expect(view.rebalance).toEqual({ label: "Rebalance", action: { to: "rebalance" } });
    expect(view.mix?.centre).toEqual({ label: "Invested", value: "$900.00" });
    expect(view.mix?.slices.map((slice) => [slice.name, slice.line, slice.trailing])).toEqual([
      ["NVIDIA tracker", "Target 50% · Now 44.4% · under", "$400.00"],
      ["SP500 tracker", "Target 50% · Now 55.6% · over", "$500.00"],
    ]);
    expect(view.mix?.ringLabel).toBe(
      "NVIDIA tracker, target 50 percent, now 44.4 percent, under target. SP500 tracker, target 50 percent, now 55.6 percent, over target",
    );
    expect(view.holdings?.title).toBe("Cash and other holdings");
    expect(view.holdings?.rows.map((row) => row.name)).toEqual(["Cash"]);
  });

  it("shows an uninvested pie's target as outlines, counted in trackers", () => {
    const view = found(
      withFirst((p) => ({
        ...p,
        pie: [
          { symbol: "NVDAx", weight: 60 },
          { symbol: "SPYx", weight: 40 },
        ],
      })),
    );
    expect(view.mix?.centre).toEqual({ label: "Target", value: "2 trackers" });
    expect(view.mix?.current).toEqual([0, 0]);
    expect(view.mix?.slices.map((slice) => slice.trailing)).toEqual(["Not bought", "Not bought"]);
    expect(view.primary).toEqual({ label: "Move to portfolio", action: { to: "fund" } });
    expect(view.rebalance).toBeNull();
  });

  it("says Unpriced in the centre while an invested pie has no live price", () => {
    const view = found(
      withFirst((p) => ({
        ...withHolding(p, holding("NVDAx", 1)),
        pie: [{ symbol: "NVDAx", weight: 100 }],
      })),
      null,
    );
    expect(view.mix?.centre).toEqual({ label: "Unpriced", value: null });
    expect(view.mix?.current).toBeUndefined();
  });

  it("replaces the actions of an archived portfolio, with no Sell", () => {
    const view = found(
      withFirst((p) => ({ ...withHolding(p, holding("NVDAx", 1)), archivedAt: 1 })),
    );
    expect(view.archived?.title).toBe("This portfolio is archived.");
    expect(view.primary).toBeNull();
    expect(view.quiet).toEqual([]);
    expect(view.holdings?.rows[0].sell).toBeNull();
  });

  it("pins the pending note under the value", () => {
    const view = found(
      withFirst((p) => ({
        ...p,
        pendingAction: { status: "submitted", id: "r1", at: 1, what: "a send of 5.00 USDC" },
      })),
    );
    expect(view.pending).toMatch(/^Your last action from this portfolio \(a send of 5\.00 USDC\)/);
  });
});

describe("publicView", () => {
  it("builds the public view from tickers, amounts and this device's own entries only", () => {
    const wallet = withFirst(
      (p) => withHolding(withHolding(p, holding("USDC", 457.33)), holding("NVDAx", 5.1075)),
      {
        activity: [
          activity({
            portfolioId: "acc_1",
            kind: "fund",
            amount: 100,
            at: new Date(2026, 8, 3).getTime(),
          }),
          activity({ portfolioId: "another", kind: "fund", amount: 7 }),
        ],
      },
    );
    const [portfolio] = wallet.portfolios;
    const model = publicView(reads, portfolio, wallet);
    expect(model.address).toBe(portfolio.address);
    expect(model.holdings.map((entry) => entry.text)).toEqual(["457.33 USDC", "5.1075 NVDAx"]);
    expect(model.transactions).toEqual([
      expect.objectContaining({ kind: "Money arrived", amount: "100.00 USDC", date: "3 Sep 2026" }),
    ]);
    expect(JSON.stringify(model)).not.toContain("Investing");
  });
});

describe("portfolioSettingsView", () => {
  const [portfolio] = testWallet().portfolios;

  it("saves only a changed, non-empty name or mark", () => {
    const draft = settingsDraft(portfolio);
    const view = (next: typeof draft) =>
      portfolioSettingsView(reads, portfolio, next, UPDATED_AT).canSave;
    expect(view(draft)).toBe(false);
    expect(view({ ...draft, name: "  " })).toBe(false);
    expect(view({ ...draft, name: "Trips" })).toBe(true);
    expect(view({ ...draft, icon: { glyph: "sun", tint: "ochre" } })).toBe(true);
  });

  it("says what an archived portfolio would still hold, priced or not", () => {
    const holding2 = withHolding(portfolio, holding("NVDAx", 2));
    const draft = settingsDraft(holding2);
    expect(portfolioSettingsView(reads, holding2, draft, UPDATED_AT)).toMatchObject({
      sectionTitle: "Archive this portfolio",
      stillHolds:
        "This portfolio still holds $200.00. Archiving hides it; it does not move anything.",
      toggle: "Archive",
      save: "Save",
    });
    expect(portfolioSettingsView(reads, holding2, draft, null).stillHolds).toBe(
      "This portfolio still holds investments. Archiving hides it; it does not move anything.",
    );
    expect(
      portfolioSettingsView(reads, { ...holding2, archivedAt: 1 }, draft, UPDATED_AT),
    ).toMatchObject({
      sectionTitle: "Restore this portfolio",
      stillHolds: null,
      toggle: "Restore",
    });
  });
});

describe("newPortfolioView", () => {
  it("words a portfolio and a pie on the phone, and needs a name and a mix with no problem", () => {
    const phone = (kind: "portfolio" | "pie", name: string, mixProblem: string | null) =>
      newPortfolioView({ kind, name, mixProblem, platform: "mobile" });
    expect(phone("portfolio", "", null)).toMatchObject({
      title: "New portfolio",
      description: "Buy one tracker at a time.",
      lead: "Give it a name only you see. The name never leaves this phone.",
      placeholder: "Investing",
      suggestions: ["Investing", "Long term", "Everyday"],
      submit: "Create portfolio",
      canSubmit: false,
    });
    expect(phone("portfolio", " Mine ", null).canSubmit).toBe(true);
    expect(phone("pie", "Core", "Add at least one tracker.")).toMatchObject({
      title: "New pie",
      description: "Set a mix of trackers and invest in all of them at once.",
      nameLabel: "Pie name",
      submit: "Create pie",
      submitting: "Creating pie...",
      canSubmit: false,
    });
    expect(phone("pie", "Core", null).canSubmit).toBe(true);
  });

  it("keeps the web's words for a browser", () => {
    expect(
      newPortfolioView({ kind: "portfolio", name: "", mixProblem: null, platform: "web" }),
    ).toMatchObject({
      description: "Buy one investment at a time.",
      lead: "Give it a name only you see. The name never leaves this browser.",
    });
  });
});
