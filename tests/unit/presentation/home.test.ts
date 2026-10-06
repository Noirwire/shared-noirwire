import { describe, expect, it } from "vitest";
import { commonCopy } from "../../../src/copy/common.js";
import { marketsCopy } from "../../../src/copy/markets.js";
import { portfolioCopy } from "../../../src/copy/portfolio.js";
import { STALE_AFTER_MS, recordRead } from "../../../src/domain/freshness.js";
import type { Wallet } from "../../../src/domain/wallet.js";
import { homeView } from "../../../src/presentation/home.js";
import {
  FIRST_READ_FAILED,
  FIRST_READ_PENDING,
  FRESH,
  READ,
  TEST_PRICES,
  UPDATED_AT,
  activity,
  holding,
  testReads,
  testWallet,
  withFirst,
  withHolding,
} from "../support/screens.js";

const reads = testReads();
const NOTHING_ARCHIVED = { holds: false, earnUnknown: false };

describe("homeView", () => {
  it("counts what is in Earn in the total, and says what is there", () => {
    const wallet = testWallet((w) => ({
      ...w,
      portfolios: w.portfolios.map((entry, index) =>
        index === 0 ? withHolding(entry, holding("USDC", 100)) : entry,
      ),
    }));
    const without = homeView(reads, wallet, UPDATED_AT, undefined, NOTHING_ARCHIVED, FRESH);
    const lending = homeView(reads, wallet, UPDATED_AT, 24.99, NOTHING_ARCHIVED, FRESH);
    const unread = homeView(reads, wallet, UPDATED_AT, null, NOTHING_ARCHIVED, FRESH);
    expect(without.total.value).toBe("$100.00");
    expect(lending.total.value).toBe("$124.99");
    expect(lending.earn).toEqual({ label: "Earning", value: "$24.99" });
    // Not read: the total is of everything else, and the Earn line says it could not be shown.
    expect(unread.total.value).toBe("$100.00");
    expect(unread.earn?.value).toBe("Unavailable");
  });

  it("leads an empty wallet with one button, Add money, one line under it and no arc", () => {
    const view = homeView(reads, testWallet(), UPDATED_AT, undefined, NOTHING_ARCHIVED, FRESH);
    expect(view.empty).toBe(true);
    expect(view.total).toMatchObject({
      label: "Total value",
      value: "$0.00",
      unavailable: false,
      explainer: "Only you see this total",
    });
    expect(view.total.change).toBeUndefined();
    expect(view.showArc).toBe(false);
    expect(view.cash).toEqual({ label: "Ready to invest", value: "$0.00" });
    expect(view.primary).toEqual({ label: "Add money", target: { to: "addMoney" } });
    expect(view.secondary).toBeNull();
    expect(view.explanation).toBe(
      "Your money arrives in your main wallet. Then you move it into a portfolio.",
    );
    expect(view.portfolios[0]).toMatchObject({ name: "Investing", line: "No investments yet" });
  });

  it("has no Earn to show where Earn does not run, so Home draws no tile and no card for it", () => {
    const home = (earn: number | null | undefined) =>
      homeView(reads, testWallet(), UPDATED_AT, earn, NOTHING_ARCHIVED, FRESH).earn;
    expect(home(undefined)).toBeNull();
    expect(home(0)).not.toBeNull();
    expect(home(null)).not.toBeNull();
  });

  it("adds up every active portfolio, with the day's move of held trackers", () => {
    const wallet = withFirst((first) =>
      withHolding(withHolding(first, holding("USDC", 457.33)), holding("NVDAx", 5.1075, 400)),
    );
    const view = homeView(reads, wallet, UPDATED_AT, undefined, NOTHING_ARCHIVED, FRESH);
    expect(view.empty).toBe(false);
    expect(view.showArc).toBe(true);
    expect(view.explanation).toBeNull();
    expect(view.total.value).toBe("$968.08");
    expect(view.total.change).toBe("+$10.22 (2.0%) held trackers · 24h approximate");
    expect(view.total.changeTone).toBe("safe");
    expect(view.cash).toEqual({ label: "Ready to invest", value: "$457.33" });
    expect(view.primary.label).toBe("Find trackers");
    expect(view.secondary).toEqual({
      label: "Add money",
      target: { to: "addMoney" },
    });
    expect(view.portfolios[0]).toMatchObject({
      line: "$457.33 ready to invest · 1 holding",
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
    const view = homeView(reads, wallet, null, undefined, NOTHING_ARCHIVED, FRESH);
    expect(view.total).toMatchObject({
      value: "Value unavailable",
      unavailable: true,
      change: "Waiting for current balances or market prices",
    });
    expect(view.cash.value).toBe("$20.00");
    expect(view.showArc).toBe(false);
    expect(view.portfolios[0].value).toBe("Value unavailable");
    expect(view.portfolios[0].change).toBeNull();
    expect(view.investments[0].value).toBe(commonCopy.priceUnavailable);
  });

  it("puts USDC waiting in the main wallet first, with the one primary button", () => {
    const wallet = testWallet((w) => ({ ...w, funding: { ...w.funding, tokens: { USDC: 250 } } }));
    const view = homeView(reads, wallet, UPDATED_AT, undefined, NOTHING_ARCHIVED, FRESH);
    expect(view.empty).toBe(false);
    expect(view.waiting?.text).toBe(
      "250.00 USDC is in your main wallet. Move it to a portfolio to invest.",
    );
    expect(view.waiting?.action).toEqual({
      label: "Move to Investing",
      target: { to: "fund", portfolioId: "acc_1" },
    });
    expect(view.actionsQuiet).toBe(true);
    expect(view.secondary?.target).toEqual({ to: "fund" });
    const withoutIt = homeView(reads, testWallet(), UPDATED_AT, undefined, NOTHING_ARCHIVED, FRESH);
    expect(view.total.value).not.toBe(withoutIt.total.value);
    expect(view.cash.value).toBe(withoutIt.cash.value);
  });

  it("gives the main wallet a row of its own: its name, what it holds in dollars, and its page", () => {
    const funded = testWallet((w) => ({
      ...w,
      funding: { ...w.funding, sol: 0.5, tokens: { USDC: 250 } },
    }));
    const priced = testReads({ ...TEST_PRICES, SOL: { usd: 200, change24h: 0 } });
    const home = (
      wallet: Wallet,
      freshness: Parameters<typeof homeView>[5] = FRESH,
      screenReads = priced,
    ) => homeView(screenReads, wallet, UPDATED_AT, undefined, NOTHING_ARCHIVED, freshness);
    expect(home(funded).fundingWallet).toEqual({
      label: "Main wallet",
      value: "$350.00",
      target: { to: "fundingWallet" },
    });
    expect(home(testWallet()).fundingWallet.value).toBe("$0.00");
    // Nothing is known of it until balances are read, and SOL needs a price to be counted.
    expect(home(funded, { ...FRESH, balances: FIRST_READ_PENDING }).fundingWallet.value).toBeNull();
    expect(home(funded, { ...FRESH, balances: FIRST_READ_FAILED }).fundingWallet.value).toBeNull();
    expect(home(funded, FRESH, reads).fundingWallet.value).toBeNull();
    // The notice and its action are as they were.
    expect(home(funded).waiting?.action).toEqual({
      label: "Move to Investing",
      target: { to: "fund", portfolioId: "acc_1" },
    });
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
    const view = homeView(reads, wallet, UPDATED_AT, undefined, NOTHING_ARCHIVED, FRESH);
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
    const view = homeView(reads, wallet, UPDATED_AT, undefined, NOTHING_ARCHIVED, FRESH);
    expect(view.portfolios[0].line).toBe("Pie · 2 trackers · $96.18 ready to invest");
    expect(view.recent.map((row) => row.value.text)).toEqual(["+$4.00", "+$3.00", "+$2.00"]);
  });

  it("shows the Earn total, and counts money in Earn as not empty", () => {
    expect(homeView(reads, testWallet(), UPDATED_AT, 120.5, NOTHING_ARCHIVED, FRESH)).toMatchObject(
      {
        earn: { label: "Earning", value: "$120.50" },
        empty: false,
      },
    );
    // Not confirmed as zero: Home must not assume the wallet is empty.
    expect(homeView(reads, testWallet(), UPDATED_AT, null, NOTHING_ARCHIVED, FRESH)).toMatchObject({
      earn: { label: "Earning", value: "Unavailable" },
      empty: false,
    });
    expect(homeView(reads, testWallet(), UPDATED_AT, 0, NOTHING_ARCHIVED, FRESH).empty).toBe(true);
  });

  it("does not lead with Add money while an archived portfolio holds value or its Earn is unknown", () => {
    expect(
      homeView(
        reads,
        testWallet(),
        UPDATED_AT,
        undefined,
        { holds: true, earnUnknown: false },
        FRESH,
      ).empty,
    ).toBe(false);
    expect(
      homeView(
        reads,
        testWallet(),
        UPDATED_AT,
        undefined,
        { holds: false, earnUnknown: true },
        FRESH,
      ).empty,
    ).toBe(false);
  });

  describe("how current it is", () => {
    const home = (freshness: Parameters<typeof homeView>[5]) =>
      homeView(reads, testWallet(), UPDATED_AT, undefined, NOTHING_ARCHIVED, freshness);
    const NEVER = { succeededAt: null, lastAttemptFailed: false };

    it("says nothing while balances and prices were just read", () => {
      expect(home(FRESH)).toMatchObject({ stale: null, loading: false });
    });

    it("shows the notice the moment a balance refresh fails, and drops it on the next success", () => {
      const failed = recordRead(READ, false, UPDATED_AT + 1_000);
      const after = home({ ...FRESH, now: UPDATED_AT + 1_000, balances: failed });
      expect(after).toMatchObject({ stale: portfolioCopy.balances.stale, loading: false });

      const again = recordRead(failed, true, UPDATED_AT + 2_000);
      expect(home({ ...FRESH, now: UPDATED_AT + 2_000, balances: again }).stale).toBeNull();
    });

    it("says prices may be out of date when it is the price read that failed", () => {
      const failed = recordRead(READ, false, UPDATED_AT);
      expect(home({ ...FRESH, prices: failed }).stale).toBe(marketsCopy.stale);
    });

    it("shows the notice once a read is older than the bound, with no failure seen", () => {
      const justInside = { ...FRESH, now: UPDATED_AT + STALE_AFTER_MS };
      const past = { ...FRESH, now: UPDATED_AT + STALE_AFTER_MS + 1 };
      expect(home(justInside).stale).toBeNull();
      expect(home(past).stale).toBe(portfolioCopy.balances.stale);
    });

    it("waits, without the notice, for data that was never loaded", () => {
      expect(home({ ...FRESH, balances: NEVER })).toMatchObject({ stale: null, loading: true });
      expect(home({ ...FRESH, prices: NEVER })).toMatchObject({ stale: null, loading: true });
    });

    it("says prices may be out of date, not that it is waiting, when their very first read fails", () => {
      const failedFirst = recordRead(NEVER, false, UPDATED_AT);
      expect(home({ ...FRESH, prices: failedFirst })).toMatchObject({
        stale: marketsCopy.stale,
        loading: false,
        unavailable: null,
      });
    });
  });

  describe("balances that have never loaded", () => {
    const funded = withFirst(
      (first) => withHolding(withHolding(first, holding("USDC", 40)), holding("NVDAx", 1, 90)),
      { funding: { address: "Fund", sol: 0, tokens: { USDC: 5 } } },
    );
    const home = (balances: Parameters<typeof homeView>[5]["balances"], wallet = testWallet()) =>
      homeView(reads, wallet, UPDATED_AT, undefined, NOTHING_ARCHIVED, { ...FRESH, balances });
    const figures = (view: ReturnType<typeof homeView>) => [
      view.total.value,
      view.cash.value,
      ...view.portfolios.flatMap((row) => [row.value, row.line]),
    ];

    it("shows no figure at all after a failed first read, and one unavailable state with its retry", () => {
      const view = home(FIRST_READ_FAILED);
      expect(figures(view)).toEqual([null, null, null, null]);
      expect(view.unavailable).not.toBeNull();
      expect(view.unavailable?.retry).toBe(commonCopy.tryAgain);
      expect(view.stale).toBeNull();
      expect(view.loading).toBe(false);
      expect(JSON.stringify(view)).not.toContain("$0.00");
    });

    it("does not call the wallet empty, or offer to move money, on what it has not read", () => {
      const view = home(FIRST_READ_FAILED);
      expect(view).toMatchObject({
        empty: false,
        showArc: false,
        waiting: null,
        explanation: null,
      });
      expect(view.investments).toEqual([]);
    });

    it("keeps the out-of-date wording for balances that did load once", () => {
      const view = home(FIRST_READ_FAILED);
      expect(view.unavailable?.text).not.toBe(portfolioCopy.balances.stale);
    });

    it("waits, with no figure and nothing said, while the first read is still under way", () => {
      const view = home(FIRST_READ_PENDING);
      expect(figures(view)).toEqual([null, null, null, null]);
      expect(view).toMatchObject({ loading: true, unavailable: null, stale: null, empty: false });
    });

    it("keeps the last figures, with the stale notice, when a later refresh fails", () => {
      const view = home(recordRead(READ, false, UPDATED_AT + 1_000), funded);
      // The portfolio's 140 and the 5 USDC waiting in the main wallet.
      expect(view.total.value).toBe("$145.00");
      expect(view.cash.value).toBe("$40.00");
      expect(view.portfolios[0].value).toBe("$140.00");
      expect(view.waiting).not.toBeNull();
      expect(view.unavailable).toBeNull();
      expect(view.stale).toBe(portfolioCopy.balances.stale);
    });

    it("shows a zero that was really read as $0.00", () => {
      const view = home(READ);
      expect(view.total.value).toBe("$0.00");
      expect(view.cash.value).toBe("$0.00");
      expect(view.unavailable).toBeNull();
    });
  });
});
