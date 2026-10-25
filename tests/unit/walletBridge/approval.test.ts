import { describe, expect, it } from "vitest";
import type { DecodedTransaction } from "../../../src/domain/walletBridge/request.js";
import {
  approvalView,
  networkFeeUpperBound,
  solText,
  usdcText,
} from "../../../src/presentation/walletBridge.js";

const ACCOUNT = { label: "Portfolio 1", address: "11111111111111111111111111111112" };

const transaction = (over: Partial<DecodedTransaction>): DecodedTransaction => ({
  type: "transaction",
  kind: "withdraw",
  network: "rollup",
  owner: ACCOUNT.address,
  amountAtoms: 50_000_000n,
  feePayer: ACCOUNT.address,
  signatureCount: 1,
  recentBlockhash: "x",
  accountsOpened: 0,
  instructions: [],
  ...over,
});

describe("the amounts on the approval screen", () => {
  it.each([
    [50_000_000n, "50.00"],
    [1n, "0.000001"],
    [12_340_000n, "12.34"],
    [1_234_567_891_234n, "1,234,567.891234"],
    [7_000_001n, "7.000001"],
    [0n, "0.00"],
  ])("writes %s atoms of USDC as %s", (atoms, text) => {
    expect(usdcText(atoms)).toBe(text);
  });

  it("writes lamports as SOL from their digits", () => {
    expect(solText(5_000n)).toBe("0.000005");
    expect(solText(2_039_280n)).toBe("0.00203928");
    expect(solText(1_000_000_000n)).toBe("1");
  });
});

describe("the approval screen", () => {
  it("names the account, the place and the amount the wallet read", () => {
    const view = approvalView(transaction({}), ACCOUNT, null, "passed");
    expect(view).toMatchObject({
      account: ACCOUNT,
      where: "Trading network",
      title: "Withdraw 50.00 USDC from your trading account",
      cost: "No fee",
      canApprove: true,
    });
  });

  it("keeps Approve off until the network is checked", () => {
    expect(approvalView(transaction({}), ACCOUNT, null, "checking").canApprove).toBe(false);
  });

  it("states an upper bound for the fee on Solana, and none on the rollup", () => {
    const onSolana = transaction({
      kind: "depositToRollup",
      network: "solana",
      signatureCount: 1,
      accountsOpened: 3,
    });
    expect(networkFeeUpperBound(onSolana, 2_039_280n)).toBe(6_122_840n);
    expect(networkFeeUpperBound(transaction({}), 2_039_280n)).toBeNull();
    const view = approvalView(onSolana, ACCOUNT, 6_122_840n, "passed");
    expect(view.where).toBe("Solana");
    expect(view.cost).toContain("0.00612284 SOL");
  });

  it("shows a sign-in as moving no money", () => {
    const view = approvalView(
      { type: "signIn", address: ACCOUNT.address, timestamp: 1 },
      ACCOUNT,
      null,
      "passed",
    );
    expect(view.where).toBeNull();
    expect(view.cost).toBe("No fee");
    expect(view.lines.join(" ")).toContain("moves no money");
  });
});
