import { describe, expect, it } from "vitest";
import { refused } from "../../../src/application/result.js";
import { dateAndTime } from "../../../src/domain/format.js";
import {
  INVITED_BOOST_PERCENT,
  INVITED_BOOST_WEEKS,
  INVITER_SCORE_SHARE_PERCENT,
  INVITE_CODE_LENGTH,
  type RewardsConfig,
  type RewardsState,
} from "../../../src/domain/rewards.js";
import {
  rewardsEarlyLine,
  rewardsInviteCardView,
  rewardsInviteFieldView,
  rewardsInvitedBannerView,
  rewardsJoinProblem,
  rewardsPromoView,
  rewardsView as viewOf,
} from "../../../src/presentation/rewards.js";

type ViewState = Parameters<typeof viewOf>[0];

/** The screen with the season not known, unless a test says what it is. */
const rewardsView = (state: Omit<ViewState, "config"> & Partial<Pick<ViewState, "config">>) =>
  viewOf({ config: null, ...state });

const season = (
  weeklyPoints: number,
  seasonWeeks = 12,
  tradersThisWeek: number | null = null,
  members: number | null = null,
): RewardsConfig => ({
  seasonStart: "2026-10-19T00:00:00.000Z",
  seasonWeeks,
  weeklyPoints,
  tradersThisWeek,
  members,
  doubleHour: null,
});

const RULES = [
  `${INVITER_SCORE_SHARE_PERCENT}%`,
  `${INVITED_BOOST_PERCENT}%`,
  `${INVITED_BOOST_WEEKS} weeks`,
];

/** Words that would say an inviter is paid, which is not what the scoring does. */
const MONEY = /\bmoney\b|\bcash\b|cut of|\$|USDC|dollar/i;

const ENDS_AT = "2026-10-12T00:00:00.000Z";

const member = (over: Partial<RewardsState> = {}): RewardsState => ({
  code: "K7M2QX9P",
  codeActive: true,
  invited: 3,
  wasInvited: false,
  memberNumber: 42,
  boostWeeksLeft: 0,
  points: "12500",
  week: { index: 2, endsAt: ENDS_AT, feeMicroUsdc: "4250000", shareBps: 125, traders: 4 },
  ...over,
});

const TOKEN = "If NoirWire ever launches a token, points decide who gets it.";

/** Every string a view holds, however deep. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

describe("the Rewards screen", () => {
  it("shows a wallet that has not joined what joining means, and nothing of a member's", () => {
    const view = rewardsView({ joined: false, rewards: member() });
    if (view.joined) throw new Error("shown as joined");
    expect(view.explanation.length).toBeGreaterThanOrEqual(2);
    expect(view.explanation.length).toBeLessThanOrEqual(3);
    const said = view.explanation.join(" ");
    expect(said).toMatch(/optional/i);
    expect(said).toMatch(/does not keep/i);
    expect(said).toMatch(/separate key/i);
    expect(view).not.toHaveProperty("standing");
    expect(strings(view).join(" ")).not.toContain("K7M2QX9P");
  });

  it("shows a member their points, the week's fee in dollars, the estimated share and when the week ends", () => {
    const view = rewardsView({ joined: true, rewards: member() });
    if (!view.joined || !view.standing) throw new Error("no standing shown");
    expect(view.standing.points.value).toBe("12,500");
    expect(view.standing.week?.fee.value).toBe("$4.25");
    expect(view.standing.week?.share.value).toBe("1.25%");
    expect(view.standing.week?.share.label).toMatch(/estimate/i);
    expect(view.standing.week?.ends?.value).toBe(dateAndTime(Date.parse(ENDS_AT)));
    expect(view.standing.invite.invited.value).toBe("3");
    expect(view.notNow).toBeNull();
  });

  it("offers the invite code and its link only once the code can be used", () => {
    const active = rewardsView({ joined: true, rewards: member() });
    const locked = rewardsView({ joined: true, rewards: member({ codeActive: false }) });
    if (!active.joined || !locked.joined) throw new Error("not shown as joined");
    expect(active.standing?.invite.copy?.code.value).toBe("K7M2QX9P");
    expect(active.standing?.invite.copy?.link.value).toBe("https://app.noirwire.com/?ref=K7M2QX9P");
    expect(active.standing?.invite.share?.link).toBe("https://app.noirwire.com/?ref=K7M2QX9P");
    expect(active.standing?.invite.locked).toBeNull();

    expect(locked.standing?.invite.share).toBeNull();
    expect(locked.standing?.invite.copy).toBeNull();
    expect(locked.standing?.invite.locked).not.toBeNull();
    expect(strings(locked).join(" ")).not.toContain("K7M2QX9P");
  });

  it("shows no week when none is running, and no end it cannot read", () => {
    const none = rewardsView({ joined: true, rewards: member({ week: null }) });
    const unread = rewardsView({
      joined: true,
      rewards: member({ week: { ...member().week!, endsAt: "soon" } }),
    });
    if (!none.joined || !unread.joined) throw new Error("not shown as joined");
    expect(none.standing?.week).toBeNull();
    expect(unread.standing?.week?.ends).toBeNull();
    expect(unread.standing?.week?.fee.value).toBe("$4.25");
  });

  it("says a member's points cannot be shown only once reading them has ended without them", () => {
    const loading = rewardsView({ joined: true, rewards: null, loading: true });
    const failed = rewardsView({ joined: true, rewards: null });
    if (!loading.joined || !failed.joined) throw new Error("not shown as joined");
    expect(loading.standing).toBeNull();
    expect(loading.notNow).toBeNull();
    expect(failed.standing).toBeNull();
    expect(failed.notNow).not.toBeNull();
  });

  it("says one thing about a token, the same on both sides of joining, and promises no amount, date or value", () => {
    const views = [
      rewardsView({ joined: false, rewards: null }),
      rewardsView({ joined: false, rewards: null, config: season(100_000) }),
      rewardsView({ joined: true, rewards: member() }),
      rewardsView({ joined: true, rewards: null }),
    ];
    for (const view of views) {
      expect(view.token).toBe(TOKEN);
      const mentions = strings(view).filter((text) => /token|airdrop/i.test(text));
      expect(mentions).toEqual([TOKEN]);
    }
  });
});

describe("what there is to earn, said before joining", () => {
  it("opens the screen with the season's own points and weeks and the inviting rules, ahead of what joining means", () => {
    const view = rewardsView({ joined: false, rewards: null, config: season(250_000, 9) });
    if (view.joined || !view.pitch) throw new Error("no pitch shown");
    const said = view.pitch.lines.join(" ");
    expect(said).toContain("250,000 points");
    expect(said).toContain("9 weeks");
    expect(said).not.toContain("100,000");
    expect(said).not.toContain("12 weeks");
    expect(said).toContain(`${INVITER_SCORE_SHARE_PERCENT}%`);
    expect(said).toContain(`${INVITED_BOOST_PERCENT}%`);
    expect(said).toContain(`first ${INVITED_BOOST_WEEKS} weeks`);
    expect(view.pitch.title).toBe(rewardsPromoView(season(250_000, 9), false)?.title);
    expect(Object.keys(view).indexOf("pitch")).toBeLessThan(
      Object.keys(view).indexOf("explanation"),
    );
  });

  it("says nothing of it while the season is not known, and nothing to a member", () => {
    const unknown = rewardsView({ joined: false, rewards: null, config: null });
    if (unknown.joined) throw new Error("shown as joined");
    expect(unknown.pitch).toBeNull();
    expect(unknown.explanation.length).toBeGreaterThan(0);
    expect(
      rewardsView({ joined: true, rewards: member(), config: season(250_000) }),
    ).not.toHaveProperty("pitch");
  });
});

describe("the way into Rewards on the home screen", () => {
  const config = season;

  it("is shown only to a wallet that has not joined where rewards run, with the server's own number", () => {
    expect(rewardsPromoView(null, false)).toBeNull();
    expect(rewardsPromoView(config(100_000), true)).toBeNull();
    expect(rewardsPromoView(config(100_000), false)?.detail).toContain("100,000");
    const other = rewardsPromoView(config(250_000), false);
    expect(other?.detail).toContain("250,000");
    expect(other?.detail).not.toContain("100,000");
  });
});

describe("the words a screen needs beside the figures", () => {
  it("names each copy button for what it copies", () => {
    const view = rewardsView({ joined: true, rewards: member() });
    if (!view.joined) throw new Error("not shown as joined");
    const copy = view.standing!.invite.copy!;
    expect(copy.copyCode).toMatch(/code/i);
    expect(copy.copyLink).toMatch(/link/i);
    expect(copy.copyCode).not.toBe(copy.copyLink);
  });

  it("offers a member no way to turn rewards off, and says nothing of one", () => {
    for (const rewards of [member(), member({ codeActive: false }), null]) {
      const view = rewardsView({ joined: true, rewards, config: season(100_000) });
      expect(view).not.toHaveProperty("leave");
      for (const text of strings(view))
        expect(text, text).not.toMatch(/turn(s|ed|ing)? (it |rewards )?off/i);
    }
  });

  it("gives the join button another label while it is joining", () => {
    const view = rewardsView({ joined: false, rewards: null });
    if (view.joined) throw new Error("shown as joined");
    expect(view.joiningLabel).not.toBe(view.joinLabel);
  });
});

describe("how early it is this week", () => {
  it("says nothing when the count is not known", () => {
    expect(rewardsEarlyLine(null, 100_000)).toBeNull();
  });

  it("names the week's own points when no member has earned any yet, and promises them to nobody", () => {
    const line = rewardsEarlyLine(0, 250_000)!;
    expect(line).toContain("250,000");
    expect(line).not.toContain("100,000");
    expect(line).not.toMatch(/\btakes?\b|\bwins?\b|\bgets?\b|\bfirst\b|\byours\b/i);
  });

  it.each([
    [1, "1 member has", true],
    [2, "2 members have", true],
    [9, "9 members have", true],
    [10, "10 members have", false],
    [1_500, "1,500 members have", false],
  ])("says %i as a count of members, and as only that many under ten", (members, counted, only) => {
    const line = rewardsEarlyLine(members, 100_000)!;
    expect(line).toContain(counted);
    expect(/^only\b/i.test(line)).toBe(only);
    expect(line).not.toContain("100,000");
  });

  it("counts members who earned points in every band, and never everyone who traded", () => {
    for (const members of [0, 1, 5, 10, 400]) {
      const line = rewardsEarlyLine(members, 100_000)!;
      expect(line, line).toMatch(/\bmembers?\b/i);
      expect(line, line).not.toMatch(/\btraders?\b/i);
    }
  });
});

describe("a share link", () => {
  it("is built for any text at all without failing, and carries nothing that is not encoded", () => {
    const odd = ["", "a b&c=d#e", "\uD800", "ok\uDFFFok", "<script>", "é".repeat(40)];
    for (const code of odd) {
      const card = rewardsInviteCardView(member({ code }), season(100_000));
      const link = card!.share!.link;
      expect(link.startsWith("https://app.noirwire.com/?ref=")).toBe(true);
      expect(link.slice("https://app.noirwire.com/?ref=".length)).toMatch(
        /^[A-Za-z0-9%_.!~*'()-]*$/,
      );
      expect(new URL(card!.share!.xUrl).searchParams.get("url")).toBe(link);
    }
  });
});

describe("the early line, wherever it is shown", () => {
  it("is on the promo and the pitch from the season's count, and on a member's standing from the week's", () => {
    const config = season(100_000, 12, 3);
    const promo = rewardsPromoView(config, false)!;
    const notJoined = rewardsView({ joined: false, rewards: null, config });
    const joined = rewardsView({ joined: true, rewards: member(), config });
    if (notJoined.joined || !joined.joined) throw new Error("wrong side shown");
    expect(promo.early).toBe(rewardsEarlyLine(3, 100_000));
    expect(notJoined.pitch?.early).toBe(rewardsEarlyLine(3, 100_000));
    expect(joined.standing?.early).toBe(rewardsEarlyLine(4, 100_000));
    const pitch = Object.keys(notJoined.pitch!);
    expect(pitch.indexOf("early")).toBeLessThan(pitch.indexOf("lines"));
  });

  it("is left out for a server that does not count traders, and for a member outside a week", () => {
    const older = season(100_000);
    const notJoined = rewardsView({ joined: false, rewards: null, config: older });
    const uncounted = rewardsView({
      joined: true,
      rewards: member({ week: { ...member().week!, traders: null } }),
      config: older,
    });
    const noWeek = rewardsView({ joined: true, rewards: member({ week: null }), config: older });
    const noSeason = rewardsView({ joined: true, rewards: member() });
    if (notJoined.joined || !uncounted.joined || !noWeek.joined || !noSeason.joined) {
      throw new Error("wrong side shown");
    }
    expect(rewardsPromoView(older, false)?.early).toBeNull();
    expect(notJoined.pitch?.early).toBeNull();
    expect(notJoined.pitch?.lines.length).toBeGreaterThan(0);
    expect(uncounted.standing?.early).toBeNull();
    expect(noWeek.standing?.early).toBeNull();
    expect(noSeason.standing?.early).toBeNull();
  });
});

describe("the invite section of a member's screen", () => {
  it("comes right after which member this is, ahead of everything else", () => {
    const view = rewardsView({ joined: true, rewards: member() });
    if (!view.joined) throw new Error("not shown as joined");
    expect(Object.keys(view.standing!).slice(0, 2)).toEqual(["member", "invite"]);
  });

  it("asks by how many have joined: nobody, one, two, then the number", () => {
    const headline = (invited: number) => {
      const view = rewardsView({ joined: true, rewards: member({ invited }) });
      if (!view.joined) throw new Error("not shown as joined");
      return view.standing!.invite.headline;
    };
    const said = [0, 1, 2, 3, 1_200].map(headline);
    expect(new Set(said).size).toBe(5);
    expect(said[0]).not.toMatch(/joined/i);
    expect(said[1]).toMatch(/^one\b/i);
    expect(said[2]).toMatch(/^two\b/i);
    expect(said[3]).toMatch(/^3\b/);
    expect(said[4]).toMatch(/^1,200\b/);
  });

  it("says what inviting earns as a share of a trading score, by the scoring's own number", () => {
    const view = rewardsView({ joined: true, rewards: member() });
    if (!view.joined) throw new Error("not shown as joined");
    expect(view.standing!.invite.ask).toContain(`${INVITER_SCORE_SHARE_PERCENT}%`);
    expect(view.standing!.invite.ask).toMatch(/score/i);
  });
});

describe("what a member sends to bring someone in", () => {
  const shared = (config: RewardsConfig | null, code = "K7M2QX9P") => {
    const view = rewardsView({ joined: true, rewards: member({ code }), config });
    if (!view.joined) throw new Error("not shown as joined");
    return view.standing!.invite.share!;
  };

  it("puts the link in the chat message, and beside the post, not in it", () => {
    const share = shared(season(100_000));
    expect(share.chat).toContain(share.link);
    expect(share.x).not.toContain("http");
    const url = new URL(share.xUrl);
    expect(`${url.origin}${url.pathname}`).toBe("https://x.com/intent/post");
    expect(url.searchParams.get("text")).toBe(share.x);
    expect(url.searchParams.get("url")).toBe(share.link);
    expect(share.xUrl).toContain(encodeURIComponent(share.x));
    expect(share.xUrl).toContain(encodeURIComponent(share.link));
  });

  it("fits a post with its link, even with the largest week a season could name", () => {
    // X counts any link as 23 characters, and one space sits between it and the text.
    for (const config of [null, season(100_000), season(999_999_999)]) {
      expect(shared(config).x.length + 1 + 23).toBeLessThanOrEqual(280);
    }
  });

  it("states the scoring's rules and the season's own points, and leaves the points out when the season is not known", () => {
    const known = shared(season(250_000));
    const unknown = shared(null);
    for (const rule of RULES) {
      expect(known.chat).toContain(rule);
      expect(known.x).toContain(rule);
      expect(unknown.x).toContain(rule);
    }
    expect(known.x).toContain("250,000");
    expect(unknown.x).not.toMatch(/\d{3},\d{3}/);
    expect(unknown.x.length).toBeLessThan(known.x.length);
  });

  it("has a label for each way of sending it, and a word for once it is copied", () => {
    const { shareLabel, xLabel, copied } = shared(null);
    expect(new Set([shareLabel, xLabel, copied]).size).toBe(3);
    expect(xLabel).toMatch(/\bX\b/);
  });
});

describe("the home card of a wallet that has joined", () => {
  it("is not shown while the member's standing is not known", () => {
    expect(rewardsInviteCardView(null, season(100_000))).toBeNull();
  });

  it("asks for an invite and carries what to send once the code can be used", () => {
    const card = rewardsInviteCardView(member(), season(100_000))!;
    const onScreen = rewardsView({ joined: true, rewards: member(), config: season(100_000) });
    if (!onScreen.joined) throw new Error("not shown as joined");
    expect(card.share).toEqual(onScreen.standing!.invite.share);
    for (const rule of RULES) expect(card.detail).toContain(rule);
    expect(card.action).toBe(card.share!.shareLabel);
  });

  it("says what unlocks the invite, and leads to a trade, while the code is locked", () => {
    const locked = rewardsInviteCardView(member({ codeActive: false }), season(100_000))!;
    const active = rewardsInviteCardView(member(), season(100_000))!;
    const onScreen = rewardsView({ joined: true, rewards: member({ codeActive: false }) });
    if (!onScreen.joined) throw new Error("not shown as joined");
    expect(locked.share).toBeNull();
    expect(locked.detail).toContain(`${INVITER_SCORE_SHARE_PERCENT}%`);
    expect(locked.detail).toMatch(/first trade/i);
    expect(locked.title).toMatch(/trade/i);
    expect(locked.title).not.toBe(active.title);
    expect(locked.action).not.toBe(active.action);
    // The same way out as on the Rewards screen: to where there is something to trade.
    expect(locked.action).toBe(onScreen.standing!.invite.locked!.action);
    expect(strings(locked).join(" ")).not.toContain("K7M2QX9P");
  });
});

describe("a wallet with an invite waiting on this device", () => {
  it("is told on the home card what joining with it brings, and is still not shown the card once joined", () => {
    const config = season(100_000, 12, 3);
    const plain = rewardsPromoView(config, false)!;
    const invited = rewardsPromoView(config, false, true)!;
    expect(invited.title).not.toBe(plain.title);
    expect(invited.action).not.toBe(plain.action);
    expect(invited.detail).toContain(`${INVITED_BOOST_PERCENT}%`);
    expect(invited.detail).toContain(`${INVITED_BOOST_WEEKS} weeks`);
    expect(invited.early).toBe(plain.early);
    expect(rewardsPromoView(config, false, false)).toEqual(plain);
    expect(rewardsPromoView(config, true, true)).toBeNull();
    expect(rewardsPromoView(null, false, true)).toBeNull();
  });

  it("reads its boost first in the pitch, ahead of the lines everyone reads", () => {
    const config = season(100_000);
    const plain = rewardsView({ joined: false, rewards: null, config });
    const invited = rewardsView({ joined: false, rewards: null, config, inviteCode: "K7M2QX9P" });
    const mistyped = rewardsView({ joined: false, rewards: null, config, inviteCode: "hello" });
    if (plain.joined || invited.joined || mistyped.joined) throw new Error("shown as joined");
    const [first, ...rest] = invited.pitch!.lines;
    expect(rest).toEqual(plain.pitch!.lines);
    // Text that no code could be promises no boost.
    expect(mistyped.pitch!.lines).toEqual(plain.pitch!.lines);
    expect(first).toContain(`${INVITED_BOOST_PERCENT}%`);
    expect(first).toContain(`${INVITED_BOOST_WEEKS} weeks`);
  });

  it("sees a banner where a wallet is made, with the boost and that joining is optional, and none without an invite", () => {
    expect(rewardsInvitedBannerView(false)).toBeNull();
    const banner = rewardsInvitedBannerView(true)!;
    expect(banner.title).not.toBe(banner.detail);
    expect(banner.detail).toContain(`${INVITED_BOOST_PERCENT}%`);
    expect(banner.detail).toContain(`${INVITED_BOOST_WEEKS} weeks`);
    expect(banner.detail).toMatch(/optional/i);
  });
});

describe("an invite link that unlocks after the first trade", () => {
  const invite = (over: Partial<RewardsState>) => {
    const view = rewardsView({ joined: true, rewards: member(over), config: season(100_000) });
    if (!view.joined) throw new Error("not shown as joined");
    return view.standing!.invite;
  };

  it("is said in the pitch to follow the first trade, with what inviting earns by the scoring's own numbers", () => {
    const view = rewardsView({ joined: false, rewards: null, config: season(100_000) });
    if (view.joined) throw new Error("shown as joined");
    const lines = view.pitch!.lines.filter((text) => /invite/i.test(text));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/first trade/i);
    for (const rule of RULES) expect(lines[0]).toContain(rule);
  });

  it("gives a member who has not traded the locked block: what unlocks it, what it earns and where to go", () => {
    const { locked, headline, ask, share, copy } = invite({ codeActive: false, invited: 0 });
    expect(share).toBeNull();
    expect(copy).toBeNull();
    expect(locked!.title).toMatch(/first trade/i);
    expect(locked!.detail).toContain(`${INVITER_SCORE_SHARE_PERCENT}%`);
    expect(locked!.detail).toMatch(/score/i);
    expect(locked!.action).toMatch(/trade/i);
    expect(new Set([locked!.title, locked!.detail, locked!.action]).size).toBe(3);
    // The section is headed by what unlocks it, not by an ask that cannot be acted on yet.
    expect(headline).toBe(locked!.title);
    expect(ask).toContain(`${INVITER_SCORE_SHARE_PERCENT}%`);
  });

  it("gives a member whose code is active no locked block, and a headline that asks", () => {
    const active = invite({ codeActive: true, invited: 0 });
    const waiting = invite({ codeActive: false, invited: 0 });
    expect(active.locked).toBeNull();
    expect(active.share).not.toBeNull();
    expect(active.headline).not.toBe(waiting.headline);
    for (const text of strings(active)) expect(text, text).not.toMatch(/unlock/i);
  });
});

describe("the invite code field", () => {
  it("shows a code that could be one as in use, as it will be sent, with what it brings", () => {
    for (const typed of ["K7M2QX9P", "  k7m2qx9p "]) {
      const { applied, problem } = rewardsInviteFieldView(typed);
      expect(problem).toBeNull();
      expect(applied?.code).toBe("K7M2QX9P");
      expect(applied?.detail).toContain(`${INVITED_BOOST_PERCENT}%`);
      expect(applied?.detail).toContain(`${INVITED_BOOST_WEEKS} weeks`);
      expect(applied?.label.length).toBeGreaterThan(0);
    }
  });

  it.each(["K7M2", "K7M2QX9PP", "K7M2QX1P", "hello there", "<b>"])(
    "says %j does not look like a code, with how long one is, and applies nothing",
    (typed) => {
      const { applied, problem } = rewardsInviteFieldView(typed);
      expect(applied).toBeNull();
      expect(problem).toContain(String(INVITE_CODE_LENGTH));
      expect(problem).not.toContain(typed);
    },
  );

  it.each(["", "   ", "\n"])("says nothing of no text: %j", (typed) => {
    expect(rewardsInviteFieldView(typed)).toEqual({ applied: null, problem: null });
  });

  it("is what the screen shows for the code waiting on this device, and nothing for none", () => {
    const view = (inviteCode?: string) => {
      const shown = rewardsView({ joined: false, rewards: null, inviteCode });
      if (shown.joined) throw new Error("shown as joined");
      return { applied: shown.inviteApplied, problem: shown.inviteProblem };
    };
    expect(view("k7m2qx9p")).toEqual(rewardsInviteFieldView("k7m2qx9p"));
    expect(view("nope")).toEqual(rewardsInviteFieldView("nope"));
    expect(view()).toEqual({ applied: null, problem: null });
    expect(
      rewardsView({ joined: true, rewards: member(), inviteCode: "K7M2QX9P" }),
    ).not.toHaveProperty("inviteApplied");
  });
});

describe("the boost of a member who joined with an invite", () => {
  const boost = (over: Partial<RewardsState>) => {
    const view = rewardsView({ joined: true, rewards: member(over) });
    if (!view.joined) throw new Error("not shown as joined");
    return view.standing!.boost;
  };

  it("says how many weeks are left, and one week as one", () => {
    const eight = boost({ wasInvited: true, boostWeeksLeft: 8 })!;
    const one = boost({ wasInvited: true, boostWeeksLeft: 1 })!;
    expect(eight.detail).toContain(`${INVITED_BOOST_PERCENT}%`);
    expect(eight.detail).toContain("8 weeks");
    expect(one.detail).toContain("1 week ");
    expect(one.detail).not.toContain("1 weeks");
    expect(one.title).toBe(eight.title);
  });

  it("states the whole boost when the server does not say what is left", () => {
    const whole = boost({ wasInvited: true, boostWeeksLeft: null })!;
    expect(whole.detail).toContain(`${INVITED_BOOST_PERCENT}%`);
    expect(whole.detail).toContain(`${INVITED_BOOST_WEEKS} weeks`);
    expect(whole.detail).not.toMatch(/left/i);
  });

  it("is not shown once the boost is over, or to a member who was not invited", () => {
    expect(boost({ wasInvited: true, boostWeeksLeft: 0 })).toBeNull();
    expect(boost({ wasInvited: false, boostWeeksLeft: 0 })).toBeNull();
    expect(boost({ wasInvited: false, boostWeeksLeft: null })).toBeNull();
    expect(boost({ wasInvited: false, boostWeeksLeft: 5 })).toBeNull();
  });

  it("sits directly after the invite section", () => {
    const view = rewardsView({ joined: true, rewards: member() });
    if (!view.joined) throw new Error("not shown as joined");
    const order = Object.keys(view.standing!);
    expect(order.indexOf("boost")).toBe(order.indexOf("invite") + 1);
  });
});

describe("which member someone is", () => {
  const standing = (over: Partial<RewardsState>) => {
    const view = rewardsView({ joined: true, rewards: member(over) });
    if (!view.joined) throw new Error("not shown as joined");
    return view.standing!;
  };

  it("is the first thing a member sees, with the number grouped, and on the home card as one line", () => {
    const shown = standing({ memberNumber: 1_234 });
    expect(Object.keys(shown)[0]).toBe("member");
    expect(shown.member?.value).toBe("#1,234");
    expect(shown.member?.label.length).toBeGreaterThan(0);
    for (const codeActive of [true, false]) {
      const card = rewardsInviteCardView(member({ memberNumber: 1_234, codeActive }), null);
      expect(card?.member).toContain("#1,234");
    }
  });

  it("is left out for a server that does not number its members", () => {
    expect(standing({ memberNumber: null }).member).toBeNull();
    expect(rewardsInviteCardView(member({ memberNumber: null }), null)?.member).toBeNull();
    expect(
      rewardsInviteCardView(member({ memberNumber: null, codeActive: false }), null)?.member,
    ).toBeNull();
  });

  it("opens what the member sends with the number, and without it when it is not known", () => {
    const numbered = standing({ memberNumber: 1_234 }).invite.share!;
    const plain = standing({ memberNumber: null }).invite.share!;
    for (const text of [numbered.chat, numbered.x]) expect(text).toMatch(/^I am member #1,234\b/);
    for (const text of [plain.chat, plain.x]) {
      expect(text).not.toContain("#");
      expect(text).not.toMatch(/\bmember\b/i);
    }
    expect(numbered.chat).toContain(numbered.link);
    expect(numbered.link).toBe(plain.link);
    expect(new URL(numbered.xUrl).searchParams.get("text")).toBe(numbered.x);
  });

  it("still fits a post with its link at a seven digit number and the largest week", () => {
    const card = rewardsInviteCardView(member({ memberNumber: 9_999_999 }), season(999_999_999));
    const { x } = card!.share!;
    expect(x).toContain("9,999,999");
    expect(x).toContain("999,999,999");
    expect(x.length + 1 + 23).toBeLessThanOrEqual(280);
  });
});

describe("which member someone would be, joining now", () => {
  const next = (members: number | null) =>
    rewardsPromoView(season(100_000, 12, null, members), false)?.next ?? null;

  it("is not said when the server does not say how many members there are", () => {
    expect(next(null)).toBeNull();
    const view = rewardsView({ joined: false, rewards: null, config: season(100_000) });
    if (view.joined) throw new Error("shown as joined");
    expect(view.pitch?.next).toBeNull();
  });

  it.each([
    [0, "#1", null],
    [1, "#2", "1 member "],
    [1_500, "#1,501", "1,500 members "],
  ])("with %i members is %s, and only as of now", (members, number, counted) => {
    const line = next(members)!;
    expect(line.endsWith(`${number}.`)).toBe(true);
    expect(line).toMatch(/\bnow\b/i);
    if (counted === null) expect(line).not.toMatch(/so far/i);
    else expect(line).toContain(counted);
    expect(line).not.toContain("1 members");
  });

  it("is the same line on the promo, invited or not, and in the pitch", () => {
    const config = season(100_000, 12, 3, 77);
    const view = rewardsView({ joined: false, rewards: null, config });
    if (view.joined) throw new Error("shown as joined");
    const line = rewardsPromoView(config, false)?.next;
    expect(line).toContain("#78");
    expect(rewardsPromoView(config, false, true)?.next).toBe(line);
    expect(view.pitch?.next).toBe(line);
  });
});

describe("what inviting is said to earn", () => {
  it("is a share of a trading score everywhere, and never money", () => {
    const config = season(100_000, 12, 3);
    const said = strings([
      rewardsPromoView(config, false, true),
      rewardsInviteCardView(member(), config),
      rewardsInviteCardView(member({ codeActive: false }), config),
      rewardsInvitedBannerView(true),
      rewardsView({ joined: false, rewards: null, config, inviteCode: "K7M2QX9P" }),
    ]);
    const member0 = rewardsView({ joined: true, rewards: member(), config });
    if (!member0.joined) throw new Error("not shown as joined");
    said.push(...strings(member0.standing!.invite));
    for (const text of said) expect(text, text).not.toMatch(MONEY);
  });
});

describe("a joining that did not go through", () => {
  it("has its own words for each way it can end, and none for one that worked", () => {
    expect(rewardsJoinProblem({ kind: "joined", state: member() })).toBeNull();
    const said = [
      rewardsJoinProblem({ kind: "inviteNotValid" }),
      rewardsJoinProblem({ kind: "failed" }),
      rewardsJoinProblem(refused("walletLocked")),
    ];
    expect(said.every((text) => typeof text === "string" && text.length > 0)).toBe(true);
    expect(new Set(said).size).toBe(3);
    expect(said[0]).toMatch(/invite code/i);
  });
});
