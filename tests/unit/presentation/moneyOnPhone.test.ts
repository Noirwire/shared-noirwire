import { describe, expect, it } from "vitest";
import { earnDraft } from "../../../src/application/earn.js";
import { fundingDraft } from "../../../src/application/funding.js";
import { sendDraft } from "../../../src/application/send.js";
import {
  earnAmountView,
  earnChoiceView,
  earnProgressView,
  earnResultView,
  earnReviewView,
  earnScreenView,
  type EarnPortfolio,
} from "../../../src/presentation/earn.js";
import {
  FUND_PRESETS,
  choosePortfolioView,
  fundingAmountView,
  fundingOutcomeView,
  fundingProgressView,
  fundingReviewView,
  fundingWalletRow,
  fundingWalletView,
} from "../../../src/presentation/funding.js";
import {
  sendAssets,
  sendFormView,
  sendProgressView,
  sendResultView,
  sendReviewView,
} from "../../../src/presentation/send.js";

const RECIPIENT = "7xKp4tRmQ9wZ2b8nV3cL5dF6gH1jK2mN3pQ4rS5tU6v";

describe("moving money in, on the phone", () => {
  const draft = (amountText: string, fundingBalance = 100) =>
    fundingDraft({ privateRoute: true, decimals: 6, fundingBalance, amountText });
  const amount = (amountText: string, fundingBalance: number | null = 100, online = true) =>
    fundingAmountView({
      draft: draft(amountText, fundingBalance ?? 0),
      asset: "USDC",
      privateRoute: true,
      fundingBalance,
      amountText,
      presets: FUND_PRESETS,
      pending: { blocked: false },
      platform: "mobile",
      portfolioLabel: "Investing",
      online,
    });

  it("states the arithmetic in USDC and never names SOL", () => {
    const view = amount("10");
    expect(view.lead).toBe(
      "Move USDC into Investing without publishing a transfer between your funding wallet and it.",
    );
    expect(view.available).toEqual({ label: "Available in funding wallet", value: "100.00 USDC" });
    expect(view.presets.map((preset) => preset.label)).toEqual(["10", "25", "50", "100"]);
    expect(view.terms).toEqual([
      { label: "Arrives in Investing", value: "10.00 USDC" },
      { label: "Privacy fee, 0.1% of the amount", value: "+ 0.01 USDC" },
      { label: "Relay fee, flat", value: "+ 0.20 USDC" },
    ]);
    expect(view.total).toEqual({ label: "Leaves your funding wallet", value: "10.21 USDC" });
    expect(view.next).toEqual({ label: "Review", disabled: false });
    expect(JSON.stringify(view)).not.toMatch(/\bSOL\b/);
  });

  it("waits for the first read, holds back offline, and leads an empty wallet to its address", () => {
    expect(amount("10", null)).toMatchObject({
      available: { value: null },
      next: { disabled: true },
      presets: expect.arrayContaining([expect.objectContaining({ disabled: true })]),
    });
    expect(amount("10", 100, false).next.disabled).toBe(true);
    expect(amount("", 0).emptyNotice).toEqual({
      title: "Your funding wallet is empty.",
      detail: "Send USDC on Solana to your funding address first.",
      action: "Show my funding address",
    });
  });

  it("reviews the total apart, says it is not signed above it, and never names SOL", () => {
    const view = fundingReviewView({
      draft: draft("10"),
      asset: "USDC",
      amount: 10,
      portfolioLabel: "Investing",
      pending: { blocked: false },
      platform: "mobile",
      online: false,
    });
    expect(view.title).toBe("Review");
    expect(view.total).toEqual({ label: "Total leaving your funding wallet", value: "10.21 USDC" });
    expect(view.totalSpoken).toBe("Total leaving your funding wallet, 10 point 21 USDC");
    expect(view.note).toBe("If the transfer would take more than this total, it is not signed.");
    expect(view.confirm.disabled).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(/\bSOL\b/);
  });

  it("names the stages where the money is, and says when it is slow", () => {
    const view = fundingProgressView({
      asset: "USDC",
      amount: 10,
      portfolioLabel: "Investing",
      completed: 2,
      platform: "mobile",
      slow: true,
    });
    expect(view.stages.map((stage) => [stage.title, stage.status])).toEqual([
      ["Sent to the private route", "done"],
      ["Waiting in the queue", "done"],
      ["Arrived in Investing", "running"],
    ]);
    expect(view.stillWorking).toMatch(/^Still working/);
  });

  it("says what arrived, read back, and links to the public view", () => {
    expect(
      fundingOutcomeView({
        outcome: "done",
        asset: "USDC",
        privateRoute: true,
        amount: 10,
        arrived: 10,
        fee: 0.21,
        portfolioLabel: "Investing",
        platform: "mobile",
      }),
    ).toEqual({
      title: "Funds arrived",
      body: "10.00 USDC is now in Investing, read back from its real balance. 0.21 USDC in fees was charged on top.",
      observerLink: "See public view",
      close: "Done",
      alert: false,
      tone: "success",
    });
  });

  it("chooses the portfolio first when there is more than one", () => {
    const portfolios = [
      { id: "a", label: "Investing", cash: 5 },
      { id: "b", label: "Trips", cash: 0 },
    ];
    expect(choosePortfolioView({ portfolios, chosen: null }).next).toEqual({
      label: "Continue",
      disabled: true,
    });
    expect(choosePortfolioView({ portfolios, chosen: "b" })).toMatchObject({
      rows: [{ cash: "5.00 USDC cash" }, { cash: "0.00 USDC cash" }],
      next: { label: "Continue with Trips", disabled: false },
    });
  });

  it("shows the funding wallet's waiting cash, and moves it only when there is some", () => {
    expect(fundingWalletRow(undefined).value).toBeUndefined();
    expect(fundingWalletRow(3).value).toBe("3.00 USDC");
    expect(fundingWalletView({ balance: null, readFailed: false }).move.disabled).toBe(true);
    expect(fundingWalletView({ balance: 0, readFailed: true })).toMatchObject({
      lead: "Nothing is waiting. Send USDC on Solana to your funding address to add money.",
      readFailed:
        "We couldn't update your balance. What you see may be out of date. Pull down to try again.",
      move: { quiet: true, disabled: true },
    });
    expect(fundingWalletView({ balance: 12, readFailed: false })).toMatchObject({
      balanceLabel: "12.00 USDC waiting to be moved",
      move: { quiet: false, disabled: false },
    });
  });
});

describe("sending, on the phone", () => {
  const draft = sendDraft({
    heldRaw: 50,
    unitsPerHeld: 1,
    amountText: "60",
    destination: RECIPIENT,
    isAddress: true,
    offCurve: false,
    ownAddress: "Own",
  });

  it("offers cash and each tracker held, nothing else", () => {
    expect(
      sendAssets(
        [
          { symbol: "USDC", amount: 5 },
          { symbol: "SOL", amount: 1 },
          { symbol: "NVDAx", amount: 2 },
          { symbol: "SPYx", amount: 0 },
        ],
        (symbol) => symbol.endsWith("x"),
      ),
    ).toEqual([
      { symbol: "USDC", label: "Cash" },
      { symbol: "NVDAx", label: "NVDAx" },
    ]);
  });

  it("words the form as the phone does, refuses what cannot receive, and holds back offline", () => {
    const form = (over: Partial<Parameters<typeof sendFormView>[0]> = {}) =>
      sendFormView({
        draft,
        symbol: "USDC",
        heldRaw: 50,
        unitsPerHeld: 1,
        destination: RECIPIENT,
        ownAddress: "Own",
        offCurve: false,
        offCurveMessage: "",
        recipientTouched: true,
        amountTouched: true,
        archived: false,
        submitting: false,
        preparing: false,
        network: "",
        platform: "mobile",
        ...over,
      });
    expect(form()).toMatchObject({
      recipientLabel: "Recipient address",
      recipientPlaceholder: "Solana address",
      amountError: "More than this portfolio holds.",
      available: { label: "Available", value: "50.00 USDC" },
    });
    expect(form().explainer).not.toMatch(/\bSOL\b/);
    expect(form({ unsendable: "mint" }).refusal).toMatch(/^This is a token's own mint address/);
    expect(form({ recipientUnreadable: true }).refusal).toMatch(/could not be checked/);
    expect(form({ pastedForeign: true }).pasteWarning).toMatch(/cannot be part of an address/);
    expect(form({ online: false }).review.disabled).toBe(true);
  });

  it("reviews without a network row, names cash and value, and says what is still to do", () => {
    const view = sendReviewView({
      draft: { ...draft, amount: 10, rawAmount: 10, validAmount: true },
      canReview: true,
      symbol: "USDC",
      unitsPerHeld: 1,
      destination: RECIPIENT,
      sendAmount: 10,
      cost: { kind: "covered" },
      pricePerHeld: 1,
      recipient: { kind: "lookalike", address: "7xKother" },
      checks: { checkedAddress: false, acceptedLink: false, lastFour: "" },
      pending: { blocked: false },
      submitting: false,
      network: "",
      solFee: 0,
      platform: "mobile",
    });
    expect(view.title).toBe("Review");
    expect(view.terms.map((term) => term.label)).toEqual([
      "Cash",
      "Amount",
      "Value",
      "Network cost",
    ]);
    expect(view.recipient.aria).toBe(
      "Recipient address, 7xKp 4tRm Q9wZ 2b8n V3cL 5dF6 gH1j K2mN 3pQ4 rS5t U6v",
    );
    expect(view.reason).toBe("Confirm that you have checked the full address.");
    expect(view.confirm.disabled).toBe(true);
    expect(view.segments[0]).toEqual({ text: "7xKp 4t", strong: true });
  });

  it("lists a send's steps and says how it ended", () => {
    expect(sendProgressView("sending", "5.00 USDC").steps.map((step) => step.status)).toEqual([
      "done",
      "current",
      "waiting",
    ]);
    expect(sendResultView("landed", "5.00 USDC", "Investing")).toEqual({
      title: "Sent 5.00 USDC",
      body: "To the address you entered. It has left Investing.",
      close: "Done",
    });
    expect(sendResultView("unknown", "5.00 USDC", "Investing").title).toBe(
      "Sent, but not confirmed",
    );
  });
});

describe("Earn", () => {
  const portfolios: EarnPortfolio[] = [
    {
      id: "a",
      label: "Investing",
      archived: false,
      cash: 20,
      position: { deposited: 10, earnedSinceDeposit: 0.5 },
    },
    {
      id: "b",
      label: "Old",
      archived: true,
      cash: 0,
      position: { deposited: 0, earnedSinceDeposit: null },
    },
  ];
  const rate = { apy: 5, supplyApy: 4, rewardsApy: 1 };
  const screen = (over: Partial<Parameters<typeof earnScreenView>[0]> = {}) =>
    earnScreenView({
      available: true,
      online: true,
      venue: "Jupiter Lend",
      rate,
      portfolios,
      platform: "mobile",
      ...over,
    });

  it("shows the rate, the total in Earn and each portfolio, and what each can do", () => {
    const view = screen();
    expect(view).toMatchObject({
      rateLabel: "Current variable rate",
      rate: { value: "5.00%", unavailable: false },
      total: { label: "Your total in Earn", value: "$10.00" },
      deposit: { disabled: false, reason: null },
      withdraw: { disabled: false },
    });
    expect(view.rows[0]).toMatchObject({ opens: "deposit", inEarn: "$10.00" });
    expect(view.rows[1]).toMatchObject({
      opens: null,
      restore: "Restore this portfolio to move funds.",
    });
    expect(screen({ platform: "web" }).rateLabel).toBe("Current variable APY");
  });

  it("waits for the rate, says Earn is mainnet only, and asks for a portfolio first", () => {
    expect(screen({ rate: undefined }).rate).toBeNull();
    expect(screen({ available: false })).toMatchObject({
      mainnetOnly: "Earn is available on Solana mainnet only.",
      deposit: { disabled: true },
    });
    expect(screen({ portfolios: [] }).empty).toEqual({
      title: "Create a portfolio to use Earn.",
      detail: "Earn lends a portfolio's cash.",
      action: "New portfolio",
    });
  });

  it("chooses a portfolio that can take the action", () => {
    expect(earnChoiceView("withdraw", portfolios, "a")).toMatchObject({
      rows: [{ id: "a", detail: "$10.00 in Earn" }],
      next: { label: "Continue with Investing", disabled: false },
    });
  });

  it("checks the amount against what can move and the cost of a withdrawal", () => {
    const cost = { kind: "relayer" as const, fee: 0.05, feeRaw: 50_000n, opens: null, count: 1 };
    const view = (action: "deposit" | "withdraw", amountText: string) =>
      earnAmountView({
        action,
        draft: earnDraft({ action, amountText, cash: 20, deposited: 10, cost }),
        portfolioLabel: "Investing",
        amountText,
        cost,
        apy: 5,
        online: true,
      });
    expect(view("deposit", "10")).toMatchObject({
      lead: "Lend USDC from Investing.",
      estimate: expect.stringMatching(/^About \$0\.50 in a year/),
      review: { label: "Review", disabled: false },
    });
    expect(view("deposit", "30").validation).toBe("More than is available.");
    expect(view("withdraw", "0.01").validation).toBe(
      "This withdrawal is smaller than its own network cost.",
    );
    expect(view("deposit", "0").validation).toBe("Enter an amount greater than zero.");
  });

  it("reviews a deposit and a withdrawal before either is confirmed", () => {
    const cost = {
      kind: "relayer" as const,
      fee: 0.05,
      feeRaw: 50_000n,
      opens: "earn" as const,
      count: 1,
    };
    const deposit = earnReviewView({
      action: "deposit",
      amount: 10,
      portfolioLabel: "Investing",
      cost,
      venue: "Jupiter Lend",
      pending: { blocked: false },
      online: true,
    });
    expect(deposit).toMatchObject({
      title: "Review",
      total: { label: "Total leaving Investing's cash", value: "10.05 USDC" },
      reasons: ["The network cost includes opening this holding, a one-time cost."],
      risk: { link: "Read the risks" },
      confirm: { label: "Deposit 10.00 USDC", disabled: false },
    });
    const withdrawal = earnReviewView({
      action: "withdraw",
      amount: 10,
      portfolioLabel: "Investing",
      cost: { ...cost, opens: null },
      venue: "Jupiter Lend",
      pending: { blocked: true },
      online: true,
    });
    expect(withdrawal).toMatchObject({
      total: { label: "Arrives in Investing's cash", value: "9.95 USDC" },
      reasons: [expect.stringMatching(/paid out of the USDC this returns/)],
      risk: null,
      confirm: { label: "Withdraw 10.00 USDC", disabled: true },
    });
  });

  it("lists the steps and says how it ended, after its cost", () => {
    expect(earnProgressView("deposit", 10).title).toBe("Depositing 10.00 USDC");
    expect(
      earnResultView({
        action: "withdraw",
        outcome: "landed",
        amount: 10,
        fee: 0.05,
        portfolioLabel: "Investing",
      }),
    ).toEqual({ title: "Withdrew 9.95 USDC", body: "Back in Investing's cash.", close: "Done" });
    expect(
      earnResultView({
        action: "deposit",
        outcome: "unknown",
        amount: 10,
        fee: 0,
        portfolioLabel: "Investing",
      }).title,
    ).toBe("Sent, but not confirmed");
  });
});
