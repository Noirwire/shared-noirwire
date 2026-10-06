import { plural } from "./plural.js";
import { stillWorkingOnAction } from "./waiting.js";

/**
 * How long a private move takes, said the same wherever it is said. The
 * settlement service is asked to deliver within 2 to 15 seconds, and the app
 * watches for the arrival for a minute before it reports the move as still
 * settling; one that is still queued then arrives later on its own.
 */
export const privateMoveTiming = "It usually arrives within a minute and can take a few.";

/** Said on both platforms under the amount of a private move. */
const privateMoveFooter =
  "A private move breaks the public link between your main wallet and this portfolio. It does not hide the amount, and the settlement service sees both addresses. It does not see your IP address: the request goes through NoirWire's own server first, which keeps only a basic record that a request was made, not your address or what's in it. Privacy from the public record, not from the service. Private moves are powered by MagicBlock.";

/**
 * The main wallet, and moving money from it into a portfolio, privately or
 * in public. It is the person's own public wallet: its address is the one
 * they share, money arrives there, and portfolios stay separate from it.
 */
export const fundingCopy = {
  wallet: {
    title: "Main wallet",
    balance: "Balance",
    empty: "Your main wallet is empty. Add money to get started.",
    /** Why Move to portfolio cannot be pressed while there is no USDC to move. */
    addMoneyFirst: "Add money to your main wallet first.",
  },

  titlePrivate: "Move to portfolio",
  titlePublic: (asset: string) => `Move ${asset} publicly`,

  stages: {
    enqueue: {
      title: "Enqueue the private move",
      detail: "Signed by your main wallet and handed to the settlement queue.",
    },
    settle: {
      title: "Settle out of the queue",
      detail: (minSeconds: number, maxSeconds: number) =>
        `Delivered after ${minSeconds}-${maxSeconds}s, split across several entries.`,
    },
    arrive: {
      title: "Arrive at this portfolio",
      detail: "Confirmed by reading this portfolio's real balance.",
    },
  },

  /** `available` is null until the main wallet has been read: then no amount is named. */
  leadPrivate: (asset: string, available: string | null) =>
    `Move ${asset} into this portfolio without publishing a transfer between your main wallet and it.${available === null ? "" : ` Available ${available}.`}`,
  leadPublic: (asset: string, available: string | null) =>
    `Move ${asset} into this portfolio.${available === null ? "" : ` Available ${available}.`}`,
  noPrivateMove: (asset: string) =>
    `${asset} cannot be moved privately. This is a direct, public transfer from your main wallet to this portfolio, and it links the two addresses publicly. Keep it small - enough to cover fees is usually plenty.`,
  otherAmount: (asset: string) => `Other amount in ${asset}`,
  invalidAmount: "Enter an amount greater than zero and within your available balance.",
  belowMinimum: (minimum: string) => `A private move has to be at least ${minimum}.`,
  overBalance: (leaving: string) =>
    `With fees this takes ${leaving} from your main wallet, more than it holds. Enter a smaller amount.`,
  emptyBefore: (asset: string) => `Your main wallet holds no ${asset}. `,
  addressLink: "Show your main wallet address",
  emptyAfter: " to add money first.",
  privateCosts: (feePercent: number, relayFee: string, asset: string, minimum: string) =>
    `Costs a ${feePercent}% privacy fee plus a flat ${relayFee} relay fee, both charged in ${asset} by the settlement service on top of the amount. The relay fee pays the network costs, so your main wallet needs no SOL. The smallest private move is ${minimum}. ${privateMoveTiming}`,

  reviewLead: (portfolio: string) =>
    `Review what leaves your main wallet before moving money into ${portfolio}.`,
  terms: {
    arrives: (portfolio: string) => `Arrives in ${portfolio}`,
    privacyFee: (percent: number) => `Privacy fee (${percent}%)`,
    relayFee: "Relay fee",
    total: "Total leaving your main wallet",
  },
  noSolNeeded:
    "No SOL is needed. If the transfer would take more than this total, it is not signed.",
  /** The button that confirms a private move. */
  confirmPrivate: "Move privately",

  moving: (amount: string, portfolio: string) => `Moving ${amount} into ${portfolio}`,

  /** The service has the transfer, and its parts have not all landed yet. */
  onItsWayTitle: "On its way",
  onItsWay: (amount: string, portfolio: string) =>
    `${amount} is on its way to ${portfolio}. It arrives in parts, usually within a minute.`,

  arrivedTitle: "Funds arrived",
  arrived: (amount: string, portfolio: string) =>
    `${amount} is now in ${portfolio}, read back from its real balance.`,
  /** The money moved, and the portfolio's balance could not be read back yet. */
  movedUnread: (amount: string, portfolio: string) =>
    `${amount} was moved into ${portfolio}. Its balance will update shortly.`,
  feesCharged: (fees: string) => ` ${fees} in fees was charged on top.`,
  observerLink: "See what an outside observer can and cannot connect.",

  unknownTitle: "Sent, but not confirmed",
  unknown: (amount: string, asset: string, portfolio: string) =>
    `The transfer of ${amount} was sent, but we could not confirm that it arrived. It may still arrive. Do not send it again yet: check your main wallet’s ${asset} balance first. If it has gone down, the money is on its way to ${portfolio} and needs nothing more from you.`,

  settlingTitle: "Still settling",
  settling:
    "The transfer was accepted but has not landed yet. Queued transfers settle on their own schedule, so this is normal rather than a failure. This portfolio’s balance will show it once it arrives.",

  footerPrivate: privateMoveFooter,
  footerPublic: "This is an ordinary, fully public transfer.",
} as const;

/**
 * What the phone says when moving money in. The phone has no public route
 * and never names the network's own currency, so its costs and review say
 * nothing about SOL; the web keeps its wording for its public SOL route.
 */
export const mobileFundingCopy = {
  chooseTitle: "Choose a portfolio",
  continueWith: (portfolio: string) => `Continue with ${portfolio}`,

  lead: (portfolio: string) =>
    `Move USDC into ${portfolio} without publishing a transfer between your main wallet and it.`,
  available: "Available in main wallet",
  amountLabel: "Amount in USDC",
  terms: {
    privacyFee: (percent: number) => `Privacy fee, ${percent}% of the amount`,
    relayFee: "Relay fee, flat",
    leaves: "Leaves your main wallet",
  },
  costs: (minimum: string) =>
    `Both fees are charged in USDC by the settlement service, on top of the amount. The relay fee pays the network cost. The smallest private move is ${minimum}. ${privateMoveTiming}`,
  review: "Review",
  footer: privateMoveFooter,

  empty: "Your main wallet is empty.",
  emptyDetail: "Add money to your main wallet first.",
  addMoney: "Add money",

  reviewTitle: "Review",
  notSignedAbove: "If the transfer would take more than this total, it is not signed.",
  totalSpoken: (label: string, value: string) => `${label}, ${value.replace(".", " point ")}`,

  stages: [
    {
      title: "Private move sent",
      caption: "Signed by your main wallet and handed to the settlement queue.",
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

  settingsRow: "Main wallet",
  settingsSection: "Wallet",
} as const;
