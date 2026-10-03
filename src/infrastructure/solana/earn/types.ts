export type EarnRate = {
  /** Percent a year, all in: 3.64 means 3.64%. Variable, never a promise. */
  apy: number;
  supplyApy: number;
  rewardsApy: number;
};

export type EarnPosition = {
  /** What the position could be withdrawn for right now, in USDC. */
  deposited: number;
  /** Interest earned since the first deposit, when the venue reports it. */
  earnedSinceDeposit: number | null;
  /** Whether the receipt-token account already exists, which decides how much SOL a deposit needs. */
  hasReceiptAccount: boolean;
  /** The portfolio's own SOL, read in the same request, which is what pays for a deposit or withdrawal. */
  lamports: number;
};
