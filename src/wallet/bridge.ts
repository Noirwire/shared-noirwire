import type { Wallet } from "../domain/wallet.js";
import {
  decodeSignInMessage,
  decodeTransactionMessage,
} from "../infrastructure/solana/walletBridge/decode.js";
import {
  GUARD_TIMEOUT_MS,
  guardRollup,
  guardSolana,
  solanaReadsThroughApi,
  type GuardDeps,
  type GuardResult,
} from "../infrastructure/solana/walletBridge/networkGuard.js";
import { bridgePins, type BridgePins } from "../infrastructure/solana/walletBridge/pins.js";
import { PublicKey } from "@solana/web3.js";
import type { BridgePorts, NetworkVerdict } from "../application/walletBridge.js";
import type { Refusal } from "../domain/walletBridge/protocol.js";
import {
  WalletLockedError,
  signBytesWhileUnlocked,
} from "../infrastructure/solana/signerAccounts.js";
import { unlockedSession } from "./session.js";
import { getSnapshot, sessionGeneration, unlockedSince } from "./store.js";

/**
 * The wallet bridge's only way to a key. It signs the exact bytes it was
 * handed, which the caller has read and the user has approved, and returns
 * only a signature: the terminal attaches it and sends. It writes nothing to
 * the wallet record.
 */

/** The account the terminal is connected to, as bound at connect time. */
export type BridgeAccount = { address: string; derivationIndex: number };

export type BridgeSigning =
  | { ok: true; signature: Uint8Array }
  | {
      ok: false;
      refusal: Extract<Refusal, "locked" | "unsafeBrowser" | "notAllowed" | "pendingAction">;
    };

/** Taken when a request is shown, and handed back when it is approved: a lock and unlock between them makes it a different one. */
export function shownGeneration(): number {
  return sessionGeneration();
}

type Found = { derivationIndex: number; pending: boolean };

function accountIn(wallet: Wallet, address: string): Found | null {
  if (wallet.funding.address === address) {
    return { derivationIndex: 0, pending: wallet.funding.pendingAction !== undefined };
  }
  const portfolio = wallet.portfolios.find(
    (entry) => entry.address === address && entry.archivedAt === null,
  );
  return portfolio
    ? { derivationIndex: portfolio.derivationIndex, pending: portfolio.pendingAction !== undefined }
    : null;
}

/**
 * Signs `message` for `account`, in one synchronous run with nothing awaited
 * between the checks and the signature: the browser is safe across tabs, the
 * wallet has stayed unlocked since the request was shown, the account still
 * exists, is not archived and has no action pending, and the key derived at
 * its index is the key for its address.
 */
export function signForBridge(input: {
  message: Uint8Array;
  account: BridgeAccount;
  shownGeneration: number;
  safeAcrossTabs: boolean;
}): BridgeSigning {
  const { message, account } = input;
  if (!input.safeAcrossTabs) return { ok: false, refusal: "unsafeBrowser" };
  if (!unlockedSince(input.shownGeneration)) return { ok: false, refusal: "locked" };
  const wallet = getSnapshot();
  if (!wallet) return { ok: false, refusal: "locked" };
  const found = accountIn(wallet, account.address);
  if (!found || found.derivationIndex !== account.derivationIndex) {
    return { ok: false, refusal: "notAllowed" };
  }
  if (found.pending) return { ok: false, refusal: "pendingAction" };
  const session = unlockedSession();
  if ("refused" in session) return { ok: false, refusal: "locked" };
  const key = session.keyAt(account.derivationIndex);
  if (!key) return { ok: false, refusal: "locked" };
  if (key.publicKey.toBase58() !== account.address) return { ok: false, refusal: "notAllowed" };
  try {
    return { ok: true, signature: signBytesWhileUnlocked(message, key, session.live) };
  } catch (error) {
    if (error instanceof WalletLockedError) return { ok: false, refusal: "locked" };
    throw error;
  }
}

function verdictOf(result: GuardResult): NetworkVerdict {
  return result.ok ? "ok" : result.refusal;
}

/** The bridge's reads wired to the network this build is made for. */
export function bridgePorts(
  overrides: { pins?: BridgePins; guard?: GuardDeps; now?: () => number } = {},
): BridgePorts {
  const pins = overrides.pins ?? bridgePins();
  const guard: GuardDeps = overrides.guard ?? {
    solana: solanaReadsThroughApi,
    fetch: (input, init) => fetch(input, init),
    timeoutMs: GUARD_TIMEOUT_MS,
  };
  return {
    decodeSignIn: decodeSignInMessage,
    decodeTransaction: (message, network, owner) =>
      decodeTransactionMessage(message, { owner: new PublicKey(owner), network, pins }),
    checkNetwork: async (decoded) =>
      verdictOf(
        decoded.network === "solana"
          ? await guardSolana(decoded.recentBlockhash, guard)
          : await guardRollup(decoded.recentBlockhash, pins, guard),
      ),
    now: overrides.now ?? (() => Date.now()),
  };
}
