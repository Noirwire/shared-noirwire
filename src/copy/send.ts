import type { Unsendable } from "../domain/recipients.js";

/** Sending from a portfolio to an address. */
export const sendCopy = {
  title: "Send from portfolio",
  empty: "This portfolio is empty.",

  recipientPlaceholder: "Recipient address",
  recipientLabel: "Recipient Solana address",
  pasteWarning:
    "Pasted text contains characters outside the base58 address alphabet. Check the address before continuing.",
  ownAddress: "Choose an address other than this portfolio's own.",
  invalidAddress: "Enter a valid Solana address.",
  amountLabel: (symbol: string) => `Amount in ${symbol}`,
  amountLine: (amount: string, available: string) => `${amount} · Available ${available}`,
  moreThanHeld: "More than this portfolio holds",
  invalidAmount: "Enter an amount, like 12.50.",
  review: "Review",
  explainer: (network: string, symbol: string) =>
    `Real transfer on ${network}, straight from this portfolio's own ${symbol} balance to the recipient. It cannot be reversed. Before sending, the address is checked to be a wallet and not a token, a token account or a program; who owns it is not verified. This portfolio pays its own network cost, including opening the recipient's account for this asset when they have none, because paying from the funding wallet would publicly link the two. The cost is a few cents, taken from its USDC as part of the send, and the review shows the amount first.`,

  reviewTitle: "Review send",
  recipientAddress: "Recipient address",
  recipientAria: (address: string) => `Recipient address ${address}`,
  asset: "Asset",
  amount: "Amount",
  usdValue: "USD value",
  network: "Network",
  networkCost: "Network cost",
  solFeeFromAmount: (fee: string) => `${fee} SOL, taken out of the amount`,
  solFeeOnTop: (fee: string) => `${fee} SOL, on top of the amount`,
  cashPaysCost: (kept: string, sent: string, typed: string) =>
    `${kept} from this portfolio pays the network cost, so ${sent} is sent, not ${typed}.`,

  linksTitle: "This links the two addresses publicly.",
  linksBody: (other: string) =>
    `Anyone can then see that this portfolio and your ${other} belong to the same person.`,
  fundingWallet: "funding wallet",
  otherPortfolio: (label: string) => `other portfolio (${label})`,
  acceptLink: "I understand this links them",
  firstTime:
    "First time sending to this address. Check every character against the source, not just the start and end.",
  lookalikeTitle: "This address looks like one you have used before but is different.",
  lookalikeLabel: (label: string) => `${label}: `,
  previousRecipient: "Previous recipient: ",
  checkEveryCharacter: "Check every character against the source, not just the start and end.",
  checkedAddress: "I have checked the full address",
  lastFour: (large: boolean) =>
    `Type the last 4 characters of the recipient address to confirm this ${large ? "large send" : "send"}`,
  lastFourLabel: "Last 4 characters of recipient address",
  irreversible: "This cannot be undone.",
  sending: "Sending...",
  send: "Send",

  /** Why the recipient cannot receive, read from the network before review. */
  unsendable: {
    program:
      "This is a program's address, not a wallet. Anything sent to it could not be moved again.",
    mint: "This is a token's own mint address, not a wallet. Anything sent to it could not be moved again.",
    tokenAccount:
      "This is a token account, not a wallet. Send to the wallet address that owns it instead.",
    offCurve:
      "This address has no private key behind it: it is a token account or another address a program controls, not a wallet. Ask for the recipient's wallet address.",
    programOwned:
      "This address is an account that a program controls, such as a stake account, not an ordinary wallet. Ask for the recipient's wallet address.",
  } satisfies Record<Unsendable, string>,
  recipientUnreadable:
    "The recipient could not be checked right now. Nothing was sent. Try again in a moment.",
  recipientChanged:
    "The recipient's account changed while you were reviewing, so the network cost is different. Nothing was sent.",
  notAPortfolio: "This link does not point to a portfolio.",
  emptyDetail: "There is nothing in it to send.",
  reasons: {
    acceptLink: "Confirm that you understand the link this creates.",
    checkAddress: "Confirm that you have checked the full address.",
    lastFour: "Type the last 4 characters of the address.",
  },
  sendingAmount: (amount: string) => `Sending ${amount}`,
  steps: ["Checking the recipient", "Sending on chain", "Confirming"],
  sent: (amount: string) => `Sent ${amount}`,
  sentBody: (portfolio: string) => `To the address you entered. It has left ${portfolio}.`,
  unknownTitle: "Sent, but not confirmed",
  unknownBody: (portfolio: string) =>
    `This was sent but could not be confirmed. It may still go through. Check ${portfolio}'s balance before trying again.`,
} as const;

/**
 * What the phone says differently when sending. The phone has no network
 * row and never names the network's own currency; it can also scan a code.
 */
export const mobileSendCopy = {
  title: (portfolio: string) => `Send from ${portfolio}`,
  recipientLabel: "Recipient address",
  recipientPlaceholder: "Solana address",
  paste: "Paste",
  scan: "Scan a QR code",
  available: "Available",
  explainer:
    "A real transfer on Solana, straight from this portfolio to the recipient. It cannot be reversed. The address is checked to be a wallet and not a token, a token account or a program; who owns it is not verified. This portfolio pays its own network cost in USDC, a few cents taken from its balance, and the review shows the amount first.",

  scanTitle: "Scan a QR code",
  scanHint: "Point the camera at the recipient's address code.",
  notAnAddress: "That code is not a Solana address.",
  addressOnly: "Only the address was taken from this code. Enter the amount yourself.",

  /** The camera permission screen that stands in place of the scanner. */
  camera: {
    purpose: "NoirWire uses the camera only to scan a QR code you point it at.",
    allow: "Allow camera",
    off: "Camera access is off.",
    offDetail: "Allow the camera in system settings to scan a code, or paste the address instead.",
    openSettings: "Open settings",
  },

  pasteWarning:
    "Pasted text contains characters that cannot be part of an address. Check the address before continuing.",
  invalidAmount: "Enter an amount, like 12.50.",
  moreThanHeld: "More than this portfolio holds.",

  reviewTitle: "Review",
  recipientAria: (groups: string) => `Recipient address, ${groups}`,
  cash: "Cash",
  tracker: "Tracker",
  value: "Value",
} as const;
