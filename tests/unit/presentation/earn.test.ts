import { describe, expect, it } from "vitest";
import { earnDraft, earnSample } from "../../../src/application/earn.js";
import type { NetworkCost } from "../../../src/domain/networkCost.js";
import {
  earnPortfolioView,
  earnSheetView,
  earnSummaryView,
  type EarnSheetState,
} from "../../../src/presentation/earn.js";

const relayer: NetworkCost = { kind: "relayer", fee: 0.03, feeRaw: 30_000n, opens: null, count: 1 };

const sheet = (overrides: Partial<EarnSheetState> = {}, amountText = "10") =>
  earnSheetView({
    action: "deposit",
    draft: earnDraft({
      action: overrides.action ?? "deposit",
      amountText,
      cash: 50,
      deposited: 20,
      cost: overrides.cost === undefined ? { kind: "covered" } : overrides.cost,
    }),
    portfolioLabel: "Investing",
    archived: false,
    available: true,
    positionKnown: true,
    needsKnown: true,
    venue: "Jupiter Lend",
    apy: 5,
    cost: { kind: "covered" },
    pending: { blocked: false },
    busy: false,
    ...overrides,
  });

describe("earnDraft and earnSample", () => {
  it("keeps back the cash that pays the relayer on a deposit", () => {
    expect(
      earnDraft({ action: "deposit", amountText: "50", cash: 50, deposited: 0, cost: relayer }),
    ).toMatchObject({ max: 49.97, valid: false });
    expect(
      earnDraft({ action: "withdraw", amountText: "20", cash: 0, deposited: 20, cost: relayer }),
    ).toMatchObject({ max: 20, valid: true });
    expect(
      earnDraft({ action: "withdraw", amountText: "1", cash: 0, deposited: undefined, cost: null })
        .max,
    ).toBe(0);
  });

  it("prices the relayer with an amount the portfolio could really move", () => {
    expect(earnSample("deposit", 50, 0)).toBe(1);
    expect(earnSample("deposit", 0.4, 0)).toBe(0.4);
    expect(earnSample("withdraw", 50, undefined)).toBe(0);
  });
});

describe("earnSheetView", () => {
  it("reviews a deposit, with a year's estimate at today's rate", () => {
    expect(sheet()).toMatchObject({
      title: "Deposit · Investing",
      lead: "Lend USDC from this portfolio.",
      amountLabel: "Amount in USDC",
      available: "Available $50.00",
      estimate:
        "About $0.50 in a year at today's 5.00% variable rate. This is an estimate, not a promise.",
      mainnetOnly: null,
      networkCostLine: "Network cost: Covered",
      beforeDeposit: {
        title: "Before you deposit",
        body: "USDC is lent through Jupiter Lend. The rate changes. This is not a bank deposit and is not insured. Smart-contract failures can cause loss. Withdrawals may be delayed when the pool is heavily borrowed.",
      },
      confirm: { label: "Confirm deposit", disabled: false },
    });
  });

  it("reviews a withdrawal without an estimate or the deposit's warning", () => {
    const view = sheet({ action: "withdraw" });
    expect(view).toMatchObject({
      title: "Withdraw · Investing",
      lead: "Return USDC to this portfolio.",
      available: "Available $20.00",
      estimate: null,
      beforeDeposit: null,
      confirm: { label: "Confirm withdrawal", disabled: false },
    });
  });

  it("says Earn is mainnet only, and shows no cost there", () => {
    const view = sheet({ available: false });
    expect(view.mainnetOnly).toBe("Earn runs on Solana mainnet.");
    expect(view.networkCost).toBeNull();
    expect(view.networkCostLine).toBeNull();
    expect(view.confirm.disabled).toBe(true);
  });

  it("holds Confirm back until everything it needs is known and allowed", () => {
    expect(sheet({}, "100").confirm.disabled).toBe(true);
    expect(sheet({ archived: true }).confirm.disabled).toBe(true);
    expect(sheet({ positionKnown: false }).confirm.disabled).toBe(true);
    expect(sheet({ needsKnown: false }).confirm.disabled).toBe(true);
    expect(sheet({ cost: null }).confirm.disabled).toBe(true);
    expect(sheet({ cost: null }).networkCost).toBeNull();
    expect(sheet({ pending: { blocked: true } }).confirm.disabled).toBe(true);
    expect(sheet({ busy: true }).confirm).toEqual({ label: "Submitting...", disabled: true });
  });

  it("explains a withdrawal paid out of what it returns", () => {
    expect(sheet({ action: "withdraw", cost: relayer }).networkCost?.details?.body).toContain(
      "out of the USDC this withdrawal returns",
    );
  });
});

describe("earnPortfolioView", () => {
  const position = { deposited: 20, earnedSinceDeposit: 0.5 };

  it("shows what a portfolio has in Earn and what it earned", () => {
    expect(earnPortfolioView({ archived: false, available: true, cash: 10, position })).toEqual({
      cash: "$10.00",
      cashAvailable: "$10.00 ready to invest",
      inEarn: "$20.00",
      earned: "$0.50",
      earnedLine: "$0.50 earned since deposit",
      archived: null,
      restore: null,
      canDeposit: true,
      canWithdraw: true,
    });
  });

  it("says what could not be read, and allows nothing for an archived portfolio", () => {
    const unread = earnPortfolioView({ archived: false, available: true, cash: 0, position: null });
    expect(unread).toMatchObject({
      inEarn: "Unavailable",
      earned: "Unavailable",
      earnedLine: null,
      canDeposit: false,
      canWithdraw: false,
    });
    expect(
      earnPortfolioView({
        archived: false,
        available: true,
        cash: 1,
        position: { deposited: 0, earnedSinceDeposit: null },
      }),
    ).toMatchObject({ canDeposit: true, canWithdraw: false, earned: "Unavailable" });
    expect(
      earnPortfolioView({ archived: true, available: true, cash: 10, position }),
    ).toMatchObject({
      archived: "Archived",
      restore: "Restore this portfolio to move funds",
      canDeposit: false,
      canWithdraw: false,
    });
  });
});

describe("earnSummaryView", () => {
  const rate = { apy: 5.123, supplyApy: 4, rewardsApy: 1.123 };

  it("shows the rate and the total in Earn", () => {
    expect(earnSummaryView({ available: true, rate, deposits: [10, 5] })).toEqual({
      apy: "5.12%",
      supplyApy: "4.00%",
      rewardsApy: "1.12%",
      total: "$15.00",
      couldEarn: "Your USDC could earn 5.12% a year at today's rate.",
      breakdown: "Supply 4.00% · rewards 1.12%. The rate changes.",
    });
  });

  it("says what is unavailable", () => {
    expect(earnSummaryView({ available: false, rate: null, deposits: [10, null] })).toEqual({
      apy: "Unavailable",
      supplyApy: "Unavailable",
      rewardsApy: "Unavailable",
      total: "Unavailable",
      couldEarn: "A current lending rate is unavailable.",
      breakdown: null,
    });
    expect(earnSummaryView({ available: false, rate, deposits: [undefined] }).apy).toBe(
      "Unavailable",
    );
    expect(earnSummaryView({ available: true, rate, deposits: [undefined] }).total).toBe(
      "Unavailable",
    );
  });
});
