import "./buffer-polyfill.js";

import type { Keypair, PublicKey } from "@solana/web3.js";
import type { StillUnlocked } from "./signerAccounts.js";
import { depositSol, ensureSolAccountReady, getWalletBalanceSol, sendSolTo } from "./sol.js";
import {
  depositToken,
  ensureTokenAccountExists,
  getTokenBalance,
  withdrawToken,
} from "./tokens.js";
import { tokenBySymbol } from "./tokenRegistry.js";

/**
 * One uniform interface over every real, onchain-funded asset an account can
 * hold: native SOL, or any registered SPL token. Writes take the account's
 * own derived keypair because it signs, and `stillUnlocked`, which is asked
 * again right before that key is used; reading a balance needs only the
 * address.
 */
type AssetHandle = {
  symbol: string;
  getBalance(owner: PublicKey): Promise<number>;
  ensureAccount(owner: Keypair, funder: Keypair, stillUnlocked: StillUnlocked): Promise<void>;
  deposit(
    funder: Keypair,
    owner: Keypair,
    amount: number,
    stillUnlocked: StillUnlocked,
  ): Promise<void>;
  withdraw(
    owner: Keypair,
    funder: Keypair,
    amount: number,
    to: PublicKey,
    stillUnlocked: StillUnlocked,
  ): Promise<void>;
};

const SOL_HANDLE: AssetHandle = {
  symbol: "SOL",
  getBalance: getWalletBalanceSol,
  ensureAccount: ensureSolAccountReady,
  deposit: (funder, owner, amount, stillUnlocked) =>
    depositSol(funder, owner.publicKey, amount, stillUnlocked),
  withdraw: (owner, funder, amount, to, stillUnlocked) =>
    sendSolTo(owner, funder, to, amount, stillUnlocked),
};

function tokenHandle(symbol: string): AssetHandle | undefined {
  const token = tokenBySymbol(symbol);
  if (!token) return undefined;
  return {
    symbol: token.symbol,
    getBalance: (owner) => getTokenBalance(token.mint, token.decimals, owner, token.programId),
    ensureAccount: (owner, funder, stillUnlocked) =>
      ensureTokenAccountExists(token.mint, owner.publicKey, funder, token.programId, stillUnlocked),
    deposit: (funder, owner, amount, stillUnlocked) =>
      depositToken(
        token.mint,
        token.decimals,
        funder,
        owner.publicKey,
        amount,
        token.programId,
        stillUnlocked,
      ),
    withdraw: (owner, funder, amount, to, stillUnlocked) =>
      withdrawToken(
        token.mint,
        token.decimals,
        owner,
        funder,
        amount,
        to,
        token.programId,
        stillUnlocked,
      ),
  };
}

/** The uniform handle for one real asset ("SOL" or a registered token's symbol), or undefined for anything else. */
export function assetHandle(symbol: string): AssetHandle | undefined {
  return symbol === "SOL" ? SOL_HANDLE : tokenHandle(symbol);
}
