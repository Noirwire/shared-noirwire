import { commonCopy } from "../copy/common.js";
import { portfolioCopy } from "../copy/portfolio.js";
import type { Wallet } from "../domain/wallet.js";
import { costsView, privateMoveCostText, type CostsState } from "./costs.js";
import { addressLines, spokenAddress } from "./receive.js";

export type AddMoneyAddress = {
  address: string;
  /** The address as it is shown: groups of four over two lines. */
  lines: [string, string];
  spoken: string;
  copy: string;
  copyDescribe: string;
  copied: string;
  /** "Network: Solana", small, under the address. */
  network: string;
  /**
   * The person's own funding wallet address is what they give to another
   * service, so a screenshot of it is allowed. Nothing else on a wallet
   * screen is.
   */
  captureAllowed: true;
};

export type AddMoneyView = {
  title: string;
  /** In order. The second holds the address, shown at once with nothing to tap first. */
  steps: { title: string; detail: string; address: AddMoneyAddress | null }[];
  /**
   * "What does it cost?", opened in place: tapping the label shows the same
   * lines the Costs page has, under it, inside the sheet. The person never
   * leaves the sheet, so the address stays on screen.
   */
  costs: { label: string; lines: string[]; expandedByDefault: false };
};

/**
 * Bringing money in from outside, as one sheet: get USDC, send it to the
 * funding wallet, move it into a portfolio. The address is the person's own
 * funding wallet's and is already revealed. `costs` is what `costsView`
 * takes: the app's own trading fee.
 */
export function addMoneyView(wallet: Wallet, costs: CostsState): AddMoneyView {
  const copy = portfolioCopy.addMoney;
  const { address } = wallet.funding;
  return {
    title: copy.title,
    steps: [
      {
        title: copy.steps.get.title,
        detail: copy.steps.get.detail(commonCopy.solana),
        address: null,
      },
      {
        title: copy.steps.send.title,
        detail: copy.steps.send.detail(commonCopy.solana),
        address: {
          address,
          lines: addressLines(address),
          spoken: spokenAddress(address),
          copy: copy.copyAddress,
          copyDescribe: copy.copyDescribe,
          copied: portfolioCopy.receive.copied,
          network: copy.network(commonCopy.solana),
          captureAllowed: true,
        },
      },
      {
        title: copy.steps.move.title,
        detail: copy.steps.move.detail(privateMoveCostText()),
        address: null,
      },
    ],
    costs: { label: copy.costsLink, lines: costsView(costs).lines, expandedByDefault: false },
  };
}
