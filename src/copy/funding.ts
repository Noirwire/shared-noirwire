import { plural } from "./plural.js";
import { stillWorkingOnAction } from "./waiting.js";

/** Said on both platforms under the private transfer amount field. */
const privateTransferFooter =
  "A private transfer breaks the onchain link between your funding wallet and this portfolio. It does not hide the amount, and the settlement service sees both addresses. It does not see your IP address: the request goes through NoirWire's own server first, which keeps only a basic record that a request was made, not your address or what's in it. Privacy from the chain, not from the service.";

/** Moving money from the funding wallet into a portfolio, privately or in public. */
export const fundingCopy = {
  titlePrivate: "Fund portfolio privately",
  titlePublic: (asset: string) => `Add ${asset} publicly`,

  stages: {
    enqueue: {
      title: "Enqueue the private transfer",
      detail: "Signed by your funding wallet and handed to the settlement queue.",
    },
    settle: {
      title: "Settle out of the queue",
      detail: (minSeconds: number, maxSeconds: number) =>
        `Delivered after ${minSeconds}-${maxSeconds}s, split across several entries.`,
    },
    arrive: {
      title: "Arrive at this portfolio",
      detail: "Confirmed by reading this portfolio's real onchain balance.",
    },
  },

  leadPrivate: (asset: string, available: string) =>
    `Move ${asset} into this portfolio without publishing a transfer between your funding wallet and it. Available ${available}.`,
  leadPublic: (asset: string, available: string) =>
    `Move ${asset} into this portfolio. Available ${available}.`,
  noPrivateRoute: (asset: string) =>
    `${asset} has no private route. This is a direct, public transfer from your funding wallet to this portfolio, and it links the two addresses onchain. Keep it small - enough to cover fees is usually plenty.`,
  otherAmount: (asset: string) => `Other amount in ${asset}`,
  invalidAmount: "Enter an amount greater than zero and within your available balance.",
  belowMinimum: (minimum: string) => `A private transfer has to be at least ${minimum}.`,
  overBalance: (leaving: string) =>
    `With fees this takes ${leaving} from your funding wallet, more than it holds. Enter a smaller amount.`,
  emptyBefore: (asset: string) => `Your ${asset} funding balance is empty. `,
  depositLink: "Get your deposit address",
  emptyAfter: " to add money first.",
  privateCosts: (feePercent: number, relayFee: string, asset: string, minimum: string) =>
    `Costs a ${feePercent}% privacy fee plus a flat ${relayFee} relay fee, both charged in ${asset} by the settlement service on top of the amount. The relay fee pays the network costs, so your funding wallet needs no SOL. The smallest transfer is ${minimum}, and it usually arrives within seconds.`,

  reviewLead: (portfolio: string) =>
    `Review what leaves your funding wallet before moving money into ${portfolio}.`,
  terms: {
    arrives: (portfolio: string) => `Arrives in ${portfolio}`,
    privacyFee: (percent: number) => `Privacy fee (${percent}%)`,
    relayFee: "Relay fee",
    total: "Total leaving your funding wallet",
  },
  noSolNeeded:
    "No SOL is needed. If the transfer would take more than this total, it is not signed.",

  moving: (amount: string, portfolio: string) => `Moving ${amount} into ${portfolio}`,

  arrivedTitle: "Funds arrived",
  arrived: (amount: string, portfolio: string) =>
    `${amount} is now in ${portfolio}, read back from its real onchain balance.`,
  /** The money moved, and the portfolio's balance could not be read back yet. */
  movedUnread: (amount: string, portfolio: string) =>
    `${amount} was moved into ${portfolio}. Its balance will update shortly.`,
  feesCharged: (fees: string) => ` ${fees} in fees was charged on top.`,
  observerLink: "See what an outside observer can and cannot connect.",

  unknownTitle: "Sent, but not confirmed",
  unknown: (amount: string, asset: string, portfolio: string) =>
    `The transfer of ${amount} was sent, but we could not confirm that it arrived. It may still arrive. Do not send it again yet: check your funding wallet’s ${asset} balance first. If it has gone down, the money is on its way to ${portfolio} and needs nothing more from you.`,

  settlingTitle: "Still settling",
  settling:
    "The transfer was accepted but has not landed yet. Queued transfers settle on their own schedule, so this is normal rather than a failure. This portfolio’s balance will show it once it arrives.",

  footerPrivate: privateTransferFooter,
  footerPublic: "This is an ordinary, fully public onchain transfer.",
} as const;

/**
 * What the phone says when moving money in. The phone has no public route
 * and never names the network's own currency, so its costs and review say
 * nothing about SOL; the web keeps its wording for its public SOL route.
 */
export const mobileFundingCopy = {
  title: "Add money privately",
  chooseTitle: "Add money to",
  continueWith: (portfolio: string) => `Continue with ${portfolio}`,
  cash: (amount: string) => `${amount} cash`,

  lead: (portfolio: string) =>
    `Move USDC into ${portfolio} without publishing a transfer between your funding wallet and it.`,
  available: "Available in funding wallet",
  amountLabel: "Amount in USDC",
  terms: {
    privacyFee: (percent: number) => `Privacy fee, ${percent}% of the amount`,
    relayFee: "Relay fee, flat",
    leaves: "Leaves your funding wallet",
  },
  costs: (minimum: string) =>
    `Both fees are charged in USDC by the settlement service, on top of the amount. The relay fee pays the network cost. The smallest transfer is ${minimum}, and it usually arrives within seconds.`,
  review: "Review",
  footer: privateTransferFooter,

  empty: "Your funding wallet is empty.",
  emptyDetail: "Send USDC on Solana to your funding address first.",
  showAddress: "Show my funding address",

  reviewTitle: "Review",
  notSignedAbove: "If the transfer would take more than this total, it is not signed.",
  totalSpoken: (label: string, value: string) => `${label}, ${value.replace(".", " point ")}`,

  stages: [
    {
      title: "Sent to the private route",
      caption: "Signed by your funding wallet and handed to the settlement queue.",
    },
    {
      title: "Waiting in the queue",
      caption: (min: number, max: number) =>
        `Delivered after ${min} to ${plural(max, "second")}, split across several entries.`,
    },
    {
      title: (portfolio: string) => `Arrived in ${portfolio}`,
      caption: "Confirmed by reading this portfolio's real balance.",
    },
  ],
  stillWorking: stillWorkingOnAction,

  arrived: (amount: string, portfolio: string) =>
    `${amount} is now in ${portfolio}, read back from its real balance.`,
  seePublicView: "See public view",

  settingsRow: "Funding wallet",
  settingsSection: "Wallet",
  page: {
    title: "Funding wallet",
    waiting: "Waiting to be moved",
    lead: "Money sent here must be moved into a portfolio before you can invest.",
    empty: "Nothing is waiting. Send USDC on Solana to your funding address to add money.",
    move: "Move to a portfolio",
    showAddress: "Show my funding address",
    readFailed:
      "We couldn't update your balance. What you see may be out of date. Pull down to try again.",
    balanceLabel: (amount: string) => `${amount} waiting to be moved`,
  },
} as const;
