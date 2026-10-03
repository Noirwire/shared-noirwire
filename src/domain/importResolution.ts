import type { DerivationScheme } from "./wallet.js";

export type DiscoveredPortfolio = {
  index: number;
  address: string;
  solBalance: number;
};

/** What one derivation scheme's addresses show on chain for a phrase. */
export type SchemeActivity = {
  /** The funding wallet's address under this scheme. */
  address: string;
  balanceSol: number;
  /** The portfolios found past the funding index. */
  portfolios: DiscoveredPortfolio[];
  /** Any sign of use at all: SOL, a token account, or a portfolio. */
  active: boolean;
};

export type ImportResolution = {
  /**
   * The scheme the chain points to, when exactly one shows activity. Null
   * when both do or neither does: the chain cannot say which set of
   * addresses the user means, so the user has to.
   */
  scheme: DerivationScheme | null;
  app: SchemeActivity;
  walletDefault: SchemeActivity;
};
