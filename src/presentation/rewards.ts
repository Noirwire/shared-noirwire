import type { JoinRewardsResult } from "../application/actions/rewards.js";
import { rewardsCopy } from "../copy/rewards.js";
import type { AppPlatform } from "../domain/appPlatform.js";
import { dateAndTime, usd, wholeNumber } from "../domain/format.js";
import type { RewardsConfig, RewardsState } from "../domain/rewards.js";
import { refusalMessage } from "./actionResult.js";

/** Where an invite link opens the app, with the code after it. */
const INVITE_LINK = "https://app.noirwire.com/?ref=";

const MICRO_USDC = 1_000_000;

/** One figure on the Rewards screen: what it is, and its value as it is shown. */
export type RewardsFigure = { label: string; value: string };

/** The running week: the member's own fees, the share of the week's points they would earn as things stand, and when it ends. */
export type RewardsWeekView = {
  fee: RewardsFigure;
  /** An estimate, and labelled as one. */
  share: RewardsFigure;
  /** Null when the server's moment cannot be read as one. */
  ends: RewardsFigure | null;
};

export type RewardsInviteView = {
  /** The code and its link, once the code can be used. Null until then, with `locked` saying when that is. */
  share: {
    code: RewardsFigure;
    link: RewardsFigure;
    /** The accessible names of the buttons that copy each. */
    copyCode: string;
    copyLink: string;
  } | null;
  locked: string | null;
  invited: RewardsFigure;
};

/** Asked before rewards are turned off on this device. */
export type RewardsLeaveConfirmView = {
  title: string;
  /** What turning them off does and does not lose. */
  body: string;
  confirm: string;
  cancel: string;
};

/** The home screen's way into Rewards, for a wallet that has not joined. */
export type RewardsPromoView = { title: string; detail: string; action: string };

/** How a member stands, ready to draw. */
export type RewardsStandingView = {
  points: RewardsFigure;
  /** Null when no week is running. */
  week: RewardsWeekView | null;
  invite: RewardsInviteView;
};

export type RewardsView = {
  title: string;
  /** What the app's navigation calls the screen. */
  nav: string;
  /** The one sentence said about a token, on both sides of joining. */
  token: string;
} & (
  | {
      joined: false;
      /** What joining means, a sentence to a line. */
      explanation: readonly string[];
      inviteCodeLabel: string;
      joinLabel: string;
      /** The join button's label while the joining is under way. */
      joiningLabel: string;
    }
  | {
      joined: true;
      /** Null while it has not been read, or could not be: `notNow` then says so. */
      standing: RewardsStandingView | null;
      notNow: string | null;
      leave: { label: string; note: string; confirm: RewardsLeaveConfirmView };
    }
);

function standingView(state: RewardsState): RewardsStandingView {
  const { week, invite } = rewardsCopy;
  const endsAt = state.week ? Date.parse(state.week.endsAt) : Number.NaN;
  return {
    points: { label: rewardsCopy.points, value: wholeNumber(Number(state.points)) },
    week: state.week && {
      fee: { label: week.fee, value: usd(Number(state.week.feeMicroUsdc) / MICRO_USDC) },
      share: {
        label: week.share,
        value: rewardsCopy.percent((state.week.shareBps / 100).toFixed(2)),
      },
      ends: Number.isFinite(endsAt) ? { label: week.ends, value: dateAndTime(endsAt) } : null,
    },
    invite: {
      share: state.codeActive
        ? {
            code: { label: invite.code, value: state.code },
            link: {
              label: invite.link,
              value: `${INVITE_LINK}${encodeURIComponent(state.code)}`,
            },
            copyCode: invite.copyCode,
            copyLink: invite.copyLink,
          }
        : null,
      locked: state.codeActive ? null : invite.locked,
      invited: { label: invite.invited, value: wholeNumber(state.invited) },
    },
  };
}

/**
 * The Rewards screen. `joined` is the wallet's own record of having joined
 * (`Wallet.rewardsJoined`), and `rewards` is how the member stands, or null
 * while that is not known. A wallet that has not joined is shown what
 * joining means and nothing of a member's; an app shows the screen at all
 * only where the server runs rewards.
 */
export function rewardsView(state: {
  joined: boolean;
  rewards: RewardsState | null;
  /** True while the member's standing is being read, so its absence is not yet said to be a failure. */
  loading?: boolean;
}): RewardsView {
  const { title, nav, token, join, leave } = rewardsCopy;
  if (!state.joined) {
    return {
      title,
      nav,
      token,
      joined: false,
      explanation: join.explanation,
      inviteCodeLabel: join.inviteCode,
      joinLabel: join.button,
      joiningLabel: join.busy,
    };
  }
  return {
    title,
    nav,
    token,
    joined: true,
    standing: state.rewards && standingView(state.rewards),
    notNow: state.rewards || state.loading ? null : rewardsCopy.notNow,
    leave: {
      label: leave.button,
      note: leave.note,
      confirm: { ...leave.confirm, body: leave.note },
    },
  };
}

/**
 * The home screen's way into Rewards: shown to a wallet that has not joined,
 * where the server runs rewards. Null for a wallet that has joined, and
 * while `config` is null. The number in it is the server's own.
 */
export function rewardsPromoView(
  config: RewardsConfig | null,
  joined: boolean,
): RewardsPromoView | null {
  if (!config || joined) return null;
  const { title, detail, action } = rewardsCopy.promo;
  return { title, detail: detail(wholeNumber(config.weeklyPoints)), action };
}

/**
 * What to say of a joining that did not go through, or null for one that
 * did. Chosen here from the action's own answer, never from the server's.
 */
export function rewardsJoinProblem(
  result: JoinRewardsResult,
  platform: AppPlatform = "web",
): string | null {
  switch (result.kind) {
    case "joined":
      return null;
    case "inviteNotValid":
      return rewardsCopy.join.inviteNotValid;
    case "failed":
      return rewardsCopy.join.failed;
    case "refused":
      return refusalMessage(result, platform);
  }
}
