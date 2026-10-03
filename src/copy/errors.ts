import { mobilePortfolioCopy, portfolioCopy } from "./portfolio.js";

/** What a money action answers with when it did not go through. */
export const errorsCopy = {
  activePortfolioAmount: "Enter an amount for an active portfolio.",
  amountAboveZero: "Enter an amount greater than zero.",
  unknownAsset: (symbol: string) => `Unknown asset: ${symbol}.`,
  portfolioGone: "That portfolio no longer exists.",
  portfolioInactive: "This portfolio is not active.",
  portfolioNotSaved: portfolioCopy.create.notSaved,

  /** Why a step that reached the chain, the relayer or the wallet's record stopped, by code. */
  chain: {
    walletLocked: "This wallet is locked. Unlock it with your password to sign.",
    relayerUnavailable:
      "The network cost could not be covered in USDC right now. Nothing was sent.",
    networkCostRose: "The network cost rose before this could be sent. Nothing was sent.",
    relayedNotLanded: "This was sent and did not go through. Nothing was moved.",
    outcomeUnknown:
      "This was sent but could not be confirmed. It may still land; check the portfolio's balance before retrying.",
    noQuote: "Jupiter has no price for this order right now.",
    wrongNetwork:
      "The network connection serves a different chain than this app is built for. Nothing was signed or sent.",
  },

  reviewNewCost: (reason: string) => `${reason} Review the new network cost.`,
  reviewCostAgain: (reason: string) => `${reason} Review the network cost again.`,

  funding: {
    failed: "Funding failed.",
    notPrivate: (symbol: string) => `${symbol} cannot be funded privately. Use a supported token.`,
    privateNotStarted: "The private transfer could not be started.",
  },

  send: {
    notTransferable: (symbol: string) => `${symbol} cannot be transferred.`,
    notCompleted: "Transfer could not be completed. Check the balance and recipient.",
    moreThanOnchain: "More than this portfolio holds onchain.",
    failed: "Transfer failed.",
  },

  trade: {
    mainnetOnly: "Live trading is only available on mainnet.",
    notTradable: (symbol: string) => `${symbol} is not a tradable asset.`,
    noPrice: "Could not get a price for this trade.",
    priceMoved: "The price moved before this order could be placed. Nothing was traded.",
    priceMovedWhileOpening:
      "The price moved while the account was being opened, so the order was not placed. Review the new price. The network cost is already paid.",
    notPlaced: "The order was not placed.",
    failed: "The trade did not go through.",
    holdingsNotOpened: "The accounts for these trackers could not be opened.",
  },

  earn: {
    mainnetOnly: "Earning is only available on Solana mainnet.",
    failed: "The transaction did not complete.",
  },
} as const;

/** What the phone says differently when an action does not go through. Everything else is `errorsCopy`. */
export const mobileErrorsCopy = {
  portfolioNotSaved: mobilePortfolioCopy.create.notSaved,
} as const;
