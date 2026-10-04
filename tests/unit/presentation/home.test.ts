import { describe, expect, it } from "vitest";
import { homeView } from "../../../src/presentation/home.js";
import {
  UPDATED_AT,
  activity,
  holding,
  testReads,
  testWallet,
  withFirst,
  withHolding,
} from "../support/screens.js";

const reads = testReads();

describe("homeView", () => {
  it("counts what is in Earn in the total, and says what is there", () => {
    const wallet = testWallet((w) => ({
      ...w,
      portfolios: w.portfolios.map((entry, index) =>
        index === 0 ? withHolding(entry, holding("USDC", 100)) : entry,
      ),
    }));
    const without = homeView(reads, wallet, UPDATED_AT, undefined);
    const lending = homeView(reads, wallet, UPDATED_AT, 24.99);
    const unread = homeView(reads, wallet, UPDATED_AT, null);
    expect(without.total.value).toBe("$100.00");
    expect(lending.total.value).toBe("$124.99");
    expect(lending.earning).toEqual({ label: "Earning", value: "$24.99" });
    // Not read: the total is of everything else, and the Earn line says it could not be shown.
    expect(unread.total.value).toBe("$100.00");
    expect(unread.earning?.value).toBe("Unavailable");
  });

  it("leads an empty wallet with getting USDC in, and no day line", () => {
    const view = homeView(reads, testWallet(), UPDATED_AT, undefined);
    expect(view.empty).toBe(true);
    expect(view.total).toMatchObject({ value: "$0.00", unavailable: false });
    expect(view.total.change).toBeUndefined();
    expect(view.primary).toEqual({ label: "Add USDC", target: { to: "receive", reveal: false } });
    expect(view.secondary).toEqual({
      label: "Show funding address",
      target: { to: "receive", reveal: true },
    });
    expect(view.howTo.steps.map((step) => step.title)).toEqual([
      "1. Get USDC on Solana",
      "2. Send it to your funding address",
      "3. Move USDC into a portfolio privately",
    ]);
    expect(view.portfolios[0]).toMatchObject({ name: "Investing", line: "No investments yet" });
    expect(view.earning).toBeNull();
  });

  it("adds up every active portfolio, with the day's move of held trackers", () => {
    const wallet = withFirst((first) =>
      withHolding(withHolding(first, holding("USDC", 457.33)), holding("NVDAx", 5.1075, 400)),
    );
    const view = homeView(reads, wallet, UPDATED_AT, undefined);
    expect(view.empty).toBe(false);
    expect(view.total.value).toBe("$968.08");
    expect(view.total.change).toBe("+$10.22 (2.0%) held trackers · 24h indicative");
    expect(view.total.changeTone).toBe("safe");
    expect(view.cash).toEqual({ label: "Cash available to invest", value: "$457.33" });
    expect(view.primary.label).toBe("Find trackers");
    expect(view.secondary).toEqual({
      label: "Add money",
      target: { to: "receive", reveal: false },
    });
    expect(view.portfolios[0]).toMatchObject({
      line: "$457.33 cash · 1 holding",
      value: "$968.08",
    });
    expect(view.investments).toEqual([
      expect.objectContaining({
        name: "NVIDIA tracker",
        caption: "NVDAx · 5.1075 tokens",
        value: "$510.75",
      }),
    ]);
  });

  it("shows no number while prices are missing, and keeps the cash line", () => {
    const wallet = withFirst((first) =>
      withHolding(withHolding(first, holding("USDC", 20)), holding("NVDAx", 1, 90)),
    );
    const view = homeView(reads, wallet, null, undefined);
    expect(view.total).toMatchObject({
      value: "Value unavailable",
      unavailable: true,
      change: "Waiting for current balances or market prices",
    });
    expect(view.cash.value).toBe("$20.00");
    expect(view.portfolios[0].value).toBe("Value unavailable");
    expect(view.portfolios[0].change).toBeNull();
    expect(view.investments[0].value).toBe("Price unavailable");
  });

  it("puts USDC waiting in the funding wallet first, with the one primary button", () => {
    const wallet = testWallet((w) => ({ ...w, funding: { ...w.funding, tokens: { USDC: 250 } } }));
    const view = homeView(reads, wallet, UPDATED_AT, undefined);
    expect(view.empty).toBe(false);
    expect(view.waiting?.text).toBe(
      "250.00 USDC has arrived in your funding wallet. Move it to a portfolio before buying.",
    );
    expect(view.waiting?.action).toEqual({
      label: "Move money to Investing",
      target: { to: "fund", portfolioId: "acc_1" },
    });
    expect(view.actionsQuiet).toBe(true);
    expect(view.secondary.target).toEqual({ to: "fund" });
  });

  it("lists archived portfolios apart, and keeps them out of the total", () => {
    const wallet = testWallet((w) => {
      const [first] = w.portfolios;
      const archived = {
        ...withHolding(first, holding("USDC", 10)),
        id: "archived",
        label: "Old",
        archivedAt: 1,
      };
      return { ...w, portfolios: [first, archived] };
    });
    const view = homeView(reads, wallet, UPDATED_AT, undefined);
    expect(view.portfolios.map((row) => row.name)).toEqual(["Investing"]);
    expect(view.archived.heading).toBe("Archived portfolios (1)");
    expect(view.archived.rows.map((row) => row.name)).toEqual(["Old"]);
    expect(view.total.value).toBe("$0.00");
  });

  it("shows the three newest activity rows, and a pie's own line", () => {
    const wallet = withFirst(
      (first) => ({
        ...withHolding(first, holding("USDC", 96.18)),
        label: "Core",
        pie: [
          { symbol: "NVDAx", weight: 50 },
          { symbol: "SPYx", weight: 50 },
        ],
      }),
      {
        activity: [1, 2, 3, 4].map((n) =>
          activity({ portfolioId: "acc_1", kind: "fund", at: n * 1000, usd: n }),
        ),
      },
    );
    const view = homeView(reads, wallet, UPDATED_AT, undefined);
    expect(view.portfolios[0].line).toBe("Pie · 2 trackers · $96.18 cash");
    expect(view.recent.map((row) => row.value.text)).toEqual(["+$4.00", "+$3.00", "+$2.00"]);
  });

  it("shows the Earn total, and counts money in Earn as not empty", () => {
    expect(homeView(reads, testWallet(), UPDATED_AT, 120.5)).toMatchObject({
      earning: { label: "Earning", value: "$120.50" },
      empty: false,
    });
    expect(homeView(reads, testWallet(), UPDATED_AT, null)).toMatchObject({
      earning: { label: "Earning", value: "Unavailable" },
      empty: true,
    });
    expect(homeView(reads, testWallet(), UPDATED_AT, 0).empty).toBe(true);
  });
});
