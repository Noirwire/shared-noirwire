import { describe, expect, it } from "vitest";
import {
  addressLines,
  addressSegments,
  receiveView,
  spokenAddress,
} from "../../../src/presentation/receive.js";
import { FUNDING_ADDRESS, testWallet } from "../support/screens.js";

describe("receiveView", () => {
  it("shows the funding address masked unless asked to show it, with its one warning", () => {
    const wallet = testWallet();
    const view = (reveal: boolean) =>
      receiveView({
        wallet,
        target: { kind: "funding", reveal },
        network: "devnet",
        platform: "mobile",
      });
    expect(view(false)).toMatchObject({
      kind: "address",
      title: "Your funding address",
      notice: "This first transfer is public and may link the sending address to you.",
      masked: { text: "Your funding address is hidden.", show: "Show address" },
      address: FUNDING_ADDRESS,
      qrLabel: "QR code of your funding address",
      notes: [
        "Only send USDC on Solana. Other assets or networks may be lost.",
        "Once it arrives, move it into a portfolio through the private route.",
      ],
      what: "funding",
    });
    expect(view(true)).toMatchObject({ masked: null });
  });

  it("shows a portfolio's own address at once, and never the funding one beside it", () => {
    const wallet = testWallet();
    const [portfolio] = wallet.portfolios;
    const phone = receiveView({
      wallet,
      target: { kind: "portfolio", id: portfolio.id },
      network: "mainnet-beta",
      platform: "mobile",
    });
    expect(phone).toMatchObject({
      title: "Receive in Investing",
      notice:
        "A transfer straight to this address is public and ties the sender to this portfolio. To move in your own money, use Add money instead.",
      masked: null,
      address: portfolio.address,
      qrLabel: "QR code of Investing's address",
      notes: [
        "Investing's own address on Solana, derived from your recovery phrase. Only send Solana assets to it. Funds sent from another network are lost.",
      ],
    });
    expect(JSON.stringify(phone)).not.toContain(wallet.funding.address);
    const web = receiveView({
      wallet,
      target: { kind: "portfolio", id: portfolio.id },
      network: "devnet",
      platform: "web",
    });
    expect(web.kind === "address" && web.notice).toMatch(/^A transfer straight to this address/);
    expect(web.kind === "address" && web.notes[0]).toMatch(/devnet assets only/);
  });

  it("refuses a missing or archived portfolio", () => {
    const wallet = testWallet((w) => ({
      ...w,
      portfolios: w.portfolios.map((p) => ({ ...p, archivedAt: 1 })),
    }));
    const view = (id: string) =>
      receiveView({
        wallet,
        target: { kind: "portfolio", id },
        network: "devnet",
        platform: "mobile",
      });
    expect(view("gone")).toMatchObject({
      kind: "unavailable",
      message: "That portfolio does not exist.",
    });
    expect(view("acc_1")).toMatchObject({
      kind: "unavailable",
      message: "This portfolio is archived. Restore it before receiving into it.",
    });
  });
});

describe("showing an address", () => {
  const address = "7xKp4tRmQ9wZ2b8nV3cL5dF6gH1jK2mN3pQ4rS5tU6v";

  it("cuts an address into groups of four over two lines", () => {
    expect(addressLines(address)).toEqual([
      "7xKp 4tRm Q9wZ 2b8n V3cL 5dF6",
      "gH1j K2mN 3pQ4 rS5t U6v",
    ]);
  });

  it("is read out one group of four at a time", () => {
    expect(spokenAddress("abcdefgh")).toBe("a b c d, e f g h");
  });

  it("groups by four and marks the first and last six characters", () => {
    const segments = addressSegments("ABCDEFGHIJKLMNOPQRST");
    expect(segments.map((segment) => segment.text).join("")).toBe("ABCD EFGH IJKL MNOP QRST");
    expect(segments).toEqual([
      { text: "ABCD EF", strong: true },
      { text: "GH IJKL MN", strong: false },
      { text: "OP QRST", strong: true },
    ]);
  });
});
