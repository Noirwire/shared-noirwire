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
  couldEarn: (rate: string) => `Your cash could earn ${rate}% a year at today's rate.`,
  noRate: "A current lending rate is unavailable.",
  rateBreakdown: (supply: string, rewards: string) =>
    `Supply ${supply}% · rewards ${rewards}%. The rate changes.`,

  portfolios: "Your portfolios",
  portfoliosLead: "Move cash from each portfolio into Earn and back.",
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
    "Lending has smart-contract risk. USDC in Earn is not insured and is not cash available to trade. Withdrawals can be delayed if the pool is heavily borrowed. APY changes over time.",
  risksShort:
    "Lending has smart-contract risk. USDC in Earn is not insured and is not cash available to trade. Withdrawals can be delayed if the pool is heavily borrowed.",

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
  beforeDepositTitle: "Before you deposit",
  beforeDeposit: (venue: string) =>
    `USDC is lent through ${venue}. The rate changes. This is not a bank deposit and is not insured. Smart-contract failures can cause loss. Withdrawals may be delayed when the pool is heavily borrowed.`,
  submitting: "Submitting...",
  confirm: (action: "deposit" | "withdraw") =>
    action === "deposit" ? "Confirm deposit" : "Confirm withdrawal",
  earning: (amount: string, venue: string) => `${amount} earning through ${venue}`,
} as const;
