import "../buffer-polyfill.js";

import { PublicKey } from "@solana/web3.js";
import { bridgeNetworkPins } from "../config.js";

/**
 * Everything the wallet bridge holds a request to. The programs below are the
 * same on every network; the order book's program, the rollup and its
 * validator, the mint and the custody are the network's, fixed by the build
 * (`solana/config.ts`). Nothing here is ever read from the terminal that
 * asks for a signature.
 */
export const ESPL_PROGRAM = new PublicKey("SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2");
export const PERMISSION_PROGRAM = new PublicKey("ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1");
export const MAGIC_PROGRAM = new PublicKey("Magic11111111111111111111111111111111111111");
export const EPHEMERAL_VAULT = new PublicKey("MagicVau1t999999999999999999999999999999999");
export const DELEGATION_PROGRAM = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
export const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");

/** The first eight bytes of each order book instruction: sha256("global:" + name). */
export const DISCRIMINATORS = {
  openTrader: "df9b9b1797a7aae5",
  setOrderKeys: "1db7fe12fe6e4b5a",
  deposit: "f223c68952e1f2b6",
  withdraw: "b712469c946da122",
} as const;

/** The markets whose risk accounts a withdrawal must carry. */
export const LAUNCHED_MARKETS: readonly number[] = [0];

export type BridgePins = {
  orderbookProgram: PublicKey;
  rollupUrl: string;
  rollupValidator: PublicKey;
  usdcMint: PublicKey;
  /** Null while the deployment's custody is not pinned: no deposit or withdrawal is signed. */
  custodyAuthority: PublicKey | null;
  marketIds: readonly number[];
  /** Whether the trader's balance in the rollup is private. */
  privateBalance: boolean;
};

/** The pins of the network this build is made for. */
export function bridgePins(): BridgePins {
  const pinned = bridgeNetworkPins();
  return {
    orderbookProgram: new PublicKey(pinned.orderbookProgram),
    rollupUrl: pinned.rollupUrl,
    rollupValidator: new PublicKey(pinned.rollupValidator),
    usdcMint: new PublicKey(pinned.usdcMint),
    custodyAuthority: pinned.custodyAuthority ? new PublicKey(pinned.custodyAuthority) : null,
    marketIds: LAUNCHED_MARKETS,
    privateBalance: pinned.privateBalance,
  };
}
