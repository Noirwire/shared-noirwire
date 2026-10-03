import type { DerivationScheme } from "./wallet.js";

/**
 * How many unused addresses in a row end the scan for a phrase's portfolios
 * on import. Creating a portfolio writes nothing on chain, so one that was
 * never used cannot be told from one that was never made.
 */
export const DISCOVERY_GAP = 20;

/** The gap of the scan a person asks for when a portfolio is missing after an import. */
export const EXTENDED_DISCOVERY_GAP = 100;

/**
 * The most never-used portfolios a wallet may have in a row past its last
 * used one. Kept well under `DISCOVERY_GAP`, so whatever is created and used
 * next is always within reach of an import's scan.
 */
export const MAX_UNUSED_PORTFOLIOS_IN_A_ROW = 10;

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
  /** The last derivation index the scan judged, which is where a further scan carries on from. */
  scannedThrough?: number;
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
