import "./buffer-polyfill.js";

import type { Keypair, PublicKey } from "@solana/web3.js";
import {
  DISCOVERY_GAP,
  EXTENDED_DISCOVERY_GAP,
  type DiscoveredPortfolio,
  type ImportResolution,
  type SchemeActivity,
} from "../../domain/importResolution.js";
import { createPacer, type Pacer } from "../../application/pacer.js";
import { isTransient, withRetries } from "../../application/retries.js";
import type { DerivationScheme } from "../../domain/wallet.js";
import { connection } from "./client.js";
import { deriveKeypair, FUNDING_DERIVATION_INDEX } from "./keys.js";
import { lamportsToSol } from "./sol.js";
import { ataFor } from "./tokens.js";
import { ALL_STOCKS, SUPPORTED_TOKENS } from "./tokenRegistry.js";

export type { DiscoveredPortfolio, ImportResolution, SchemeActivity };

/** getMultipleAccounts accepts at most this many addresses in one request. */
const MAX_ADDRESSES_PER_REQUEST = 100;

/** A burst of requests is refused on a busy moment, and an import that fails on one reads as a broken phrase. */
const MAX_REQUESTS_IN_FLIGHT = 3;

/**
 * The most lookups an import starts in a second, across both derivation
 * schemes together. Providers commonly allow about ten; three in flight with
 * fast answers would pass that at once.
 */
export const IMPORT_REQUESTS_PER_SECOND = 8;

/**
 * Each lookup is tried four times, about 1, 2 and 4 seconds apart, before the
 * import says it could not finish. Each pause is stretched by up to half at
 * random, so lookups refused together do not all come back together.
 */
const LOOKUP_RETRY = { tries: 4, pauseMs: 1_000, jitter: 0.5, retryable: isTransient };

/** How many candidate addresses are looked up before their answers are counted and kept. */
const OWNERS_PER_STEP = 10;

let pacer: Pacer | null = createPacer({ perSecond: IMPORT_REQUESTS_PER_SECOND });

/**
 * Sets how an import's lookups are paced: another pacer for a provider with
 * another limit, or null for none, as against a local validator.
 */
export function paceImportWith(next: Pacer | null): void {
  pacer = next;
}

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

function accountInfoBatch(addresses: PublicKey[]) {
  // The turn is taken once the request holds its slot, right before it is
  // sent. Taken earlier, requests that waited for a slot behind slow answers
  // would all start together the moment those came back.
  return withRetries(
    () =>
      inTurn(async () => {
        await pacer?.turn();
        return connection.getMultipleAccountsInfo(addresses);
      }),
    LOOKUP_RETRY,
  );
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
 * Everything that would show one derived address was used: the keypair
 * itself (native SOL), its associated token account for each cash token, and
 * for every stock the app has ever listed. A portfolio that only ever bought
 * a stock holds no SOL worth noticing and no cash account. Asking by address
 * keeps this to a plain read; asking the chain for an owner's token accounts
 * is a heavy, rate-limited request.
 */
function accountsOf(owner: PublicKey): PublicKey[] {
  return [
    owner,
    ...SUPPORTED_TOKENS.map((token) => ataFor(token.mint, owner, token.programId)),
    ...ALL_STOCKS.map((stock) => ataFor(stock.mint, owner, stock.programId)),
  ];
}

type Probe = { lamports: number; used: boolean };

/**
 * The SOL one owner holds and whether it shows any use, in one request while
 * the catalog fits in one.
 *
 * Every request here names one owner's accounts and nobody else's. Putting
 * twenty candidates in one request would be cheaper, and would hand the RPC
 * provider, in a single line, the list of addresses one phrase derives.
 */
async function probeOwner(owner: PublicKey): Promise<Probe> {
  const infos = await accountInfos(accountsOf(owner));
  return { lamports: infos[0]?.lamports ?? 0, used: infos.some((info) => info !== null) };
}

/**
 * Hands the thread back before the next owner's addresses are worked out.
 * Deriving a key and its token accounts is slow arithmetic on a phone, and a
 * step of ten in one go holds the screen still: nothing is drawn and a tap
 * on Cancel waits. A turn of the event loop between owners lets both through.
 */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * `probeOwner` for each owner, in no particular order, so the order the
 * requests arrive in does not spell out the derivation order. They still
 * arrive together: see the note on timing in the README.
 */
async function probeOwners(owners: PublicKey[]): Promise<Probe[]> {
  const results: Probe[] = [];
  const asked: Promise<void>[] = [];
  for (const position of shuffled(owners.map((_, index) => index))) {
    await breathe();
    asked.push(
      probeOwner(owners[position]).then((probe) => {
        results[position] = probe;
      }),
    );
  }
  await Promise.all(asked);
  return results;
}

/** How far a scan has got: what it found, the next index to judge, and the unused run it is in. */
type Scan = { next: number; misses: number; found: DiscoveredPortfolio[]; funding?: Probe };

const newScan = (from: number): Scan => ({ next: from, misses: 0, found: [] });

/**
 * The scans of an import under way, by the funding address they belong to,
 * kept in memory until the import has its answer. An attempt that fails
 * leaves them here, so the next one carries on from the last step that
 * completed instead of starting again, and joins a scan still running.
 */
const scans = new Map<string, { scan: Scan; running: Promise<void> | null }>();

/**
 * Judges derivation indices from `scan.next` on, a step at a time, until
 * `gapLimit` in a row show no use. `scan` is brought up to date after every
 * completed step, so a failure loses only the step it happened in.
 */
async function continueScan(
  mnemonic: string,
  scheme: DerivationScheme,
  gapLimit: number,
  scan: Scan,
): Promise<void> {
  while (scan.misses < gapLimit) {
    const indices = Array.from({ length: OWNERS_PER_STEP }, (_, offset) => scan.next + offset);
    const keypairs: Keypair[] = [];
    for (const index of indices) {
      await breathe();
      keypairs.push(deriveKeypair(mnemonic, index, scheme));
    }
    const probes = await probeOwners(keypairs.map((keypair) => keypair.publicKey));
    for (let i = 0; i < indices.length && scan.misses < gapLimit; i++) {
      scan.next = indices[i] + 1;
      if (probes[i].used) {
        scan.found.push({
          index: indices[i],
          address: keypairs[i].publicKey.toBase58(),
          solBalance: lamportsToSol(probes[i].lamports),
        });
        scan.misses = 0;
      } else {
        scan.misses++;
      }
    }
  }
}

/**
 * Runs the scan kept under `key`, or a new one from `from`, to its end and
 * hands it back. It stays kept, finished or failed, until it is forgotten.
 */
async function scanned(
  key: string,
  from: number,
  run: (scan: Scan) => Promise<void>,
): Promise<Scan> {
  const entry = scans.get(key) ?? { scan: newScan(from), running: null };
  scans.set(key, entry);
  entry.running ??= run(entry.scan).finally(() => {
    entry.running = null;
  });
  await entry.running;
  return entry.scan;
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
  gapLimit = DISCOVERY_GAP,
): Promise<DiscoveredPortfolio[]> {
  const scan = newScan(FUNDING_DERIVATION_INDEX + 1);
  await continueScan(mnemonic, scheme, gapLimit, scan);
  return scan.found;
}

const scanKey = (scheme: DerivationScheme, address: string) => `${scheme}:${address}`;

async function schemeActivity(mnemonic: string, scheme: DerivationScheme): Promise<SchemeActivity> {
  const funding = deriveKeypair(mnemonic, FUNDING_DERIVATION_INDEX, scheme).publicKey;
  const address = funding.toBase58();
  const scan = await scanned(
    scanKey(scheme, address),
    FUNDING_DERIVATION_INDEX + 1,
    async (state) => {
      state.funding ??= (await probeOwners([funding]))[0];
      await continueScan(mnemonic, scheme, DISCOVERY_GAP, state);
    },
  );
  const fundingProbe = scan.funding!;
  return {
    address,
    balanceSol: lamportsToSol(fundingProbe.lamports),
    portfolios: scan.found,
    active: fundingProbe.used || scan.found.length > 0,
    scannedThrough: scan.next - 1,
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
 *
 * Both schemes share one pace, `IMPORT_REQUESTS_PER_SECOND`. An attempt that
 * fails keeps what it had read: calling this again with the same phrase
 * carries on from the last step that completed.
 */
export async function resolveImportedWallet(mnemonic: string): Promise<ImportResolution> {
  const [app, walletDefault] = await Promise.all([
    schemeActivity(mnemonic, "app"),
    schemeActivity(mnemonic, "walletDefault"),
  ]);
  scans.delete(scanKey("app", app.address));
  scans.delete(scanKey("walletDefault", walletDefault.address));
  const scheme = app.active === walletDefault.active ? null : app.active ? "app" : "walletDefault";
  return { scheme, app, walletDefault };
}

/**
 * Looks further for a phrase's portfolios, when one is missing after an
 * import: carries on from where the first scan stopped, and gives up only
 * after `EXTENDED_DISCOVERY_GAP` unused addresses in a row. Hands back
 * `activity` with whatever more was found. Like the first scan, an attempt
 * that fails carries on where it was when asked again.
 */
export async function lookFurtherForPortfolios(
  mnemonic: string,
  scheme: DerivationScheme,
  activity: SchemeActivity,
): Promise<SchemeActivity> {
  const lastFound = activity.portfolios.at(-1)?.index ?? FUNDING_DERIVATION_INDEX;
  const from = (activity.scannedThrough ?? lastFound + DISCOVERY_GAP) + 1;
  const key = `${scanKey(scheme, activity.address)}:${from}`;
  const scan = await scanned(key, from, (state) =>
    continueScan(mnemonic, scheme, EXTENDED_DISCOVERY_GAP, state),
  );
  scans.delete(key);
  return {
    ...activity,
    portfolios: [...activity.portfolios, ...scan.found],
    active: activity.active || scan.found.length > 0,
    scannedThrough: scan.next - 1,
  };
}
