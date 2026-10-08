import { describe, expect, it } from "vitest";
import { refused } from "../../../src/application/result.js";
import { dateAndTime } from "../../../src/domain/format.js";
import type { RewardsState } from "../../../src/domain/rewards.js";
import {
  rewardsJoinProblem,
  rewardsPromoView,
  rewardsView,
} from "../../../src/presentation/rewards.js";

const ENDS_AT = "2026-10-12T00:00:00.000Z";

const member = (over: Partial<RewardsState> = {}): RewardsState => ({
  code: "K7M2QX9P",
  codeActive: true,
  invited: 3,
  wasInvited: false,
  points: "12500",
  week: { index: 2, endsAt: ENDS_AT, feeMicroUsdc: "4250000", shareBps: 125 },
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
    expect(active.standing?.invite.share?.code.value).toBe("K7M2QX9P");
    expect(active.standing?.invite.share?.link.value).toBe(
      "https://app.noirwire.com/?ref=K7M2QX9P",
    );
    expect(active.standing?.invite.locked).toBeNull();

    expect(locked.standing?.invite.share).toBeNull();
    expect(locked.standing?.invite.locked).toMatch(/first trade/i);
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

describe("the way into Rewards on the home screen", () => {
  const config = (weeklyPoints: number) => ({
    seasonStart: "2026-10-19T00:00:00.000Z",
    seasonWeeks: 12,
    weeklyPoints,
  });

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
  it("names each copy button for what it copies, and asks before turning rewards off with the note as its body", () => {
    const view = rewardsView({ joined: true, rewards: member() });
    if (!view.joined) throw new Error("not shown as joined");
    const share = view.standing!.invite.share!;
    expect(share.copyCode).toMatch(/code/i);
    expect(share.copyLink).toMatch(/link/i);
    expect(share.copyCode).not.toBe(share.copyLink);
    const { confirm } = view.leave;
    expect(confirm.body).toBe(view.leave.note);
    expect(new Set([confirm.title, confirm.confirm, confirm.cancel]).size).toBe(3);
  });

  it("gives the join button another label while it is joining", () => {
    const view = rewardsView({ joined: false, rewards: null });
    if (view.joined) throw new Error("shown as joined");
    expect(view.joiningLabel).not.toBe(view.joinLabel);
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
