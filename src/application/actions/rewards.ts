import {
  inviteCodeAsSent,
  withClaimQueued,
  withoutClaim,
  withoutRewards,
  type RewardsState,
} from "../../domain/rewards.js";
import type { Portfolio, RewardClaim } from "../../domain/wallet.js";
import type { OpenSession, RewardsApi, RewardsJoin, Signer, WalletStore } from "../ports.js";
import { refused, type Refused } from "../result.js";
import { openSession } from "./common.js";

export type RewardsDeps<K extends Signer> = {
  session: OpenSession<K>;
  store: WalletStore;
  api: RewardsApi<K>;
};

export type JoinRewardsResult =
  /** Joined, here and on the server, which may have known the member already. */
  | { kind: "joined"; state: RewardsState }
  /** The invite code is not one the server takes. Nothing was joined. */
  | { kind: "inviteNotValid" }
  /** No answer could be had, or the wallet could not keep that it joined. The wallet is as it was. */
  | { kind: "failed" }
  | Refused;

/**
 * Joins rewards: the member's own key signs for it, the server answers how
 * the member stands, and only then does the wallet keep that it joined. A
 * phrase that joined before, here or on another device, is found as it was
 * left. `inviteCode` counts on a first joining only.
 *
 * This is the one rewards action that says how it went. Nothing is asked of
 * the server about rewards before it, and nothing after it unless it
 * answered `joined`.
 */
export async function joinRewards<K extends Signer>(
  deps: RewardsDeps<K>,
  inviteCode?: string,
): Promise<JoinRewardsResult> {
  const session = openSession(deps.session);
  if ("kind" in session) return session;
  const member = session.rewardsKey();
  if (!member) return refused("walletLocked");
  let joined: RewardsJoin;
  try {
    joined = await deps.api.join(member, inviteCodeAsSent(inviteCode), session.live);
  } catch {
    return session.live() ? { kind: "failed" } : refused("walletLocked");
  }
  if (joined.kind === "inviteNotValid") return joined;
  const kept = await deps.store.update((wallet) => ({ ...wallet, rewardsJoined: true }));
  return kept ? joined : { kind: "failed" };
}

/**
 * Turns rewards off on this device: the wallet forgets that it joined, and
 * every trade still waiting to be claimed. From then on it asks the server
 * nothing about rewards.
 *
 * Only this device changes. The server keeps the member, its points, its
 * invite code and who it invited, and joining again with the same recovery
 * phrase, here or anywhere, finds them as they were.
 */
export async function leaveRewardsOnThisDevice<K extends Signer>(
  deps: Pick<RewardsDeps<K>, "store">,
): Promise<void> {
  await deps.store.update(withoutRewards).catch(() => false);
}

/**
 * How the member stands, read from the server with the member's own
 * signature. Null when the wallet has not joined, which asks nothing, and
 * null too when it is locked, the server runs no rewards, knows no such
 * member or could not be asked.
 */
export async function rewardsState<K extends Signer>(
  deps: RewardsDeps<K>,
): Promise<RewardsState | null> {
  const session = openSession(deps.session);
  if ("kind" in session || !session.wallet.rewardsJoined) return null;
  const member = session.rewardsKey();
  if (!member) return null;
  try {
    return await deps.api.state(member, session.live);
  } catch {
    return null;
  }
}

/** What one try at a claim came to: settled for good, still to be tried, or stopped because nothing can be asked now. */
type Tried = "settled" | "waiting" | "stopped";

/**
 * One try at one waiting claim, one at a time across tabs. The claim leaves
 * the wallet once the server has answered for good, whichever way: credited,
 * claimed before, or turned down. It stays while the trade is not final yet
 * and while no answer could be had.
 */
function tryClaim<K extends Signer>(deps: RewardsDeps<K>, claim: RewardClaim): Promise<Tried> {
  return deps.store.serialised("noirwire-rewards-claim", async () => {
    const session = openSession(deps.session);
    const wallet = deps.store.snapshot();
    if ("kind" in session || !wallet) return "stopped";
    const waiting = wallet.rewardClaims?.some((entry) => entry.signature === claim.signature);
    if (!wallet.rewardsJoined || !waiting) return "settled";

    const portfolio = wallet.portfolios.find(
      (entry) => entry.derivationIndex === claim.derivationIndex,
    );
    const member = session.rewardsKey();
    const owner = portfolio ? session.portfolioSigner(portfolio) : null;
    if (!member || !session.live()) return "stopped";
    // A claim whose portfolio is gone, or whose key is not the one for its address, can never be signed.
    if (owner) {
      try {
        const answer = await deps.api.claim({
          member,
          portfolio: owner,
          transaction: claim.signature,
          stillUnlocked: session.live,
        });
        if (answer.kind === "notFinalized") return "waiting";
      } catch {
        return "stopped";
      }
    }
    await deps.store.update((current) => withoutClaim(current, claim.signature));
    return "settled";
  });
}

/**
 * Claims one trade for points, for a wallet that joined: the trade is put
 * in line first, so a claim that cannot be made yet is not lost, and then
 * tried once. A wallet that has not joined keeps nothing and asks nothing.
 *
 * It is no part of the trade and no money action waits on it. It never
 * rejects, and nothing it finds is told to anyone.
 */
export async function claimTrade<K extends Signer>(
  deps: RewardsDeps<K>,
  signature: string,
  portfolio: Pick<Portfolio, "derivationIndex">,
): Promise<void> {
  try {
    if (!deps.store.snapshot()?.rewardsJoined) return;
    const claim = { signature, derivationIndex: portfolio.derivationIndex };
    await deps.store.update((wallet) => withClaimQueued(wallet, claim));
    await tryClaim(deps, claim);
  } catch {
    /* the claim waits in the wallet, or was never the wallet's to make */
  }
}

/**
 * Tries every waiting claim, oldest first and one at a time. One the server
 * cannot take yet stays for the next call, and the rest are still tried;
 * when no answer can be had at all, it stops there. It never rejects, and a
 * wallet that has not joined asks nothing.
 */
export async function claimQueuedTrades<K extends Signer>(deps: RewardsDeps<K>): Promise<void> {
  try {
    const wallet = deps.store.snapshot();
    if (!wallet?.rewardsJoined) return;
    for (const claim of wallet.rewardClaims ?? []) {
      if ((await tryClaim(deps, claim)) === "stopped") return;
    }
  } catch {
    /* whatever is left waits for the next call */
  }
}
