import type { RewardClaim, Wallet } from "./wallet.js";

/**
 * Rewards: points for trades, for a wallet that chose to join. Joining is
 * kept in the wallet's own record, and a wallet that has not joined asks the
 * server nothing about them.
 *
 * A member is known to the server by a key of its own (see `deriveRewardsKey`
 * in src/infrastructure/solana/keys.ts), which is no main wallet's and no
 * portfolio's. A trade is claimed by showing that the portfolio that made it
 * and the member are one person's, for the moment the server checks it.
 */

/**
 * The rules of inviting, which the server scores by and a screen states:
 * the part of an invited member's weekly score that also counts for whoever
 * invited them, and the boost an invited member's own fees get, for their
 * first weeks as a member. In whole percent, and in weeks.
 */
export const INVITER_SCORE_SHARE_PERCENT = 20;
export const INVITED_BOOST_PERCENT = 10;
export const INVITED_BOOST_WEEKS = 8;

/** What the server says of rewards as a whole, while it runs them. */
export type RewardsConfig = {
  /** When the season's first week starts, as the server writes a moment. */
  seasonStart: string;
  seasonWeeks: number;
  /** The points one week hands out between its members. */
  weeklyPoints: number;
  /**
   * How many members have had a trade's fee credited in the running week:
   * members with points to come, not everyone who traded. Named as the
   * server sends it. Null when the server does not say.
   */
  tradersThisWeek: number | null;
};

/** The running week, as it stands for one member. */
export type RewardsWeek = {
  index: number;
  /** When the week ends, as the server writes a moment. */
  endsAt: string;
  /** The fees of the member's own claimed trades this week, in millionths of a USDC. */
  feeMicroUsdc: string;
  /** The part of the week's points those fees would earn as things stand, in hundredths of a percent. An estimate. */
  shareBps: number;
  /** The same count as `RewardsConfig.tradersThisWeek`: members with a trade's fee credited this week. Null when the server does not say. */
  traders: number | null;
};

/** How a member stands. */
export type RewardsState = {
  /** The member's invite code, given at joining. */
  code: string;
  /** Whether the code can be used yet: true once the member has one trade credited. */
  codeActive: boolean;
  /** How many members joined with the code. */
  invited: number;
  wasInvited: boolean;
  /**
   * How many weeks of an invited member's boost are still to come: 0 for a
   * member who was not invited or whose boost is over. Null when the server
   * does not say.
   */
  boostWeeksLeft: number | null;
  /** Points of the weeks that have closed, a whole number as text. */
  points: string;
  /** Null when the server names no running week. */
  week: RewardsWeek | null;
};

/**
 * What a member signs to read its standing or claim a trade, as text: the
 * request it is for, the member's key, and the moment (Unix seconds) or, for
 * a claim, the trade's signature. The server checks a signature over exactly
 * these bytes, in UTF-8.
 */
export function rewardsMessage(
  action: "state" | "claim",
  rewardsKey: string,
  subject: string,
): string {
  return `NoirWire rewards v1\n${action}\n${rewardsKey}\n${subject}`;
}

/**
 * An invite code as the server issues one: eight characters from the
 * digits 2 to 9 and the capital letters without I and O, so none is taken
 * for another when read aloud or typed.
 */
export const INVITE_CODE_LENGTH = 8;
export const INVITE_CODE_PATTERN = /^[2-9A-HJ-NP-Z]{8}$/;

/**
 * Whether `text` is an invite code exactly as the server issues one. A
 * member's own code is taken from the server only when it is, and a code
 * that arrives in a link is worth offering only when it is.
 */
export function isInviteCode(text: unknown): text is string {
  return typeof text === "string" && INVITE_CODE_PATTERN.test(text);
}

/** An invite code as it is signed and sent: trimmed, in capitals. Undefined when nothing is left. */
export function inviteCodeAsSent(typed: string | undefined): string | undefined {
  return typed?.trim().toUpperCase() || undefined;
}

/**
 * What a member signs to join: the member's key, the moment (Unix seconds),
 * and the invite code exactly as it is sent, so nobody on the way can put
 * another in its place. Its last line is always there, and is empty when no
 * code is sent.
 */
export function rewardsJoinMessage(
  rewardsKey: string,
  at: number,
  inviteCode: string | undefined,
): string {
  return `NoirWire rewards v1\njoin\n${rewardsKey}\n${at}\n${inviteCode ?? ""}`;
}

/**
 * The most trades a wallet keeps waiting to be claimed. The list is sealed
 * and written with every change to the record, so it does not grow: past
 * this, the oldest goes.
 */
export const MAX_QUEUED_CLAIMS = 20;

/**
 * `wallet` with `claim` waiting, last in line. A wallet that has not joined
 * keeps nothing, and a trade already waiting is not added twice.
 */
export function withClaimQueued(wallet: Wallet, claim: RewardClaim): Wallet {
  const waiting = wallet.rewardClaims ?? [];
  if (!wallet.rewardsJoined || waiting.some((entry) => entry.signature === claim.signature)) {
    return wallet;
  }
  return { ...wallet, rewardClaims: [...waiting, claim].slice(-MAX_QUEUED_CLAIMS) };
}

/** `wallet` without the claim of `signature`, and without the list once it is empty. */
export function withoutClaim(wallet: Wallet, signature: string): Wallet {
  const waiting = wallet.rewardClaims ?? [];
  const left = waiting.filter((entry) => entry.signature !== signature);
  if (left.length === waiting.length) return wallet;
  if (left.length > 0) return { ...wallet, rewardClaims: left };
  const emptied = { ...wallet };
  delete emptied.rewardClaims;
  return emptied;
}

/** `wallet` as it was before it joined: no flag, and nothing waiting. */
export function withoutRewards(wallet: Wallet): Wallet {
  const left = { ...wallet };
  delete left.rewardsJoined;
  delete left.rewardClaims;
  return left;
}
