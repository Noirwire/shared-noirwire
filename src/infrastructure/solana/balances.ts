import "./buffer-polyfill.js";

import type { PublicKey } from "@solana/web3.js";
import { connection } from "./client.js";
import { isMainnet } from "./config.js";
import { lamportsToSol } from "./sol.js";
import { readTokenAmount } from "./swap/guard.js";
import { ataFor } from "./tokens.js";
import { ALL_STOCKS, SUPPORTED_TOKENS, type TokenDefinition } from "./tokenRegistry.js";

/**
 * SOL and every cash token one address holds, keyed by symbol, in a single
 * request. Reading them one at a time costs a request each, and a balance
 * refresh runs every time a portfolio is opened.
 *
 * One request per address, and never two addresses in one: a request that
 * named the funding wallet and a portfolio together would tell the RPC
 * provider they belong to the same person.
 */
export async function getCashBalances(owner: PublicKey): Promise<Record<string, number>> {
  const [wallet, ...tokenAccounts] = await connection.getMultipleAccountsInfo([
    owner,
    ...SUPPORTED_TOKENS.map((token) => ataFor(token.mint, owner, token.programId)),
  ]);
  return {
    SOL: lamportsToSol(wallet?.lamports ?? 0),
    ...Object.fromEntries(
      SUPPORTED_TOKENS.map((token, index) => [
        token.symbol,
        Number(readTokenAmount(tokenAccounts[index]?.data)) / 10 ** token.decimals,
      ]),
    ),
  };
}

/** The most accounts one getMultipleAccounts request takes. */
const ACCOUNTS_PER_REQUEST = 100;

/**
 * The tracker mints exist on mainnet only. On any other network an account
 * at one of their addresses is not that tracker, so none is read.
 */
function networkTrackers(): readonly TokenDefinition[] {
  return isMainnet() ? ALL_STOCKS : [];
}

type PortfolioBalances = {
  /** SOL and each cash token, keyed by symbol. */
  cash: Record<string, number>;
  /**
   * What the chain holds of each tracker in the catalog, retired ones
   * included, as raw token amounts before any multiplier. Every tracker read
   * is named, at zero when none is held. Empty where there are none to read.
   */
  trackers: Record<string, number>;
};

/**
 * Everything one portfolio holds, from the chain: SOL, cash, and its token
 * account for every tracker the app has ever listed. Holdings used to be
 * known only from the trades this browser placed, so a tracker that arrived
 * from outside, or any tracker of a wallet restored on a new device, was
 * never shown.
 *
 * Read by address, as associated token accounts under each mint's own token
 * program, which keeps this to plain account reads: one request for today's
 * catalog, and one more per hundred addresses if it grows. Every request
 * names this one portfolio's accounts and nobody else's.
 */
export async function getPortfolioBalances(
  owner: PublicKey,
  trackers: readonly TokenDefinition[] = networkTrackers(),
): Promise<PortfolioBalances> {
  const tokens = [...SUPPORTED_TOKENS, ...trackers];
  const addresses = [owner, ...tokens.map((token) => ataFor(token.mint, owner, token.programId))];
  const infos: Awaited<ReturnType<typeof connection.getMultipleAccountsInfo>> = [];
  for (let start = 0; start < addresses.length; start += ACCOUNTS_PER_REQUEST) {
    infos.push(
      ...(await connection.getMultipleAccountsInfo(
        addresses.slice(start, start + ACCOUNTS_PER_REQUEST),
      )),
    );
  }
  const [wallet, ...tokenAccounts] = infos;
  const held = (token: TokenDefinition, index: number) =>
    [
      token.symbol,
      Number(readTokenAmount(tokenAccounts[index]?.data)) / 10 ** token.decimals,
    ] as const;
  return {
    cash: {
      SOL: lamportsToSol(wallet?.lamports ?? 0),
      ...Object.fromEntries(SUPPORTED_TOKENS.map(held)),
    },
    trackers: Object.fromEntries(
      trackers.map((token, index) => held(token, SUPPORTED_TOKENS.length + index)),
    ),
  };
}
