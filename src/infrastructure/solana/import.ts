import "./buffer-polyfill.js";

import type { PublicKey } from "@solana/web3.js";
import type {
  DiscoveredPortfolio,
  ImportResolution,
  SchemeActivity,
} from "../../domain/importResolution.js";
import type { DerivationScheme } from "../../domain/wallet.js";
import { connection } from "./client.js";
import { deriveKeypair, FUNDING_DERIVATION_INDEX } from "./keys.js";
import { lamportsToSol } from "./sol.js";
import { ataFor } from "./tokens.js";
import { ALL_STOCKS, SUPPORTED_TOKENS } from "./tokenRegistry.js";

export type { DiscoveredPortfolio, ImportResolution, SchemeActivity };

/** getMultipleAccounts accepts at most this many addresses in one request. */
const MAX_ADDRESSES_PER_REQUEST = 100;

/** Free and public RPC tiers refuse bursts, and an import that fails on a rate limit reads as a broken phrase. */
const MAX_REQUESTS_IN_FLIGHT = 3;
const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_BACKOFF_MS = 1_000;

let inFlight = 0;
const waiting: (() => void)[] = [];

/** Runs `request` once a slot is free. A finished request hands its slot straight to the next one waiting. */
async function inTurn<T>(request: () => Promise<T>): Promise<T> {
  if (inFlight < MAX_REQUESTS_IN_FLIGHT) inFlight++;
  else await new Promise<void>((resolve) => waiting.push(resolve));
  try {
    return await request();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else inFlight--;
  }
}

function isRateLimit(error: unknown): boolean {
  return error instanceof Error && /429|rate limit|too many requests/i.test(error.message);
}

async function accountInfoBatch(addresses: PublicKey[]) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await inTurn(() => connection.getMultipleAccountsInfo(addresses));
    } catch (error) {
      if (!isRateLimit(error) || attempt >= RATE_LIMIT_RETRIES) throw error;
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_BACKOFF_MS * 2 ** attempt));
    }
  }
}

/** Whether each address exists and what it holds, in as few requests as the batch limit allows. */
async function accountInfos(addresses: PublicKey[]) {
  const batches = [];
  for (let start = 0; start < addresses.length; start += MAX_ADDRESSES_PER_REQUEST) {
    batches.push(accountInfoBatch(addresses.slice(start, start + MAX_ADDRESSES_PER_REQUEST)));
  }
  return (await Promise.all(batches)).flat();
}

/**
 * The first probe for one derived address: the keypair itself (native SOL)
 * and its associated token account for each cash token.
 */
function cashAddresses(owner: PublicKey): PublicKey[] {
  return [owner, ...SUPPORTED_TOKENS.map((token) => ataFor(token.mint, owner, token.programId))];
}

/**
 * The second probe: the associated token account for every stock the app has
 * ever listed. A portfolio that only ever bought a stock holds no SOL worth
 * noticing and no cash account, so the first probe misses it. Asking by
 * address keeps this to one plain read; asking the chain for an owner's token
 * accounts is a heavy, rate-limited request.
 */
function stockAddresses(owner: PublicKey): PublicKey[] {
  return ALL_STOCKS.map((stock) => ataFor(stock.mint, owner, stock.programId));
}

/**
 * The SOL one owner holds and whether it shows any use: SOL and cash first,
 * then its stock accounts only when those showed nothing.
 *
 * Every request here names one owner's accounts and nobody else's. Putting
 * twenty candidates in one request would be cheaper, and would hand the RPC
 * provider, in a single line, the list of addresses one phrase derives.
 */
async function probeOwner(owner: PublicKey): Promise<{ lamports: number; used: boolean }> {
  const cash = await accountInfos(cashAddresses(owner));
  if (cash.some((info) => info !== null)) return { lamports: cash[0]?.lamports ?? 0, used: true };
  const stocks = await accountInfos(stockAddresses(owner));
  return { lamports: 0, used: stocks.some((info) => info !== null) };
}

export function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * `probeOwner` for each owner, a few at a time and in no particular order,
 * so the order the requests arrive in does not spell out the derivation
 * order. They still arrive together: see the note on timing in the README.
 */
async function probeOwners(owners: PublicKey[]): Promise<{ lamports: number; used: boolean }[]> {
  const results: { lamports: number; used: boolean }[] = [];
  await Promise.all(
    shuffled(owners.map((_, position) => position)).map(async (position) => {
      results[position] = await probeOwner(owners[position]);
    }),
  );
  return results;
}

/**
 * Scans sequential derivation indices starting right after the funding
 * index for accounts that show any sign of having been used, stopping after
 * `gapLimit` consecutive empty indices - BIP-44's own discovery convention.
 *
 * "Used" means the keypair holds SOL or has a token account for a mint we
 * know about: a cash token, or any stock ever listed.
 * Creating an account writes nothing on chain, so one that was never funded
 * cannot be found this way, and does not need to be: it holds nothing, and
 * re-deriving it costs nothing.
 */
export async function discoverExistingPortfolios(
  mnemonic: string,
  scheme: DerivationScheme,
  gapLimit = 20,
): Promise<DiscoveredPortfolio[]> {
  const discovered: DiscoveredPortfolio[] = [];
  let consecutiveMisses = 0;
  let nextIndex = FUNDING_DERIVATION_INDEX + 1;

  while (consecutiveMisses < gapLimit) {
    const batchIndices = Array.from({ length: gapLimit }, (_, offset) => nextIndex + offset);
    const batchKeypairs = batchIndices.map((index) => deriveKeypair(mnemonic, index, scheme));
    const batch = await probeOwners(batchKeypairs.map((keypair) => keypair.publicKey));

    for (let i = 0; i < batchIndices.length; i++) {
      if (batch[i].used) {
        discovered.push({
          index: batchIndices[i],
          address: batchKeypairs[i].publicKey.toBase58(),
          solBalance: lamportsToSol(batch[i].lamports),
        });
        consecutiveMisses = 0;
      } else {
        consecutiveMisses++;
        if (consecutiveMisses >= gapLimit) break;
      }
    }

    nextIndex += gapLimit;
  }

  return discovered;
}

async function schemeActivity(mnemonic: string, scheme: DerivationScheme): Promise<SchemeActivity> {
  const funding = deriveKeypair(mnemonic, FUNDING_DERIVATION_INDEX, scheme).publicKey;
  const [[fundingProbe], portfolios] = await Promise.all([
    probeOwners([funding]),
    discoverExistingPortfolios(mnemonic, scheme),
  ]);
  return {
    address: funding.toBase58(),
    balanceSol: lamportsToSol(fundingProbe.lamports),
    portfolios,
    active: fundingProbe.used || portfolios.length > 0,
  };
}

/**
 * Given a validated recovery phrase, reads what each of the two derivation
 * conventions this app knows about shows on chain, so an imported phrase
 * reunites with the addresses it actually used rather than silently landing
 * on an empty set.
 *
 * Activity is anything at all, at the funding index or at any portfolio the
 * scan finds: SOL, or a token account for any mint the app knows. Judging by the funding
 * wallet's SOL alone reads a wallet that holds only tokens, or one whose
 * first address was emptied into its portfolios, as never used.
 *
 * - Exactly one scheme shows activity: that scheme.
 * - Both, or neither: `scheme` is null and the caller asks the user. Neither
 *   is the normal case for a fresh phrase, but also what a fully emptied
 *   wallet looks like, and guessing wrong there opens the wrong addresses.
 */
export async function resolveImportedWallet(mnemonic: string): Promise<ImportResolution> {
  const [app, walletDefault] = await Promise.all([
    schemeActivity(mnemonic, "app"),
    schemeActivity(mnemonic, "walletDefault"),
  ]);
  const scheme = app.active === walletDefault.active ? null : app.active ? "app" : "walletDefault";
  return { scheme, app, walletDefault };
}
