import type { JoinRewardsResult } from "../application/actions/rewards.js";
import { rewardsCopy } from "../copy/rewards.js";
import type { AppPlatform } from "../domain/appPlatform.js";
import { dateAndTime, usd, wholeNumber } from "../domain/format.js";
import {
  INVITED_BOOST_PERCENT,
  INVITED_BOOST_WEEKS,
  INVITER_SCORE_SHARE_PERCENT,
  type RewardsConfig,
  type RewardsState,
} from "../domain/rewards.js";
import { refusalMessage } from "./actionResult.js";

/** Where an invite link opens the app, with the code after it. */
const INVITE_LINK = "https://app.noirwire.com/?ref=";

/** Where a post is written on X, with its text and the link that goes beside it. */
const X_POST = "https://x.com/intent/post";

const MICRO_USDC = 1_000_000;

/** Under this many traders, a week is said to have "only" that many. */
const FEW_TRADERS_BELOW = 10;

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

/**
 * What a member sends to bring someone in: the link, a message for a chat
 * with the link in it, a post for X whose link goes beside the text, and
 * the words for the buttons that send them.
 */
export type RewardsShareView = {
  link: string;
  /** The whole message, link included, for the device's share sheet or the clipboard. */
  chat: string;
  /** The post's text. The link is not in it: `xUrl` carries both. */
  x: string;
  /** Opens X with the post written and the link attached. */
  xUrl: string;
  shareLabel: string;
  xLabel: string;
  /** Said once the invite is on the clipboard. */
  copied: string;
};

export type RewardsInviteView = {
  /** The ask, by how many have joined with the code so far. */
  headline: string;
  /** What inviting earns, in the scoring's own terms. */
  ask: string;
  /** What to send. Null until the code can be used, with `locked` saying when that is. */
  share: RewardsShareView | null;
  /** The code and its link as figures, with the names of the buttons that copy each. Null until the code can be used. */
  copy: {
    code: RewardsFigure;
    link: RewardsFigure;
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

/** What there is to earn: a title, how early it is this week when that is known, and a sentence to a line. */
export type RewardsPitchView = {
  title: string;
  /** Shown before the lines. Null when the server does not say how many have traded. */
  early: string | null;
  lines: readonly string[];
};

/** The home screen's way into Rewards, for a wallet that has not joined. */
export type RewardsPromoView = {
  title: string;
  detail: string;
  action: string;
  /** How early it is this week, or null when the server does not say. */
  early: string | null;
};

/** The home screen's card for a wallet that has joined: bring someone in, or what unlocks that. */
export type RewardsInviteCardView = {
  title: string;
  detail: string;
  action: string;
  /** What to send, once the code can be used. Null until then: the action then opens Rewards. */
  share: RewardsShareView | null;
};

/** How a member stands, ready to draw, in the order it is shown. */
export type RewardsStandingView = {
  invite: RewardsInviteView;
  /** How early it is this week. Null when no week is running or the server does not say. */
  early: string | null;
  points: RewardsFigure;
  /** Null when no week is running. */
  week: RewardsWeekView | null;
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
      /** What there is to earn, shown first. Null while the season is not known. */
      pitch: RewardsPitchView | null;
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

/**
 * How early it is in the running week, by how many traders have paid a fee
 * in it: nobody yet, only a few, or simply how many. Null when the count is
 * not known. Said the same way wherever it is said.
 */
export function rewardsEarlyLine(traders: number | null, weeklyPoints: number): string | null {
  const { early } = rewardsCopy;
  if (traders === null) return null;
  if (traders <= 0) return early.nobody(wholeNumber(weeklyPoints));
  if (traders === 1) return early.one;
  return traders < FEW_TRADERS_BELOW
    ? early.few(wholeNumber(traders))
    : early.many(wholeNumber(traders));
}

const inviteLink = (code: string) => `${INVITE_LINK}${encodeURIComponent(code)}`;

/** What a member with a usable code sends. The post names the week's points only when the season is known. */
function shareView(code: string, config: RewardsConfig | null): RewardsShareView {
  const { share } = rewardsCopy;
  const link = inviteLink(code);
  const rules = [INVITED_BOOST_PERCENT, INVITED_BOOST_WEEKS, INVITER_SCORE_SHARE_PERCENT] as const;
  const x = share.x(config ? share.xSplit(wholeNumber(config.weeklyPoints)) : "", ...rules);
  return {
    link,
    chat: share.chat(link, ...rules),
    x,
    xUrl: `${X_POST}?text=${encodeURIComponent(x)}&url=${encodeURIComponent(link)}`,
    shareLabel: share.shareLabel,
    xLabel: share.xLabel,
    copied: share.copied,
  };
}

function inviteHeadline(invited: number): string {
  const { headline } = rewardsCopy.invite;
  if (invited <= 0) return headline.none;
  if (invited === 1) return headline.one;
  return invited === 2 ? headline.two : headline.many(wholeNumber(invited));
}

function standingView(state: RewardsState, config: RewardsConfig | null): RewardsStandingView {
  const { week, invite } = rewardsCopy;
  const endsAt = state.week ? Date.parse(state.week.endsAt) : Number.NaN;
  return {
    invite: {
      headline: inviteHeadline(state.invited),
      ask: invite.ask(INVITER_SCORE_SHARE_PERCENT),
      share: state.codeActive ? shareView(state.code, config) : null,
      copy: state.codeActive
        ? {
            code: { label: invite.code, value: state.code },
            link: { label: invite.link, value: inviteLink(state.code) },
            copyCode: invite.copyCode,
            copyLink: invite.copyLink,
          }
        : null,
      locked: state.codeActive ? null : invite.locked,
      invited: { label: invite.invited, value: wholeNumber(state.invited) },
    },
    // Without the season the week's points are not known, and the line for nobody names them.
    early: state.week && config ? rewardsEarlyLine(state.week.traders, config.weeklyPoints) : null,
    points: { label: rewardsCopy.points, value: wholeNumber(Number(state.points)) },
    week: state.week && {
      fee: { label: week.fee, value: usd(Number(state.week.feeMicroUsdc) / MICRO_USDC) },
      share: {
        label: week.share,
        value: rewardsCopy.percent((state.week.shareBps / 100).toFixed(2)),
      },
      ends: Number.isFinite(endsAt) ? { label: week.ends, value: dateAndTime(endsAt) } : null,
    },
  };
}

function pitchView(config: RewardsConfig, invited: boolean): RewardsPitchView {
  const { pitch, promo } = rewardsCopy;
  return {
    title: promo.title,
    early: rewardsEarlyLine(config.tradersThisWeek, config.weeklyPoints),
    lines: [
      ...(invited ? [pitch.invited(INVITED_BOOST_PERCENT, INVITED_BOOST_WEEKS)] : []),
      pitch.split(wholeNumber(config.weeklyPoints)),
      pitch.fewer,
      pitch.season(wholeNumber(config.seasonWeeks)),
      pitch.invite(INVITER_SCORE_SHARE_PERCENT, INVITED_BOOST_PERCENT, INVITED_BOOST_WEEKS),
    ],
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
  /** What the server says of the season, or null while that is not known. */
  config: RewardsConfig | null;
  /** True while an invite code is waiting on this device, for a wallet that has not joined. */
  invited?: boolean;
}): RewardsView {
  const { title, nav, token, join, leave } = rewardsCopy;
  if (!state.joined) {
    return {
      title,
      nav,
      token,
      joined: false,
      pitch: state.config && pitchView(state.config, state.invited === true),
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
    standing: state.rewards && standingView(state.rewards, state.config),
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
 * while `config` is null. The numbers in it are the server's own and the
 * scoring's. With `invited`, an invite code is waiting on this device, and
 * the card says what joining with it brings.
 */
export function rewardsPromoView(
  config: RewardsConfig | null,
  joined: boolean,
  invited = false,
): RewardsPromoView | null {
  if (!config || joined) return null;
  const { promo } = rewardsCopy;
  const early = rewardsEarlyLine(config.tradersThisWeek, config.weeklyPoints);
  if (invited) {
    return {
      title: promo.invited.title,
      detail: promo.invited.detail(INVITED_BOOST_PERCENT, INVITED_BOOST_WEEKS),
      action: promo.invited.action,
      early,
    };
  }
  return {
    title: promo.title,
    detail: promo.detail(wholeNumber(config.weeklyPoints)),
    action: promo.action,
    early,
  };
}

/**
 * The home screen's card for a wallet that has joined. With a code that can
 * be used it asks for an invite and carries what to send; before that it
 * says what unlocks the code and leads to Rewards. Null while the member's
 * standing is not known. `config` only adds the week's points to the post.
 */
export function rewardsInviteCardView(
  rewards: RewardsState | null,
  config: RewardsConfig | null,
): RewardsInviteCardView | null {
  if (!rewards) return null;
  const { active, locked } = rewardsCopy.inviteCard;
  if (!rewards.codeActive) {
    return {
      title: locked.title,
      detail: locked.detail(INVITER_SCORE_SHARE_PERCENT),
      action: locked.action,
      share: null,
    };
  }
  return {
    title: active.title,
    detail: active.detail(INVITER_SCORE_SHARE_PERCENT, INVITED_BOOST_PERCENT, INVITED_BOOST_WEEKS),
    action: active.action,
    share: shareView(rewards.code, config),
  };
}

/**
 * The banner where a wallet is created or restored, while an invite code is
 * waiting on this device. Null when none is.
 */
export function rewardsInvitedBannerView(
  invited: boolean,
): { title: string; detail: string } | null {
  if (!invited) return null;
  const { title, detail } = rewardsCopy.invitedBanner;
  return { title, detail: detail(INVITED_BOOST_PERCENT, INVITED_BOOST_WEEKS) };
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
