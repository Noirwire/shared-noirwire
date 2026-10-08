import {
  claimQueuedTrades as claimQueued,
  claimTrade as claim,
  joinRewards as join,
  leaveRewardsOnThisDevice as leave,
  rewardsState as readState,
  type JoinRewardsResult,
} from "../application/actions/rewards.js";
import type { RewardsConfig, RewardsState } from "../domain/rewards.js";
import type { Portfolio } from "../domain/wallet.js";
import { rewardsApi } from "../infrastructure/solana/rewards.js";
import { rewards } from "./money.js";

/**
 * Rewards, wired for the app: points for trades, for a wallet that chose to
 * join. Until it has, only `rewardsConfig` and `joinRewards` ask the server
 * anything, and each only when the app calls it.
 */

/**
 * What the server says of rewards, or null while it runs none or could not
 * be asked: an app shows nothing of rewards then. The request names no
 * wallet and no key, and is made only when this is called. It never rejects.
 */
export function rewardsConfig(): Promise<RewardsConfig | null> {
  return rewardsApi.config().catch(() => null);
}

/**
 * Joins rewards and says how it went: `joined` with how the member stands,
 * `inviteNotValid`, `failed`, or refused while the wallet is locked. The
 * wallet keeps that it joined only on `joined`. A recovery phrase that
 * joined before, here or on another device, is found as it was left.
 */
export function joinRewards(inviteCode?: string): Promise<JoinRewardsResult> {
  return join(rewards, inviteCode);
}

/**
 * Turns rewards off on this device: the wallet forgets that it joined and
 * every trade still waiting to be claimed, and asks the server nothing more.
 * The server keeps the member's points, invite code and invited members,
 * and joining again with the same recovery phrase finds them.
 */
export function leaveRewardsOnThisDevice(): Promise<void> {
  return leave(rewards);
}

/**
 * How the member stands, or null: the wallet has not joined (nothing is
 * asked), is locked, or the server could not say. It never rejects.
 */
export function rewardsState(): Promise<RewardsState | null> {
  return readState(rewards);
}

/**
 * Claims one trade for points. Every trade placed through the money wiring
 * is claimed this way already, without being waited for, so an app has no
 * need to call it for those. It never rejects.
 */
export function claimTrade(
  signature: string,
  portfolio: Pick<Portfolio, "derivationIndex">,
): Promise<void> {
  return claim(rewards, signature, portfolio);
}

/**
 * Tries every trade still waiting to be claimed, one at a time. A trade is
 * usually too new to be claimed the moment it lands, so an app calls this
 * after an unlock and when the Rewards screen opens, and does not wait for
 * it. It never rejects, and a wallet that has not joined asks nothing.
 */
export function claimQueuedTrades(): Promise<void> {
  return claimQueued(rewards);
}
