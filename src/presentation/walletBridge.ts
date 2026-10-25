import { shortAddress } from "../domain/format.js";
import type { Refusal } from "../domain/walletBridge/protocol.js";
import type { DecodedRequest, DecodedTransaction } from "../domain/walletBridge/request.js";
import { walletBridgeCopy } from "../copy/walletBridge.js";

/**
 * The approval screen for one request to sign, drawn from what the wallet
 * read in it. Amounts are written from atoms by their digits, never through
 * a floating-point number.
 */

const USDC_DECIMALS = 6;
const LAMPORTS_PER_SIGNATURE = 5_000n;

export type ApprovalAccount = { label: string; address: string };

export type NetworkCheck = "checking" | "passed";

export type ApprovalView = {
  /** Who is signing, on every screen. */
  account: ApprovalAccount;
  where: string | null;
  title: string;
  lines: string[];
  cost: string;
  check: string;
  /** The trading keys an opening or a device change sets: shortened for reading, in full on demand. */
  orderKeys: { short: string; full: string }[];
  orderKeysLabel: string | null;
  /** For anyone who wants to check: each instruction, and every account with its role. */
  details: { program: string; name: string; accounts: string[] }[];
  canApprove: boolean;
};

function grouped(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** USDC atoms as "50.00": at least two places, and every nonzero place up to six. */
export function usdcText(atoms: bigint): string {
  const digits = atoms.toString().padStart(USDC_DECIMALS + 1, "0");
  const whole = digits.slice(0, digits.length - USDC_DECIMALS);
  const fraction = digits.slice(-USDC_DECIMALS).replace(/0+$/, "").padEnd(2, "0");
  return `${grouped(whole)}.${fraction}`;
}

/** Lamports as SOL, from their digits, with every nonzero place up to nine. */
export function solText(lamports: bigint): string {
  const digits = lamports.toString().padStart(10, "0");
  const whole = digits.slice(0, digits.length - 9);
  const fraction = digits.slice(-9).replace(/0+$/, "");
  return fraction ? `${grouped(whole)}.${fraction}` : grouped(whole);
}

/**
 * The most a Solana request can cost: the signature fee for each signer, and
 * `rentPerAccount` for each account it can open. Null for a request that is
 * not on Solana.
 */
export function networkFeeUpperBound(
  decoded: DecodedTransaction,
  rentPerAccount: bigint,
): bigint | null {
  if (decoded.network !== "solana") return null;
  return (
    LAMPORTS_PER_SIGNATURE * BigInt(decoded.signatureCount) +
    rentPerAccount * BigInt(decoded.accountsOpened)
  );
}

function amountOf(decoded: DecodedTransaction): string {
  return usdcText(decoded.amountAtoms ?? 0n);
}

function summary(decoded: DecodedRequest, account: ApprovalAccount) {
  if (decoded.type === "signIn") {
    return {
      title: walletBridgeCopy.signIn.title(account.label),
      lines: [...walletBridgeCopy.signIn.lines],
    };
  }
  switch (decoded.kind) {
    case "openTrader":
      return {
        title: walletBridgeCopy.openTrader.title,
        lines: [...walletBridgeCopy.openTrader.lines],
      };
    case "setOrderKeys":
      return {
        title: walletBridgeCopy.setOrderKeys.title,
        lines: [...walletBridgeCopy.setOrderKeys.lines],
      };
    case "deposit":
      return {
        title: walletBridgeCopy.deposit.title(amountOf(decoded)),
        lines: [...walletBridgeCopy.deposit.lines],
      };
    case "withdraw":
      return {
        title: walletBridgeCopy.withdraw.title(amountOf(decoded)),
        lines: [...walletBridgeCopy.withdraw.lines],
      };
    case "depositToRollup":
      return {
        title: walletBridgeCopy.depositToRollup.title(amountOf(decoded), account.label),
        lines: [...walletBridgeCopy.depositToRollup.lines],
      };
    case "withdrawToSolana":
      return {
        title: walletBridgeCopy.withdrawToSolana.title(amountOf(decoded), account.label),
        lines: [...walletBridgeCopy.withdrawToSolana.lines],
      };
  }
}

function costLine(decoded: DecodedRequest, account: ApprovalAccount, feeLamports: bigint | null) {
  if (decoded.type === "signIn" || decoded.network === "rollup") return walletBridgeCopy.noFee;
  return walletBridgeCopy.fee(solText(feeLamports ?? 0n), account.label);
}

function whereLine(decoded: DecodedRequest): string | null {
  if (decoded.type === "signIn") return null;
  return walletBridgeCopy.where[decoded.network];
}

/**
 * The approval screen for `decoded`. `feeLamports` is the Solana fee's upper
 * bound (`networkFeeUpperBound`), or null where there is none to show.
 */
export function approvalView(
  decoded: DecodedRequest,
  account: ApprovalAccount,
  feeLamports: bigint | null,
  networkCheck: NetworkCheck,
): ApprovalView {
  const { title, lines } = summary(decoded, account);
  return {
    account,
    where: whereLine(decoded),
    title,
    lines,
    cost: costLine(decoded, account, feeLamports),
    check: walletBridgeCopy.check,
    orderKeys:
      decoded.type === "transaction"
        ? (decoded.orderKeys ?? []).map((full) => ({ short: shortAddress(full), full }))
        : [],
    orderKeysLabel:
      decoded.type === "transaction" && decoded.orderKeys ? walletBridgeCopy.orderKeys : null,
    details:
      decoded.type === "signIn"
        ? []
        : decoded.instructions.map((step) => ({
            program: step.program,
            name: step.name,
            accounts: step.accounts.map(
              (entry) =>
                `${entry.address}${entry.signer ? " signer" : ""}${entry.writable ? " writable" : ""}`,
            ),
          })),
    canApprove: networkCheck === "passed",
  };
}

/** What a refusal tells the person who sees it. */
export function refusalText(refusal: Refusal): string {
  return walletBridgeCopy.refusals[refusal];
}
