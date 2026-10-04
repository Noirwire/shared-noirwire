/** Lending a portfolio's USDC through Earn. */
export const earnCopy = {
  title: "Earn",
  eyebrow: "USDC lending",
  lead: (venue: string) => `Lend USDC from a portfolio through ${venue}. The rate is variable.`,
  summaryLabel: "Earn summary",
  currentApy: "Current variable APY",
  supplyApy: "Supply APY",
  rewardsApy: "Rewards APY",
  totalInEarn: "Your total in Earn",
  percent: (rate: string) => `${rate}%`,
  couldEarn: (rate: string) => `Your USDC could earn ${rate}% a year at today's rate.`,
  noRate: "A current lending rate is unavailable.",
  rateBreakdown: (supply: string, rewards: string) =>
    `Supply ${supply}% · rewards ${rewards}%. The rate changes.`,

  portfolios: "Your portfolios",
  portfoliosLead: "Move USDC from each portfolio into Earn and back.",
  columns: {
    portfolio: "Portfolio",
    cash: "Cash available",
    inEarn: "In Earn",
    earned: "Earned",
    actions: "Actions",
  },
  inEarn: "in Earn",
  earnedSinceDeposit: (amount: string) => `${amount} earned since deposit`,
  restoreToMove: "Restore this portfolio to move funds",
  createPortfolio: "Create a portfolio",
  risksTitle: "Lending risks",
  risks:
    "Lending has smart-contract risk. USDC in Earn is not insured and is not available to trade. Withdrawals can be delayed if the pool is heavily borrowed. APY changes over time.",
  risksShort:
    "Lending has smart-contract risk. USDC in Earn is not insured and is not available to trade. Withdrawals can be delayed if the pool is heavily borrowed.",

  deposit: "Deposit",
  withdraw: "Withdraw",
  sheetTitle: (action: "deposit" | "withdraw", portfolio: string) =>
    `${action === "deposit" ? "Deposit" : "Withdraw"} · ${portfolio}`,
  sheetLead: (action: "deposit" | "withdraw") =>
    action === "deposit" ? "Lend USDC from this portfolio." : "Return USDC to this portfolio.",
  amountLabel: "Amount in USDC",
  yearEstimate: (dollars: string, rate: string) =>
    `About ${dollars} in a year at today's ${rate}% variable rate. This is an estimate, not a promise.`,
  mainnetOnly: "Earn is available on Solana mainnet only.",
  notHere: (network: string) =>
    `Earn is available on Solana mainnet only. Nothing can be lent or withdrawn on ${network}.`,
  unread: "What is in Earn can't be shown right now.",
  beforeDepositTitle: "Before you deposit",
  beforeDeposit: (venue: string) =>
    `USDC is lent through ${venue}. The rate changes. This is not a bank deposit and is not insured. Smart-contract failures can cause loss. Withdrawals may be delayed when the pool is heavily borrowed.`,
  submitting: "Submitting...",
  confirm: (action: "deposit" | "withdraw") =>
    action === "deposit" ? "Confirm deposit" : "Confirm withdrawal",
  earning: (amount: string, venue: string) => `${amount} earning through ${venue}`,

  rateAnnouncement: (rate: string) => `Current variable rate, ${rate} percent a year`,
  noMoney: "No portfolio has USDC to deposit. Move money into a portfolio first.",
  riskLine: "Lending carries risk and the rate changes.",
  readRisks: "Read the risks",
  noPortfolio: "Create a portfolio to use Earn.",
  noPortfolioDetail: "Earn lends a portfolio's USDC.",
  continueWith: (portfolio: string) => `Continue with ${portfolio}`,
  ready: (amount: string) => `${amount} ready to invest`,
  lent: (amount: string) => `${amount} in Earn`,
  leadFor: {
    deposit: (portfolio: string) => `Lend USDC from ${portfolio}.`,
    withdraw: (portfolio: string) => `Return USDC to ${portfolio}.`,
  },
  available: "Available",
  review: "Review",
  moreThanAvailable: "More than is available.",
  smallerThanCost: "This withdrawal is smaller than its own network cost.",

  reviewTitle: "Review",
  terms: {
    leaves: (portfolio: string) => `Leaves ${portfolio}`,
    intoEarn: "Goes into Earn",
    totalLeaving: (portfolio: string) => `Total leaving ${portfolio}`,
    leavesEarn: "Leaves Earn",
    arrives: (portfolio: string) => `Arrives in ${portfolio}`,
  },
  openingReason: "The network cost includes opening this holding, a one-time cost.",
  fromProceeds:
    "The network cost is paid out of the USDC this returns, so no USDC is needed first.",
  depositRisk: (venue: string) =>
    `USDC is lent through ${venue}. It is not a bank deposit, and withdrawals can be delayed.`,
  confirmAmount: {
    deposit: (amount: string) => `Deposit ${amount}`,
    withdraw: (amount: string) => `Withdraw ${amount}`,
  },

  progress: {
    deposit: (amount: string) => `Depositing ${amount}`,
    withdraw: (amount: string) => `Withdrawing ${amount}`,
  },
  steps: ["Sending on chain", "Confirming", "Reading the new balance"],

  landed: {
    deposit: (amount: string) => `Deposited ${amount}`,
    withdraw: (amount: string) => `Withdrew ${amount}`,
  },
  landedBody: {
    deposit: (portfolio: string) => `From ${portfolio}, now in Earn.`,
    withdraw: (portfolio: string) => `Back in ${portfolio}, ready to invest.`,
  },
  unknownTitle: "Sent, but not confirmed",
  unknownBody: (portfolio: string) =>
    `This was sent but could not be confirmed. It may still go through. Check ${portfolio}'s balance before trying again.`,
} as const;

/** What the phone says differently on Earn. Everything else is `earnCopy`. */
export const mobileEarnCopy = {
  rateLabel: "Current variable rate",
  restore: "Restore this portfolio to move funds.",
} as const;
