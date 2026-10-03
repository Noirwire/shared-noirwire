import { describe, expect, it } from "vitest";
import { logged } from "../../src/application/walletRecord.js";
import { MAX_ACTIVITY_ENTRIES, type Activity, type Wallet } from "../../src/domain/wallet.js";
import { activityListView } from "../../src/presentation/activity.js";
import { harness, prices, wallet } from "./support/actions.js";
import { testReads } from "./support/screens.js";

const entry = (at: number): Activity => ({
  id: `act_${at}`,
  portfolioId: "p1",
  at,
  kind: "fund",
  symbol: "USDC",
  amount: 1,
  usd: 1,
});

/** A wallet with `count` entries, newest first, as the record keeps them. */
const walletWith = (count: number): Wallet =>
  wallet({ activity: Array.from({ length: count }, (_, index) => entry(count - index)) });

const send = { portfolioId: "p1", kind: "send" as const, symbol: "USDC", amount: 2, usd: 2 };

describe("the activity the record keeps", () => {
  it("keeps a generous number", () => {
    expect(MAX_ACTIVITY_ENTRIES).toBe(500);
  });

  it("grows until the limit, then drops the oldest as a new entry is written", () => {
    const under = logged(walletWith(MAX_ACTIVITY_ENTRIES - 1), send, prices);
    expect(under.activity).toHaveLength(MAX_ACTIVITY_ENTRIES);
    expect(under.activity.at(-1)?.id).toBe("act_1");

    const full = logged(under, send, prices);
    expect(full.activity).toHaveLength(MAX_ACTIVITY_ENTRIES);
    expect(full.activity[0]).toMatchObject({ kind: "send", amount: 2 });
    expect(full.activity.some((kept) => kept.id === "act_1")).toBe(false);
    expect(full.activity.at(-1)?.id).toBe("act_2");
  });

  it("drops by age, not by position, in a record that was not kept newest first", () => {
    const shuffled = walletWith(MAX_ACTIVITY_ENTRIES);
    const reversed = { ...shuffled, activity: [...shuffled.activity].reverse() };
    const next = logged(reversed, send, prices);
    expect(next.activity).toHaveLength(MAX_ACTIVITY_ENTRIES);
    expect(next.activity.some((kept) => kept.id === "act_1")).toBe(false);
    expect(next.activity.some((kept) => kept.id === `act_${MAX_ACTIVITY_ENTRIES}`)).toBe(true);
  });

  it("never drops a pending action, nor the entry it writes once it lands", async () => {
    const h = harness(walletWith(MAX_ACTIVITY_ENTRIES));
    const reservation = await h.pending.reserve("p1", "Portfolio111", "a send of 5.00 USDC", {
      kind: "send",
      symbol: "USDC",
      amount: 5,
      usd: 5,
      counterparty: "Recipient111",
    });
    expect(reservation).not.toBeNull();

    // Fifty more entries are written while it is unsettled.
    for (let more = 0; more < 50; more++) {
      await h.store.update((current) => logged(current, send, prices));
    }
    expect(h.wallet().activity).toHaveLength(MAX_ACTIVITY_ENTRIES);
    expect(h.pending.pendingFor("p1")).toMatchObject({
      what: "a send of 5.00 USDC",
      activity: { kind: "send", amount: 5, counterparty: "Recipient111" },
    });
    const funding = await h.pending.reserve(h.FUNDING, "Funding111", "moving money");
    expect(h.wallet().funding.pendingAction).toBeDefined();
    await funding?.finish();
  });
});

describe("the Activity screen at the limit", () => {
  const reads = testReads();
  const view = (count: number, limit: number, platform: "web" | "mobile") =>
    activityListView(reads, {
      wallet: walletWith(count),
      filter: "all",
      limit,
      now: 0,
      platform,
    });

  it("says nothing about older entries while the list is short of the limit", () => {
    expect(view(20, 50, "web")).toMatchObject({ kind: "list", more: false, olderNotKept: null });
  });

  it("says honestly, under the last row, that older entries are no longer kept here", () => {
    expect(view(MAX_ACTIVITY_ENTRIES, MAX_ACTIVITY_ENTRIES, "web")).toMatchObject({
      more: false,
      olderNotKept:
        "Only your 500 most recent entries are kept in this browser. Older ones are no longer shown here. Your money is not affected.",
    });
    expect(view(MAX_ACTIVITY_ENTRIES, MAX_ACTIVITY_ENTRIES, "mobile")).toMatchObject({
      olderNotKept:
        "Only your 500 most recent entries are kept on this phone. Older ones are no longer shown here. Your money is not affected.",
    });
  });

  it("waits until the last rows are shown", () => {
    expect(view(MAX_ACTIVITY_ENTRIES, 50, "web")).toMatchObject({ more: true, olderNotKept: null });
  });
});
