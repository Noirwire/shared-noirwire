import { describe, expect, it } from "vitest";
import type { Activity } from "../../../src/domain/wallet.js";
import { activityAmountOf } from "../../../src/presentation/amount.js";
import {
  ACTIVITY_FILTERS,
  activityDetailView,
  activityListView,
  activityRow,
  dayHeading,
} from "../../../src/presentation/activity.js";
import { activity, testReads, testWallet } from "../support/screens.js";

const reads = testReads();
const NOW = new Date(2026, 8, 30, 12, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

const withEntries = (entries: Activity[]) => testWallet((w) => ({ ...w, activity: entries }));

describe("activityRow", () => {
  it("names trackers, signs money in and out, and speaks the sign", () => {
    const wallet = withEntries([
      activity({ id: "fund", portfolioId: "acc_1", kind: "fund", amount: 100, usd: 100, at: NOW }),
      activity({
        id: "buy",
        portfolioId: "acc_1",
        kind: "buy",
        symbol: "NVDAx",
        amount: 0.4239,
        shown: 0.4239,
        usd: 100,
        at: NOW,
      }),
      activity({
        id: "send",
        portfolioId: "acc_1",
        kind: "send",
        usd: 5,
        amount: 5,
        counterparty: "x",
      }),
      activity({
        id: "sell",
        portfolioId: "gone",
        kind: "sell",
        symbol: "SPYx",
        usd: 0,
        amount: 1,
      }),
    ]);
    const rows = Object.fromEntries(
      wallet.activity.map((entry) => [entry.id, activityRow(reads, wallet, entry)]),
    );
    expect(rows.fund).toMatchObject({
      icon: "in",
      title: "Money arrived",
      caption: "Investing",
      value: { text: "+$100.00", tone: "safe" },
      amount: "100.00 USDC",
    });
    expect(rows.buy).toMatchObject({
      icon: "bought",
      title: "Bought NVIDIA tracker",
      value: { text: "-$100.00", tone: "ink" },
      amount: "0.4239 NVDAx",
      spoken: "Bought NVIDIA tracker, Investing, 30 September, minus $100.00, 0.4239 NVDAx",
    });
    expect(rows.send).toMatchObject({
      title: "Sent",
      caption: "To an address you entered · Investing",
    });
    expect(JSON.stringify(rows.send)).not.toContain('"x"');
    expect(rows.sell).toMatchObject({
      title: "Sold SP500 tracker",
      caption: "Portfolio",
      value: { text: "Not priced", tone: "faint", priced: false },
      amount: "1.0000 SPYx (raw tokens)",
    });
  });

  it("names a move into Earn and back out of it", () => {
    const wallet = withEntries([
      activity({ id: "in", portfolioId: "acc_1", kind: "earnDeposit", amount: 40, usd: 40 }),
      activity({ id: "out", portfolioId: "acc_1", kind: "earnWithdraw", amount: 10, usd: 10 }),
    ]);
    const [deposit, withdrawal] = wallet.activity.map((entry) => activityRow(reads, wallet, entry));
    expect(deposit).toMatchObject({
      icon: "earn",
      title: "Moved into Earn",
      value: { text: "-$40.00", tone: "ink" },
      amount: "40.00 USDC",
    });
    expect(withdrawal).toMatchObject({
      icon: "earn",
      title: "Returned from Earn",
      value: { text: "+$10.00", tone: "safe" },
    });
  });
});

describe("activityAmountOf", () => {
  it("prints USDC with two decimals, and a tracker at its own four", () => {
    expect(activityAmountOf({ symbol: "USDC", amount: 5 }, false)).toBe("5.00 USDC");
    expect(activityAmountOf({ symbol: "USDC", amount: 1234.5 }, false)).toBe("1,234.50 USDC");
    expect(activityAmountOf({ symbol: "NVDAx", amount: 2, shown: 2.5 }, true)).toBe("2.5000 NVDAx");
    expect(activityAmountOf({ symbol: "NVDAx", amount: 2 }, true)).toBe(
      "2.0000 NVDAx (raw tokens)",
    );
    expect(activityAmountOf({ symbol: "SOL", amount: 0.5 }, false)).toBe("0.5000 SOL");
  });
});

describe("activityListView", () => {
  const list = (
    wallet: ReturnType<typeof withEntries>,
    filter: (typeof ACTIVITY_FILTERS)[number]["id"],
    limit = 50,
    platform: "web" | "mobile" = "mobile",
  ) => activityListView(reads, { wallet, filter, limit, now: NOW, platform });

  it("is empty with its own words when nothing was ever recorded, by platform", () => {
    expect(list(withEntries([]), "all")).toEqual({
      kind: "none",
      title: "Your buys, sells and money moves will appear here.",
      detail:
        "History is kept on this phone only. A wallet restored on a new phone starts with an empty list.",
      importedNote: null,
    });
    const web = list(withEntries([]), "all", 50, "web");
    expect(web.kind === "none" && web.detail).toBe(
      "History is kept in this browser only. A wallet restored in another browser starts with an empty list.",
    );
  });

  it("groups newest first under Today, Yesterday and the date, and filters in place", () => {
    const wallet = withEntries([
      activity({ portfolioId: "acc_1", kind: "fund", at: NOW - 3 * DAY }),
      activity({ portfolioId: "acc_1", kind: "buy", symbol: "NVDAx", at: NOW - DAY }),
      activity({ portfolioId: "acc_1", kind: "send", at: NOW }),
      activity({ portfolioId: "acc_1", kind: "earnDeposit", at: NOW - 4 * DAY }),
    ]);
    const all = list(wallet, "all");
    expect(all.kind === "list" && all.sections.map((s) => [s.title, s.rows.length])).toEqual([
      ["Today", 1],
      ["Yesterday", 1],
      ["27 Sep 2026", 1],
      ["26 Sep 2026", 1],
    ]);
    const titles = (filter: (typeof ACTIVITY_FILTERS)[number]["id"]) => {
      const view = list(wallet, filter);
      return view.kind === "list" && view.sections.flatMap((s) => s.rows.map((r) => r.title));
    };
    expect(titles("trades")).toEqual(["Bought NVIDIA tracker"]);
    expect(titles("transfers")).toEqual(["Sent"]);
    expect(titles("earn")).toEqual(["Moved into Earn"]);
    const capped = list(wallet, "all", 2);
    expect(capped.kind === "list" && capped.more).toBe(true);
  });

  it("offers a filter for Earn", () => {
    expect(ACTIVITY_FILTERS.map((filter) => filter.label)).toEqual([
      "All",
      "Money in",
      "Money sent",
      "Trades",
      "Earn",
    ]);
  });

  it("says when nothing matches the filter", () => {
    const wallet = withEntries([activity({ portfolioId: "acc_1", kind: "fund" })]);
    expect(list(wallet, "trades")).toEqual({
      kind: "noMatch",
      title: "Nothing matches that filter.",
      importedNote: null,
    });
  });
});

describe("activityDetailView", () => {
  it("holds everything recorded, with a send's recipient kept apart", () => {
    const at = new Date(2026, 8, 28, 14, 32).getTime();
    const wallet = withEntries([
      activity({
        id: "s",
        portfolioId: "acc_1",
        kind: "send",
        amount: 5,
        usd: 5,
        at,
        counterparty: "Dest",
      }),
    ]);
    expect(activityDetailView(reads, wallet, "s")).toMatchObject({
      title: "Sent",
      headline: "-$5.00",
      portfolio: { name: "Investing" },
      date: "28 Sep 2026, 14:32",
      amount: "5.00 USDC",
      value: "$5.00",
      recipient: "Dest",
    });
    expect(activityDetailView(reads, wallet, "missing")).toBeNull();
  });
});

describe("dayHeading", () => {
  it("writes an older day as a date", () => {
    expect(dayHeading(NOW - 2 * DAY, NOW)).toBe("28 Sep 2026");
  });
});

describe("the network cost of an entry", () => {
  const withdrawal = activity({
    id: "back",
    portfolioId: "acc_1",
    kind: "earnWithdraw",
    amount: 10,
    usd: 10,
    networkCost: 0.02,
    at: NOW,
  });

  it("shows a return from Earn as what arrived, with the cost beside it", () => {
    const row = activityRow(reads, withEntries([withdrawal]), withdrawal);
    expect(row).toMatchObject({
      title: "Returned from Earn",
      amount: "9.98 USDC",
      value: { text: "+$9.98" },
      networkCost: "Network cost 0.02 USDC",
    });
    expect(row.spoken).toContain("9.98 USDC, Network cost 0.02 USDC");
  });

  it("gives the detail both figures: what was withdrawn, and what arrived", () => {
    expect(activityDetailView(reads, withEntries([withdrawal]), "back")).toMatchObject({
      headline: "+$9.98",
      amount: "10.00 USDC",
      arrived: "9.98 USDC",
      networkCost: "0.02 USDC",
    });
  });

  it("leaves a send and a deposit as they were made, and states their cost", () => {
    const sent = activity({
      id: "sent",
      portfolioId: "acc_1",
      kind: "send",
      amount: 5,
      usd: 5,
      networkCost: 0.004,
    });
    const row = activityRow(reads, withEntries([sent]), sent);
    expect(row).toMatchObject({ amount: "5.00 USDC", networkCost: "Network cost 0.004 USDC" });
    expect(activityDetailView(reads, withEntries([sent]), "sent")).toMatchObject({
      amount: "5.00 USDC",
      arrived: null,
      networkCost: "0.004 USDC",
    });
  });

  it("says nothing of a cost on an entry that was charged none, or recorded before costs were", () => {
    const old = activity({
      id: "old",
      portfolioId: "acc_1",
      kind: "earnWithdraw",
      amount: 10,
      usd: 10,
    });
    expect(activityRow(reads, withEntries([old]), old)).toMatchObject({
      amount: "10.00 USDC",
      networkCost: null,
    });
    expect(activityDetailView(reads, withEntries([old]), "old")).toMatchObject({
      arrived: null,
      networkCost: null,
    });
  });
});

describe("an imported wallet's activity", () => {
  const imported = (entries: Activity[]) =>
    testWallet((w) => ({ ...w, activity: entries, imported: true }));
  const view = (wallet: ReturnType<typeof testWallet>, platform: "web" | "mobile") =>
    activityListView(reads, { wallet, filter: "all", limit: 50, now: NOW, platform });

  it("says plainly that what was done before, on another device, is not shown here", () => {
    expect(view(imported([]), "web")).toMatchObject({
      kind: "none",
      importedNote:
        "This wallet was restored in this browser. Activity from before that, made on another device, is not shown here. Your balances are complete.",
    });
    expect(view(imported([]), "mobile").importedNote).toBe(
      "This wallet was restored on this phone. Activity from before that, made on another device, is not shown here. Your balances are complete.",
    );
    const some = imported([activity({ portfolioId: "acc_1", kind: "fund" })]);
    expect(view(some, "web")).toMatchObject({ kind: "list", importedNote: expect.any(String) });
  });

  it("says nothing of it on a wallet made here", () => {
    expect(view(withEntries([]), "web").importedNote).toBeNull();
  });
});
