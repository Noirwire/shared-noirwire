import type { DiscoveredPortfolio } from "../infrastructure/solana/import.js";
import { onboardingCopy } from "../copy/onboarding.js";
import {
  deriveKeypair,
  generateWalletMnemonic,
  FUNDING_DERIVATION_INDEX,
} from "../infrastructure/solana/keys.js";
import { SUPPORTED_TOKENS } from "../infrastructure/solana/tokenRegistry.js";
import { randomId } from "../application/walletRecord.js";
import { price } from "./market.js";
import type { Portfolio, DerivationScheme, Wallet } from "../domain/wallet.js";

/** Every registered token starts at a real, freshly-read-as-zero balance, keyed by symbol. */
function zeroTokenBalances(): Record<string, number> {
  return Object.fromEntries(SUPPORTED_TOKENS.map((token) => [token.symbol, 0]));
}

/**
 * Applies a discovered portfolio's real on-chain SOL balance to its SOL
 * holding, with `cost` tracking the same dollar value as `amount` - this
 * SOL was read from chain, not bought, so it must never show a fabricated
 * gain/loss (the same rule an app applies when it sets a real holding).
 */
function applyDiscoveredSolBalance(portfolio: Portfolio, solBalance: number): Portfolio {
  return {
    ...portfolio,
    holdings: portfolio.holdings.map((holding) =>
      holding.symbol === "SOL"
        ? { ...holding, amount: solBalance, cost: solBalance * price("SOL") }
        : holding,
    ),
  };
}

/**
 * Assembles a wallet from a mnemonic that is already known to be valid,
 * under the given derivation scheme. Nothing is created on chain: a
 * portfolio is a keypair, and needs nothing registered before it can
 * receive.
 *
 * `fundingBalanceSol` seeds the funding wallet's displayed balance with a
 * value already read from chain (import resolution does this), so the
 * screen right after import does not flash a stale zero; it defaults to 0
 * for a freshly generated phrase, which has never held anything.
 *
 * `discoveredPortfolios` carries portfolios an on-chain scan found on
 * import (see `discoverExistingPortfolios`), in ascending index order. When
 * it's empty (brand new wallet, or an import that scanned and found
 * nothing) this falls back to exactly one fresh portfolio at the first
 * index, matching a wallet that has never held one before.
 */
function buildWallet(
  mnemonic: string,
  scheme: DerivationScheme,
  fundingBalanceSol = 0,
  discoveredPortfolios: DiscoveredPortfolio[] = [],
): WalletDraft {
  const funding = deriveKeypair(mnemonic, FUNDING_DERIVATION_INDEX, scheme);
  const portfolios: Portfolio[] =
    discoveredPortfolios.length > 0
      ? discoveredPortfolios.map((discovered, position) =>
          applyDiscoveredSolBalance(
            createPortfolio(
              onboardingCopy.portfolioLabel(position + 1),
              discovered.address,
              discovered.index,
            ),
            discovered.solBalance,
          ),
        )
      : [
          createPortfolio(
            onboardingCopy.portfolioLabel(1),
            deriveKeypair(mnemonic, FUNDING_DERIVATION_INDEX + 1, scheme).publicKey.toBase58(),
            FUNDING_DERIVATION_INDEX + 1,
          ),
        ];
  return {
    phrase: mnemonic.split(" "),
    wallet: {
      createdAt: Date.now(),
      derivationScheme: scheme,
      funding: {
        address: funding.publicKey.toBase58(),
        sol: fundingBalanceSol,
        tokens: zeroTokenBalances(),
      },
      portfolios,
      activity: [],
      watchlist: ["NVDAx", "SPYx"],
    },
  };
}

/**
 * A wallet that has been assembled but not yet stored, because no password
 * exists for it until the user picks one. `storeNewWallet` in the store is
 * the only way to turn a draft into something kept, and it encrypts the
 * phrase and the wallet together.
 */
export type WalletDraft = {
  phrase: string[];
  wallet: Wallet;
};

/** A brand new wallet, on this app's own derivation scheme. */
export function createWallet(): WalletDraft {
  return buildWallet(generateWalletMnemonic(), "app");
}

/**
 * A wallet imported from an existing recovery phrase. `words` must already
 * be a validated 12- or 24-word BIP-39 phrase (see `parseRecoveryPhrase`),
 * `scheme` + `fundingBalanceSol` should come from `resolveImportedWallet`,
 * and `discoveredPortfolios` from `discoverExistingPortfolios`.
 */
export function createWalletFromMnemonic(
  words: string[],
  scheme: DerivationScheme,
  fundingBalanceSol = 0,
  discoveredPortfolios: DiscoveredPortfolio[] = [],
): WalletDraft {
  return buildWallet(words.join(" "), scheme, fundingBalanceSol, discoveredPortfolios);
}

export function createPortfolio(
  label: string,
  address: string,
  derivationIndex: number,
): Portfolio {
  return {
    id: randomId("acc"),
    label,
    address,
    derivationIndex,
    createdAt: Date.now(),
    archivedAt: null,
    holdings: [
      { symbol: "SOL", amount: 0, cost: 0 },
      ...SUPPORTED_TOKENS.map((token) => ({ symbol: token.symbol, amount: 0, cost: 0 })),
    ],
  };
}
