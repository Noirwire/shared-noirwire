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
  invalidAmount: "Enter a finite amount greater than zero.",
  review: "Review",
  explainer: (network: string, symbol: string) =>
    `Real transfer on ${network}, straight from this portfolio's own ${symbol} balance to the recipient. It cannot be reversed. Before sending, the address is checked to be a wallet and not a token, a token account or a program; who owns it is not verified. This portfolio pays its own network cost, including opening the recipient's account for this asset when they have none, because paying from the funding wallet would publicly link the two. The cost is a few cents, taken from its cash as part of the send, and the review shows the amount first.`,

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
    `${kept} of this portfolio's cash pays the network cost, so ${sent} is sent, not ${typed}.`,

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
  sending: "Sending onchain...",
  send: "Send",
} as const;
