import { commonCopy } from "../copy/common.js";
import { portfolioCopy } from "../copy/portfolio.js";
import type { Wallet } from "../domain/wallet.js";
import { groupsOfFour } from "./importFindings.js";

/** Whose address the sheet shows: the funding wallet, or one portfolio by its id. */
export type ReceiveTarget =
  { kind: "funding"; reveal: boolean } | { kind: "portfolio"; id: string };

export type ReceiveView =
  | {
      kind: "address";
      title: string;
      notice: string;
      /** The address starts hidden, with a control to show it. */
      masked: { text: string; show: string } | null;
      address: string;
      qrLabel: string;
      copy: string;
      copied: string;
      notes: string[];
      /** Which address a copy counts as, for usage analytics. */
      what: "funding" | "portfolio";
    }
  | { kind: "unavailable"; title: string; message: string };

/**
 * One address, as text and as a QR code, with the one warning that applies
 * to it. Never both addresses on one sheet.
 */
export function receiveView(state: {
  wallet: Wallet;
  target: ReceiveTarget;
  network: "mainnet-beta" | "devnet";
}): ReceiveView {
  const { wallet, target } = state;
  const words = portfolioCopy.receive;
  if (target.kind === "funding") {
    return {
      kind: "address",
      title: words.fundingTitle,
      notice: words.fundingNotice,
      masked: target.reveal ? null : { text: words.hiddenFunding, show: words.showAddress },
      address: wallet.funding.address,
      qrLabel: words.qrFunding,
      copy: words.copyAddress,
      copied: words.copied,
      notes: [portfolioCopy.addMoney.onlyUsdc(commonCopy.solana), words.afterArrival],
      what: "funding",
    };
  }
  const portfolio = wallet.portfolios.find((entry) => entry.id === target.id);
  if (!portfolio) {
    return { kind: "unavailable", title: words.title, message: portfolioCopy.notFound.message };
  }
  const title = words.portfolioTitle(portfolio.label);
  if (portfolio.archivedAt !== null) {
    return { kind: "unavailable", title, message: words.archived };
  }
  const tail = state.network === "mainnet-beta" ? words.mainnet : words.testNetwork;
  return {
    kind: "address",
    title,
    notice: words.publicNote,
    masked: null,
    address: portfolio.address,
    qrLabel: words.qrPortfolio(portfolio.label),
    copy: words.copyAddress,
    copied: words.copied,
    notes: [words.lead(portfolio.label, commonCopy.solana) + tail],
    what: "portfolio",
  };
}

/**
 * An address as it is shown once revealed: groups of four over two lines,
 * the first line taking the extra group when the count is odd.
 */
export function addressLines(address: string): [string, string] {
  const groups = groupsOfFour(address);
  const split = Math.ceil(groups.length / 2);
  return [groups.slice(0, split).join(" "), groups.slice(split).join(" ")];
}

/** What a screen reader says for a revealed address: each group of four, one after another. */
export function spokenAddress(address: string): string {
  return groupsOfFour(address)
    .map((group) => group.split("").join(" "))
    .join(", ");
}

/** An address in groups of four, the first and last six characters marked to stand out. */
export function addressSegments(address: string): { text: string; strong: boolean }[] {
  const segments: { text: string; strong: boolean }[] = [];
  [...address].forEach((char, index) => {
    const strong = index < 6 || index >= address.length - 6;
    const text = `${index > 0 && index % 4 === 0 ? " " : ""}${char}`;
    const last = segments[segments.length - 1];
    if (last && last.strong === strong) last.text += text;
    else segments.push({ text, strong });
  });
  return segments;
}
