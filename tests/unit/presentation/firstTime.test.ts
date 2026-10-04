import { describe, expect, it } from "vitest";
import { TRADE_CASH_DECIMALS } from "../../../src/application/trade.js";
import { fundingCopy, mobileFundingCopy, privateMoveTiming } from "../../../src/copy/funding.js";
import { walletCopy } from "../../../src/copy/wallet.js";
import {
  PRIVACY_FEE_BPS,
  RELAY_FEE_RAW,
  SETTLEMENT_DELAY_MS,
} from "../../../src/domain/privateTransfer.js";
import { MIN_PASSWORD_LENGTH } from "../../../src/domain/wallet.js";
import { addMoneyView } from "../../../src/presentation/addMoney.js";
import { costsView, privateMoveCostText } from "../../../src/presentation/costs.js";
import { newPasswordView } from "../../../src/presentation/password.js";
import { noMoneyView } from "../../../src/presentation/trade.js";
import { unlockProblemView } from "../../../src/presentation/unlock.js";
import { unreachableView } from "../../../src/presentation/unreachable.js";
import { welcomeView } from "../../../src/presentation/welcome.js";
import { assessPasswordWith } from "../../../src/wallet/passwordStrength.js";
import {
  FUNDING_ADDRESS,
  holding,
  testReads,
  testWallet,
  withFirst,
  withHolding,
} from "../support/screens.js";

const reads = testReads();

describe("welcomeView", () => {
  it("says what the app is for, with one filled button, on both platforms", () => {
    for (const platform of ["web", "mobile"] as const) {
      const view = welcomeView(platform);
      expect(view.title).toBe("Invest in US stock trackers. Privately.");
      expect(view.lines).toEqual([
        "Trackers follow share prices like Apple, Tesla or the S&P 500. You do not own the shares.",
        "Each portfolio is separate from your funding wallet. Trades themselves are public.",
      ]);
      expect(view.actions).toEqual([
        { kind: "create", label: "Create a wallet", filled: true },
        { kind: "restore", label: "Restore a wallet", filled: false },
        { kind: "explore", label: "Explore trackers", filled: false },
      ]);
      expect(view.trust).toBe(
        "No account and no ID check. Only your recovery words can restore your wallet.",
      );
    }
  });

  it("says nothing about the server, and offers nothing meant for a developer", () => {
    for (const platform of ["web", "mobile"] as const) {
      expect(JSON.stringify(welcomeView(platform))).not.toMatch(/server|request|UI kit/i);
    }
  });

  it("shows the example portfolios on the web only", () => {
    expect(welcomeView("mobile").example).toBeNull();
    expect(welcomeView("web").example).toMatchObject({
      heading: "Your portfolios",
      badge: "Example",
      steps: [
        "One recovery phrase for the whole wallet",
        "A separate address for each portfolio",
        "Add money, then invest in trackers",
      ],
    });
  });
});

describe("what a private move costs", () => {
  const flat = Number(RELAY_FEE_RAW) / 10 ** TRADE_CASH_DECIMALS;

  it("is said from the constants the review charges by", () => {
    expect(privateMoveCostText()).toBe(`${PRIVACY_FEE_BPS / 100}% + $${flat.toFixed(2)}`);
    expect(privateMoveCostText()).toBe("0.1% + $0.20");
  });
});

describe("how long a private move takes", () => {
  it("is one sentence, the same in the add-money step, in Costs and on the funding sheet", () => {
    const timing = "It usually arrives within a minute and can take a few.";
    expect(privateMoveTiming).toBe(timing);
    expect(addMoneyView(testWallet()).steps[2].detail.endsWith(timing)).toBe(true);
    expect(costsView({ tradeFeeBps: 50 }).lines[1].endsWith(timing)).toBe(true);
    expect(fundingCopy.privateCosts(0.1, "0.20 USDC", "USDC", "0.50 USDC").endsWith(timing)).toBe(
      true,
    );
    expect(mobileFundingCopy.costs("0.50 USDC").endsWith(timing)).toBe(true);
  });

  it("promises no more than the app itself waits for an arrival", () => {
    expect(SETTLEMENT_DELAY_MS.max).toBeLessThanOrEqual(60_000);
  });
});

describe("costsView", () => {
  it("states each cost, the trading fee from the figure the app is set up with", () => {
    expect(costsView({ tradeFeeBps: 50 })).toEqual({
      title: "Costs",
      lines: [
        "Buying or selling a tracker: 0.5% of the trade.",
        "Moving money into a portfolio privately: 0.1% + $0.20. It usually arrives within a minute and can take a few.",
        "Network cost: a few cents, paid automatically from your USDC.",
        "Getting USDC from another service: that service may charge its own fee.",
        "The exact amount is always shown before you confirm.",
      ],
    });
  });

  it("renders the numbers the constants hold, whatever they are", () => {
    for (const tradeFeeBps of [50, 75, 100, 255]) {
      expect(costsView({ tradeFeeBps }).lines[0]).toBe(
        `Buying or selling a tracker: ${tradeFeeBps / 100}% of the trade.`,
      );
    }
    expect(costsView({ tradeFeeBps: 50 }).lines[1]).toBe(
      `Moving money into a portfolio privately: ${privateMoveCostText()}. It usually arrives within a minute and can take a few.`,
    );
  });

  it("states no trading fee where none is set, and says where it is shown", () => {
    expect(costsView({ tradeFeeBps: 0 }).lines[0]).toBe(
      "Buying or selling a tracker: the fee is shown in the review.",
    );
  });
});

describe("addMoneyView", () => {
  const view = addMoneyView(testWallet());

  it("explains adding digital dollars in three steps", () => {
    expect(view.title).toBe("Add digital dollars");
    expect(view.steps.map((step) => step.title)).toEqual([
      "Get USDC",
      "Send it to your funding wallet",
      "Move it into a portfolio",
    ]);
    expect(view.steps[0].detail).toBe(
      "USDC is a digital dollar: 1 USDC = $1. Send it from any app or wallet that supports USDC on the Solana network. You do not need an account with us.",
    );
    expect(view.steps[2].detail).toBe(
      `When it arrives, choose a portfolio and tap Move to portfolio. A private move is not linked to your funding wallet in the public record. It costs ${privateMoveCostText()}. It usually arrives within a minute and can take a few.`,
    );
  });

  it("holds the person's own funding wallet address in the second step, already shown", () => {
    expect(view.steps.map((step) => step.address !== null)).toEqual([false, true, false]);
    expect(view.steps[1].address).toMatchObject({
      address: FUNDING_ADDRESS,
      copy: "Copy address",
      copyDescribe: "Copy funding wallet address",
      network: "Network: Solana",
      captureAllowed: true,
    });
    expect(view.steps[1].address?.lines.join(" ").replaceAll(" ", "")).toBe(FUNDING_ADDRESS);
    expect(view.steps[1].address).not.toHaveProperty("masked");
  });

  it("leads to the costs from its footer, and names no service to buy from", () => {
    expect(view.footer).toEqual({ label: "What does it cost?", target: { to: "costs" } });
    expect(JSON.stringify(view)).not.toMatch(/exchange/i);
  });
});

describe("unreachableView", () => {
  it("tells someone with no wallet about the connection, never about balances", () => {
    expect(unreachableView({ hasWallet: false, locked: false })).toEqual({
      message: "Can't reach NoirWire. Check your connection and try again.",
      retry: "Try again",
      unlockOffered: false,
    });
  });

  it("says the same over a locked wallet, and still offers to unlock it", () => {
    expect(unreachableView({ hasWallet: true, locked: true })).toEqual({
      message: "Can't reach NoirWire. Check your connection and try again.",
      retry: "Try again",
      unlockOffered: true,
    });
  });

  it("speaks of balances only once a wallet is unlocked", () => {
    expect(unreachableView({ hasWallet: true, locked: false })).toEqual({
      message: "We can't show your balances right now. Your money has not moved. Try again.",
      retry: "Try again",
      unlockOffered: false,
    });
  });
});

describe("newPasswordView", () => {
  it("states the rule up front, in each platform's words", () => {
    expect(newPasswordView().rule).toBe(
      "Choose a password of at least 12 characters. It locks the wallet in this browser. We never see it.",
    );
    expect(newPasswordView("mobile").rule).toBe(
      "Choose a password of at least 12 characters. It locks the wallet on this phone. We never see it.",
    );
    expect(newPasswordView().title).toBe("Set a password");
  });

  it("states the length the strength check enforces", () => {
    expect(newPasswordView().rule).toContain(`at least ${MIN_PASSWORD_LENGTH} characters`);
    const strong = { check: () => ({ guessesLog10: 20 }) };
    expect(assessPasswordWith(strong, "x".repeat(MIN_PASSWORD_LENGTH - 1)).ok).toBe(false);
    expect(assessPasswordWith(strong, "x".repeat(MIN_PASSWORD_LENGTH)).ok).toBe(true);
  });
});

describe("unlockProblemView", () => {
  it("keeps a wrong password in the field, selected, with the reason under it", () => {
    expect(unlockProblemView(walletCopy.store.wrongPassword)).toEqual({
      text: "That password does not match this wallet.",
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
      text: "There is no wallet on this phone.",
      underField: false,
      typed: "keep",
    });
  });
});

describe("noMoneyView", () => {
  const funded = (usdc: number) =>
    testWallet((wallet) => ({ ...wallet, funding: { ...wallet.funding, tokens: { USDC: usdc } } }));

  it("says nothing when the portfolio has money to buy with", () => {
    const wallet = withFirst((first) => withHolding(first, holding("USDC", 25)));
    expect(noMoneyView(reads, wallet, "acc_1")).toBeNull();
    expect(noMoneyView(reads, wallet, null)).toBeNull();
  });

  it("says it on the first tap and leads to adding money when none has arrived", () => {
    expect(noMoneyView(reads, testWallet(), "acc_1")).toEqual({
      title: "No money in this portfolio yet",
      detail: "Your money arrives in your funding wallet. Then you move it into a portfolio.",
      action: { label: "Add money", target: { to: "addMoney" } },
    });
  });

  it("leads to moving it in when USDC is waiting in the funding wallet", () => {
    expect(noMoneyView(reads, funded(40), "acc_1")).toEqual({
      title: "No money in this portfolio yet",
      detail: "Move money into this portfolio first.",
      action: { label: "Move to portfolio", target: { to: "fund", portfolioId: "acc_1" } },
    });
  });

  it("speaks of every portfolio when none is chosen yet", () => {
    expect(noMoneyView(reads, testWallet(), null)).toMatchObject({
      title: "No money in your portfolios yet",
      action: { label: "Add money", target: { to: "addMoney" } },
    });
    expect(noMoneyView(reads, funded(40), null)?.action.target).toEqual({ to: "fund" });
  });

  it("looks only at the chosen portfolio when another one has money", () => {
    const wallet = testWallet((w) => ({
      ...w,
      portfolios: [
        w.portfolios[0],
        { ...withHolding(w.portfolios[0], holding("USDC", 9)), id: "acc_2", label: "Trips" },
      ],
    }));
    expect(noMoneyView(reads, wallet, "acc_1")?.title).toBe("No money in this portfolio yet");
    expect(noMoneyView(reads, wallet, "acc_2")).toBeNull();
    expect(noMoneyView(reads, wallet, null)).toBeNull();
  });
});
