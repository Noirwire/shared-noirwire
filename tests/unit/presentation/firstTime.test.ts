import { describe, expect, it } from "vitest";
import { TRADE_CASH_DECIMALS } from "../../../src/application/trade.js";
import { fundingCopy, mobileFundingCopy, privateMoveTiming } from "../../../src/copy/funding.js";
import { appCopy } from "../../../src/copy/app.js";
import { mobileWalletCopy, walletCopy } from "../../../src/copy/wallet.js";
import {
  PRIVACY_FEE_BPS,
  RELAY_FEE_RAW,
  SETTLEMENT_DELAY_MS,
} from "../../../src/domain/privateTransfer.js";
import { MIN_PASSWORD_LENGTH, type Wallet } from "../../../src/domain/wallet.js";
import { aboutView, betaView } from "../../../src/presentation/about.js";
import { addMoneyView } from "../../../src/presentation/addMoney.js";
import { costsView, privateMoveCostText } from "../../../src/presentation/costs.js";
import { discardPromptView } from "../../../src/presentation/discard.js";
import { newPasswordView } from "../../../src/presentation/password.js";
import { noMoneyView } from "../../../src/presentation/trade.js";
import { unlockProblemView } from "../../../src/presentation/unlock.js";
import { unreachableView } from "../../../src/presentation/unreachable.js";
import { welcomeView } from "../../../src/presentation/welcome.js";
import { assessPasswordWith } from "../../../src/wallet/passwordStrength.js";
import {
  FIRST_READ_FAILED,
  FIRST_READ_PENDING,
  FUNDING_ADDRESS,
  READ,
  holding,
  testReads,
  testWallet,
  withFirst,
  withHolding,
} from "../support/screens.js";

const reads = testReads();

describe("welcomeView", () => {
  it("offers three ways in with one filled button, on both platforms", () => {
    for (const platform of ["web", "mobile"] as const) {
      const view = welcomeView(platform);
      expect(view.actions.map((action) => [action.kind, action.filled])).toEqual([
        ["create", true],
        ["restore", false],
        ["explore", false],
      ]);
      expect(view.actions[1].label).toMatch(/^Restore\b/);
      expect(JSON.stringify(view)).not.toMatch(/server|request|UI kit/i);
    }
  });

  it("shows the example portfolios on the web only", () => {
    expect(welcomeView("mobile").example).toBeNull();
    expect(welcomeView("web").example?.portfolios.length).toBeGreaterThan(0);
  });
});

describe("what a private move costs", () => {
  const flat = Number(RELAY_FEE_RAW) / 10 ** TRADE_CASH_DECIMALS;

  it("is said from the constants the review charges by, wherever it is said", () => {
    const cost = `${PRIVACY_FEE_BPS / 100}% + $${flat.toFixed(2)}`;
    expect(privateMoveCostText()).toBe(cost);
    expect(costsView({ tradeFeeBps: 50 }).lines[1]).toContain(cost);
    expect(addMoneyView(testWallet(), { tradeFeeBps: 50 }).steps[2].detail).toContain(cost);
  });
});

describe("how long a private move takes", () => {
  it("is one sentence, the same in the add-money step and on the funding sheet", () => {
    const said = [
      addMoneyView(testWallet(), { tradeFeeBps: 50 }).steps[2].detail,
      fundingCopy.privateCosts(0.1, "0.20 USDC", "USDC", "0.50 USDC"),
      mobileFundingCopy.costs("0.50 USDC"),
    ];
    for (const text of said) expect(text.endsWith(privateMoveTiming)).toBe(true);
  });

  it("is not said among the costs, which state prices only", () => {
    const sheet = addMoneyView(testWallet(), { tradeFeeBps: 50 });
    for (const line of [...costsView({ tradeFeeBps: 50 }).lines, ...sheet.costs.lines]) {
      expect(line).not.toContain(privateMoveTiming);
    }
    const timed = sheet.steps.filter((step) => step.detail.includes(privateMoveTiming));
    expect(timed).toHaveLength(1);
  });

  it("promises no more than the app itself waits for an arrival", () => {
    expect(SETTLEMENT_DELAY_MS.max).toBeLessThanOrEqual(60_000);
  });
});

describe("costsView", () => {
  const tradeLine = (state: Parameters<typeof costsView>[0]) => costsView(state).lines[0];

  it("states five costs, the trading fee from the figure the app is set up with", () => {
    expect(costsView({ tradeFeeBps: 50 }).lines).toHaveLength(5);
    for (const tradeFeeBps of [50, 75, 100, 255]) {
      expect(tradeLine({ tradeFeeBps })).toContain(`${tradeFeeBps / 100}% of the trade`);
    }
  });

  it("says there is no NoirWire fee where the fee is zero or not set, and never points elsewhere", () => {
    const none = [{ tradeFeeBps: 0 }, { tradeFeeBps: null }, { tradeFeeBps: undefined }, {}];
    for (const state of none) {
      expect(tradeLine(state)).toMatch(/no NoirWire fee/);
      expect(tradeLine(state)).not.toMatch(/%|review/);
    }
    expect(tradeLine({ tradeFeeBps: 50 })).not.toMatch(/no NoirWire fee/);
  });
});

describe("addMoneyView", () => {
  const view = addMoneyView(testWallet(), { tradeFeeBps: 50 });

  it("is three steps with the person's own main wallet address in the second, already shown", () => {
    expect(view.steps.map((step) => step.address !== null)).toEqual([false, true, false]);
    expect(view.steps[1].address).toMatchObject({ address: FUNDING_ADDRESS, captureAllowed: true });
    expect(view.steps[1].address?.lines.join(" ").replaceAll(" ", "")).toBe(FUNDING_ADDRESS);
    expect(view.steps[1].address).not.toHaveProperty("masked");
  });

  it("says in the first step what USDC is and how to get it, naming no one to buy from", () => {
    expect(view.steps[0].detail).toMatch(/1 USDC = \$1/);
    expect(view.steps[0].detail).toMatch(/\bBuy it\b.*\bsend it on the Solana network\b/);
    expect(view.steps[0].detail).not.toMatch(/cannot|can't|not yet/i);
    expect(JSON.stringify(view)).not.toMatch(/exchange/i);
  });

  it("opens the costs in place, closed at first, with the lines the Costs page has", () => {
    expect(view.costs.expandedByDefault).toBe(false);
    expect(view.costs.lines).toEqual(costsView({ tradeFeeBps: 50 }).lines);
    expect(addMoneyView(testWallet(), {}).costs.lines).toEqual(costsView({}).lines);
    // Nothing on the sheet leads away from it: the address stays on screen.
    expect(view).not.toHaveProperty("footer");
    expect(JSON.stringify(view)).not.toMatch(/"target"|"to":/);
  });
});

describe("unreachableView", () => {
  const gate = appCopy.networkGate;

  it("tells someone with no wallet about the connection, never about balances", () => {
    expect(unreachableView({ hasWallet: false, locked: false })).toEqual({
      message: gate.cannotReach,
      retry: gate.retry,
      unlockOffered: false,
    });
    expect(gate.cannotReach).not.toMatch(/balance|money/i);
  });

  it("says the same over a locked wallet, and still offers to unlock it", () => {
    expect(unreachableView({ hasWallet: true, locked: true })).toEqual({
      message: gate.cannotReach,
      retry: gate.retry,
      unlockOffered: true,
    });
  });

  it("speaks of balances only once a wallet is unlocked", () => {
    expect(unreachableView({ hasWallet: true, locked: false })).toEqual({
      message: gate.unreachable,
      retry: gate.retry,
      unlockOffered: false,
    });
  });
});

describe("newPasswordView", () => {
  it("states, before anything is typed, the length the strength check enforces", () => {
    for (const platform of ["web", "mobile"] as const) {
      expect(newPasswordView(platform).rule).toContain(
        `at least ${MIN_PASSWORD_LENGTH} characters`,
      );
    }
    expect(newPasswordView("mobile").rule).not.toMatch(/browser/);
    const strong = { check: () => ({ guessesLog10: 20 }) };
    expect(assessPasswordWith(strong, "x".repeat(MIN_PASSWORD_LENGTH - 1)).ok).toBe(false);
    expect(assessPasswordWith(strong, "x".repeat(MIN_PASSWORD_LENGTH)).ok).toBe(true);
  });
});

describe("unlockProblemView", () => {
  it("keeps a wrong password in the field, selected, with the reason under it", () => {
    expect(unlockProblemView(walletCopy.store.wrongPassword)).toEqual({
      text: walletCopy.store.wrongPassword,
      underField: true,
      typed: "keepSelected",
    });
  });

  it("shows any other problem as a notice, in the platform's words, and clears nothing", () => {
    expect(unlockProblemView(walletCopy.store.interrupted)).toEqual({
      text: walletCopy.store.interrupted,
      underField: false,
      typed: "keep",
    });
    expect(unlockProblemView(walletCopy.store.noWallet, "mobile")).toEqual({
      text: mobileWalletCopy.store.noWallet,
      underField: false,
      typed: "keep",
    });
  });
});

describe("aboutView", () => {
  it("makes the help contact and the website something to tap", () => {
    const view = aboutView();
    expect(view.help.action).toEqual({ kind: "email", url: `mailto:${view.help.value}` });
    expect(view.website.action).toEqual({ kind: "website", url: `https://${view.website.value}` });
    expect(view.help.value).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]+$/);
    expect(new URL(view.website.action.url).protocol).toBe("https:");
    expect(new URL(view.help.action.url).protocol).toBe("mailto:");
  });
});

describe("discardPromptView", () => {
  it("says what discarding loses, with a way to stay and a way to go", () => {
    const view = discardPromptView();
    expect(view.body).toMatch(/\blost\b/);
    expect(new Set([view.title, view.body, view.keep, view.discard]).size).toBe(4);
  });
});

describe("noMoneyView", () => {
  const noMoney = (wallet: Wallet, portfolioId: string | null) =>
    noMoneyView(reads, wallet, portfolioId, READ);
  const funded = (usdc: number) =>
    testWallet((wallet) => ({ ...wallet, funding: { ...wallet.funding, tokens: { USDC: usdc } } }));

  it("says nothing when the portfolio has money to buy with", () => {
    const wallet = withFirst((first) => withHolding(first, holding("USDC", 25)));
    expect(noMoney(wallet, "acc_1")).toBeNull();
    expect(noMoney(wallet, null)).toBeNull();
  });

  it("says it on the first tap and leads to adding money when none has arrived", () => {
    expect(noMoney(testWallet(), "acc_1")).toEqual({
      title: "No money in this portfolio yet",
      detail: "Your money arrives in your main wallet. Then you move it into a portfolio.",
      action: { label: "Add money", target: { to: "addMoney" } },
    });
  });

  it("leads to moving it in when USDC is waiting in the main wallet", () => {
    expect(noMoney(funded(40), "acc_1")).toEqual({
      title: "No money in this portfolio yet",
      detail: "Move money into this portfolio first.",
      action: { label: "Move to portfolio", target: { to: "fund", portfolioId: "acc_1" } },
    });
  });

  it("speaks of every portfolio when none is chosen yet", () => {
    expect(noMoney(testWallet(), null)).toMatchObject({
      title: "No money in your portfolios yet",
      action: { label: "Add money", target: { to: "addMoney" } },
    });
    expect(noMoney(funded(40), null)?.action.target).toEqual({ to: "fund" });
  });

  it("looks only at the chosen portfolio when another one has money", () => {
    const wallet = testWallet((w) => ({
      ...w,
      portfolios: [
        w.portfolios[0],
        { ...withHolding(w.portfolios[0], holding("USDC", 9)), id: "acc_2", label: "Trips" },
      ],
    }));
    expect(noMoney(wallet, "acc_1")?.title).toBe("No money in this portfolio yet");
    expect(noMoney(wallet, "acc_2")).toBeNull();
    expect(noMoney(wallet, null)).toBeNull();
  });

  it("does not say there is no money while balances have never been read", () => {
    for (const balances of [FIRST_READ_FAILED, FIRST_READ_PENDING]) {
      expect(noMoneyView(reads, testWallet(), "acc_1", balances)).toBeNull();
    }
  });
});

describe("betaView", () => {
  it("is a short tag for the header and a line for About, said on every network", () => {
    const view = betaView();
    expect(view.tag.length).toBeGreaterThan(0);
    expect(view.tag.length).toBeLessThan(view.line.length);
    expect(aboutView().beta).toBe(view.line);
    expect(betaView.length).toBe(0);
    expect(`${view.tag} ${view.line}`).not.toMatch(/network|mainnet|devnet/i);
  });
});
