import type { JoinRewardsResult } from "../application/actions/rewards.js";
import { plural } from "../copy/plural.js";
import { rewardsCopy } from "../copy/rewards.js";
import type { AppPlatform } from "../domain/appPlatform.js";
import { dateAndTime, usd, wholeNumber } from "../domain/format.js";
import {
  INVITED_BOOST_PERCENT,
  INVITED_BOOST_WEEKS,
  INVITER_SCORE_SHARE_PERCENT,
  INVITE_CODE_LENGTH,
  inviteCodeAsSent,
  isInviteCode,
  type RewardsConfig,
  type RewardsState,
} from "../domain/rewards.js";
import { refusalMessage } from "./actionResult.js";

/** Where an invite link opens the app, with the code after it. */
const INVITE_LINK = "https://app.noirwire.com/?ref=";

/** Where a post is written on X, with its text and the link that goes beside it. */
const X_POST = "https://x.com/intent/post";

const MICRO_USDC = 1_000_000;

/** Under this many members with points, a week is said to have "only" that many. */
const FEW_MEMBERS_BELOW = 10;

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
  /** The ask, by how many have joined with the code so far. Until the code can be used, what unlocks it (`locked.title`). */
  headline: string;
  /** What inviting earns, in the scoring's own terms. */
  ask: string;
  /** What to send. Null until the code can be used, with `locked` saying what unlocks it. */
  share: RewardsShareView | null;
  /** The code and its link as figures, with the names of the buttons that copy each. Null until the code can be used. */
  copy: {
    code: RewardsFigure;
    link: RewardsFigure;
    copyCode: string;
    copyLink: string;
  } | null;
  /** What unlocks the invite link, and where to go to do it. Null once the code can be used. */
  locked: RewardsInviteLockedView | null;
  invited: RewardsFigure;
};

/** The invite section before the member's first trade: what unlocks the link, and an action that leads to a trade. */
export type RewardsInviteLockedView = { title: string; detail: string; action: string };

/** What there is to earn: a title, how early it is this week when that is known, and a sentence to a line. */
export type RewardsPitchView = {
  title: string;
  /** Shown before the lines. Null when the server does not say how many have traded. */
  early: string | null;
  /** Which member the person would be, joining now. Null when the server does not say how many there are. */
  next: string | null;
  lines: readonly string[];
};

/** The home screen's way into Rewards, for a wallet that has not joined. */
export type RewardsPromoView = {
  title: string;
  detail: string;
  action: string;
  /** How early it is this week, or null when the server does not say. */
  early: string | null;
  /** Which member the person would be, joining now. Null when the server does not say how many there are. */
  next: string | null;
};

/** The home screen's card for a wallet that has joined: bring someone in, or what unlocks that. */
export type RewardsInviteCardView = {
  title: string;
  detail: string;
  action: string;
  /** What to send, once the code can be used. Null until then: the action then leads to where there is something to trade. */
  share: RewardsShareView | null;
  /** Which member this is, as one line. Null when the server does not say. */
  member: string | null;
};

/** A member's boost from the invite they joined with. */
export type RewardsBoostView = { title: string; detail: string };

/** The invite code that will be sent with a joining, shown so the person sees it is in use. */
export type RewardsInviteAppliedView = { label: string; code: string; detail: string };

/** What the invite code field says of the text in it: a code in use, or why the text is none. Neither for no text. */
export type RewardsInviteFieldView = {
  applied: RewardsInviteAppliedView | null;
  problem: string | null;
};

/** How a member stands, ready to draw, in the order it is shown. */
export type RewardsStandingView = {
  /** Which member this is. Null when the server does not say. */
  member: RewardsFigure | null;
  invite: RewardsInviteView;
  /** That the invite the member joined with is counting, while its boost lasts. Null otherwise. */
  boost: RewardsBoostView | null;
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
      /** The code waiting on this device, when it could be one: it goes with the joining. */
      inviteApplied: RewardsInviteAppliedView | null;
      /** Why the text waiting on this device is no code. Null when there is none, or it could be one. */
      inviteProblem: string | null;
      joinLabel: string;
      /** The join button's label while the joining is under way. */
      joiningLabel: string;
    }
  | {
      joined: true;
      /** Null while it has not been read, or could not be: `notNow` then says so. */
      standing: RewardsStandingView | null;
      notNow: string | null;
    }
);

/**
 * How early it is in the running week, by how many members have earned
 * points in it: none yet, only a few, or simply how many. `members` is the
 * server's count of members with a trade credited this week
 * (`tradersThisWeek`, `week.traders`), which is not everyone who traded.
 * Null when the count is not known. Said the same way wherever it is said.
 */
export function rewardsEarlyLine(members: number | null, weeklyPoints: number): string | null {
  const { early } = rewardsCopy;
  if (members === null) return null;
  if (members <= 0) return early.nobody(wholeNumber(weeklyPoints));
  if (members === 1) return early.one;
  return members < FEW_MEMBERS_BELOW
    ? early.few(wholeNumber(members))
    : early.many(wholeNumber(members));
}

/**
 * `text` as part of an address, for any string at all: a string that
 * cannot be encoded as it stands, because half of a character pair is
 * missing, is encoded without those halves.
 */
function encoded(text: string): string {
  try {
    return encodeURIComponent(text);
  } catch {
    return encodeURIComponent(text.replace(/[\uD800-\uDFFF]/g, ""));
  }
}

const inviteLink = (code: string) => `${INVITE_LINK}${encoded(code)}`;

/** What a member with a usable code sends. The post names the week's points only when the season is known. */
function shareView(
  code: string,
  config: RewardsConfig | null,
  memberNumber: number | null,
): RewardsShareView {
  const { share } = rewardsCopy;
  const link = inviteLink(code);
  const rules = [INVITED_BOOST_PERCENT, INVITED_BOOST_WEEKS, INVITER_SCORE_SHARE_PERCENT] as const;
  const opening =
    memberNumber === null ? share.opening : share.openingAsMember(wholeNumber(memberNumber));
  const split = config ? share.xSplit(wholeNumber(config.weeklyPoints)) : "";
  const x = share.x(opening, split, ...rules);
  return {
    link,
    chat: share.chat(opening, link, ...rules),
    x,
    xUrl: `${X_POST}?text=${encoded(x)}&url=${encoded(link)}`,
    shareLabel: share.shareLabel,
    xLabel: share.xLabel,
    copied: share.copied,
  };
}

/**
 * Which member the person would be if they joined now, from how many there
 * were when the season was read. Null when the server does not say. It is
 * only ever true of this moment, which is why it says "now".
 */
function nextMemberLine(members: number | null): string | null {
  const { next } = rewardsCopy;
  if (members === null) return null;
  if (members <= 0) return next.first;
  // "1 member", "1,500 members": the noun by the rule every count goes through, the number grouped.
  const counted = plural(members, "member").replace(/^\d+/, wholeNumber(members));
  return next.after(counted, wholeNumber(members + 1));
}

/** Which member `state` is, formatted, or null when the server does not say. */
const memberNumberOf = (state: RewardsState): string | null =>
  state.memberNumber === null ? null : wholeNumber(state.memberNumber);

function inviteHeadline(invited: number): string {
  const { headline } = rewardsCopy.invite;
  if (invited <= 0) return headline.none;
  if (invited === 1) return headline.one;
  return invited === 2 ? headline.two : headline.many(wholeNumber(invited));
}

/**
 * The boost of a member who joined with an invite: how much of it is left,
 * or all of it stated when the server does not say. Nothing once it is
 * over, and nothing for a member who was not invited.
 */
function boostView(state: RewardsState): RewardsBoostView | null {
  const { boost } = rewardsCopy;
  if (!state.wasInvited) return null;
  if (state.boostWeeksLeft === null) {
    return { title: boost.title, detail: boost.whole(INVITED_BOOST_PERCENT, INVITED_BOOST_WEEKS) };
  }
  if (state.boostWeeksLeft < 1) return null;
  return {
    title: boost.title,
    detail: boost.left(INVITED_BOOST_PERCENT, plural(state.boostWeeksLeft, "week")),
  };
}

/**
 * What the invite code field says of `text`, as the person types or as it
 * arrived in a link. Text that could be a code, once trimmed and put in
 * capitals as it will be sent, is shown as in use. Any other text is said
 * not to look like one. No text says nothing. Whether the server takes the
 * code is only known once the joining is answered.
 */
export function rewardsInviteFieldView(text: string): RewardsInviteFieldView {
  const { inviteApplied, inviteShape } = rewardsCopy.join;
  const code = inviteCodeAsSent(text);
  if (code === undefined) return { applied: null, problem: null };
  if (!isInviteCode(code)) return { applied: null, problem: inviteShape(INVITE_CODE_LENGTH) };
  return {
    applied: {
      label: inviteApplied.label,
      code,
      detail: inviteApplied.detail(INVITED_BOOST_PERCENT, INVITED_BOOST_WEEKS),
    },
    problem: null,
  };
}

function standingView(state: RewardsState, config: RewardsConfig | null): RewardsStandingView {
  const { week, invite, member } = rewardsCopy;
  const endsAt = state.week ? Date.parse(state.week.endsAt) : Number.NaN;
  const number = memberNumberOf(state);
  return {
    member: number === null ? null : { label: member.label, value: member.value(number) },
    invite: {
      headline: state.codeActive ? inviteHeadline(state.invited) : invite.locked.title,
      ask: invite.ask(INVITER_SCORE_SHARE_PERCENT),
      share: state.codeActive ? shareView(state.code, config, state.memberNumber) : null,
      copy: state.codeActive
        ? {
            code: { label: invite.code, value: state.code },
            link: { label: invite.link, value: inviteLink(state.code) },
            copyCode: invite.copyCode,
            copyLink: invite.copyLink,
          }
        : null,
      locked: state.codeActive
        ? null
        : {
            title: invite.locked.title,
            detail: invite.locked.detail(INVITER_SCORE_SHARE_PERCENT),
            action: invite.locked.action,
          },
      invited: { label: invite.invited, value: wholeNumber(state.invited) },
    },
    boost: boostView(state),
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
    next: nextMemberLine(config.members),
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
  /** The invite code waiting on this device, as it arrived or was typed, for a wallet that has not joined. */
  inviteCode?: string;
}): RewardsView {
  const { title, nav, token, join } = rewardsCopy;
  if (!state.joined) {
    const field = rewardsInviteFieldView(state.inviteCode ?? "");
    return {
      title,
      nav,
      token,
      joined: false,
      // The pitch speaks of an invite only when one that could be used is waiting.
      pitch: state.config && pitchView(state.config, field.applied !== null),
      explanation: join.explanation,
      inviteCodeLabel: join.inviteCode,
      inviteApplied: field.applied,
      inviteProblem: field.problem,
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
  const next = nextMemberLine(config.members);
  if (invited) {
    return {
      title: promo.invited.title,
      detail: promo.invited.detail(INVITED_BOOST_PERCENT, INVITED_BOOST_WEEKS),
      action: promo.invited.action,
      early,
      next,
    };
  }
  return {
    title: promo.title,
    detail: promo.detail(wholeNumber(config.weeklyPoints)),
    action: promo.action,
    early,
    next,
  };
}

/**
 * The home screen's card for a wallet that has joined. With a code that can
 * be used it asks for an invite and carries what to send; before that it
 * says what unlocks the code and leads to a trade. Null while the member's
 * standing is not known. `config` only adds the week's points to the post.
 */
export function rewardsInviteCardView(
  rewards: RewardsState | null,
  config: RewardsConfig | null,
): RewardsInviteCardView | null {
  if (!rewards) return null;
  const { active, locked } = rewardsCopy.inviteCard;
  const number = memberNumberOf(rewards);
  const member = number === null ? null : rewardsCopy.member.line(number);
  if (!rewards.codeActive) {
    return {
      title: locked.title,
      detail: locked.detail(INVITER_SCORE_SHARE_PERCENT),
      action: locked.action,
      share: null,
      member,
    };
  }
  return {
    title: active.title,
    detail: active.detail(INVITER_SCORE_SHARE_PERCENT, INVITED_BOOST_PERCENT, INVITED_BOOST_WEEKS),
    action: active.action,
    share: shareView(rewards.code, config, rewards.memberNumber),
    member,
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
