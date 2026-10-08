import {
  claimQueuedTrades as claimQueued,
  joinRewards as join,
  rewardsState as readState,
  type JoinRewardsResult,
} from "../application/actions/rewards.js";
import type { RewardsConfig, RewardsState } from "../domain/rewards.js";
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
 * How the member stands, or null: the wallet has not joined (nothing is
 * asked), is locked, or the server could not say. It never rejects.
 */
export function rewardsState(): Promise<RewardsState | null> {
  return readState(rewards);
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
