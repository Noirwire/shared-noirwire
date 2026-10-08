import { describe, expect, it } from "vitest";
import {
  claimQueuedTrades,
  claimTrade,
  joinRewards,
  leaveRewardsOnThisDevice,
  rewardsState,
  type RewardsDeps,
} from "../../../src/application/actions/rewards.js";
import type { RewardsApi, RewardsClaim, RewardsJoin } from "../../../src/application/ports.js";
import { MAX_QUEUED_CLAIMS, type RewardsState } from "../../../src/domain/rewards.js";
import type { Wallet } from "../../../src/domain/wallet.js";
import {
  harness,
  OTHER_ADDRESS,
  OWN_ADDRESS,
  wallet,
  type FakeSigner,
} from "../support/actions.js";

const STATE: RewardsState = {
  code: "K7M2QX9P",
  codeActive: false,
  invited: 0,
  wasInvited: true,
  points: "0",
  week: { index: 0, endsAt: "2026-10-12T00:00:00.000Z", feeMicroUsdc: "0", shareBps: 0 },
};

/** The harness's member key, and the portfolio with derivation index 1. */
const MEMBER = "Rewards111";

const credited: RewardsClaim = { kind: "credited", feeMicroUsdc: "120000", state: STATE };

/** The server's rewards in memory: what it was asked, in order, and what it answers each claim. */
function fakeRewards() {
  const server = {
    asked: [] as string[],
    joins: [] as { member: string; inviteCode: string | undefined }[],
    claims: [] as { member: string; portfolio: string; transaction: string }[],
    joining: { kind: "joined", state: STATE } as RewardsJoin,
    unreachable: false,
    /** What a claim of each trade is answered with. One not named is credited. */
    answers: {} as Record<string, RewardsClaim | "unreachable">,
  };
  const reached = (route: string) => {
    server.asked.push(route);
    if (server.unreachable) throw new Error("fetch failed");
  };
  const api: RewardsApi<FakeSigner> = {
    async config() {
      reached("config");
      return { seasonStart: "2026-09-28T00:00:00.000Z", seasonWeeks: 12, weeklyPoints: 100_000 };
    },
    async join(member, inviteCode) {
      reached("join");
      server.joins.push({ member: member.address, inviteCode });
      return server.joining;
    },
    async state() {
      reached("state");
      return STATE;
    },
    async claim({ member, portfolio, transaction }) {
      reached("claim");
      server.claims.push({ member: member.address, portfolio: portfolio.address, transaction });
      const answer = server.answers[transaction] ?? credited;
      if (answer === "unreachable") throw new Error("fetch failed");
      return answer;
    },
  };
  return Object.assign(server, { api });
}

function rewards(initial: Wallet = wallet()) {
  const h = harness(initial);
  const server = fakeRewards();
  const deps: RewardsDeps<FakeSigner> = {
    session: h.deps.session,
    store: h.store,
    api: server.api,
  };
  return {
    h,
    server,
    deps,
    waiting: () => h.wallet().rewardClaims?.map((claim) => claim.signature) ?? [],
  };
}

const joined = (over: Partial<Wallet> = {}) => rewards(wallet({ rewardsJoined: true, ...over }));
const p1 = { derivationIndex: 1 };

describe("a wallet that has not joined rewards", () => {
  it("asks the server nothing: not for its standing, not for a trade, not for what waits", async () => {
    const r = rewards(wallet({ rewardClaims: [{ signature: "stray", derivationIndex: 1 }] }));
    expect(await rewardsState(r.deps)).toBeNull();
    await claimTrade(r.deps, "trade-1", p1);
    await claimQueuedTrades(r.deps);
    expect(r.server.asked).toEqual([]);
    expect(r.waiting()).toEqual(["stray"]);
  });
});

describe("joining rewards", () => {
  it("joins as the member's own key, and only then keeps that it joined", async () => {
    const r = rewards();
    expect(await joinRewards(r.deps, "  k7m2qx9p ")).toEqual({ kind: "joined", state: STATE });
    expect(r.server.joins).toEqual([{ member: MEMBER, inviteCode: "K7M2QX9P" }]);
    expect(r.h.wallet().rewardsJoined).toBe(true);
  });

  it("sends no invite code when none was typed", async () => {
    const r = rewards();
    await joinRewards(r.deps, "   ");
    expect(r.server.joins[0].inviteCode).toBeUndefined();
  });

  it("stays off when the invite code is not valid, and when the server cannot be asked", async () => {
    const r = rewards();
    r.server.joining = { kind: "inviteNotValid" };
    expect(await joinRewards(r.deps, "NOPE2345")).toEqual({ kind: "inviteNotValid" });
    r.server.unreachable = true;
    expect(await joinRewards(r.deps)).toEqual({ kind: "failed" });
    expect(r.h.wallet()).not.toHaveProperty("rewardsJoined");
  });

  it("is refused while the wallet is locked, and asks nothing", async () => {
    const r = rewards();
    r.h.lock();
    expect(await joinRewards(r.deps)).toMatchObject({ kind: "refused", reason: "walletLocked" });
    expect(r.server.asked).toEqual([]);
  });
});

describe("a member's standing", () => {
  it("is read for a wallet that joined, and is null when it cannot be", async () => {
    const r = joined();
    expect(await rewardsState(r.deps)).toEqual(STATE);
    r.server.unreachable = true;
    expect(await rewardsState(r.deps)).toBeNull();
    r.h.lock();
    expect(await rewardsState(r.deps)).toBeNull();
    expect(r.server.asked).toEqual(["state", "state"]);
  });
});

describe("claiming a trade", () => {
  it("signs as the member and as the portfolio that traded, and stops waiting once credited", async () => {
    const r = joined();
    await claimTrade(r.deps, "trade-1", p1);
    expect(r.server.claims).toEqual([
      { member: MEMBER, portfolio: OWN_ADDRESS, transaction: "trade-1" },
    ]);
    expect(r.h.wallet()).not.toHaveProperty("rewardClaims");
  });

  it("claims as the portfolio the trade was made from, by its derivation index", async () => {
    const r = joined();
    await claimTrade(r.deps, "trade-2", { derivationIndex: 2 });
    expect(r.server.claims[0].portfolio).toBe(OTHER_ADDRESS);
  });

  it.each(["notFinalized", "unreachable"] as const)(
    "keeps the trade waiting when the answer is %s",
    async (answer) => {
      const r = joined();
      r.server.answers["trade-1"] = answer === "unreachable" ? answer : { kind: answer };
      await claimTrade(r.deps, "trade-1", p1);
      expect(r.h.wallet().rewardClaims).toEqual([{ signature: "trade-1", derivationIndex: 1 }]);
    },
  );

  it.each<RewardsClaim>([
    { kind: "alreadyClaimed" },
    { kind: "notMember" },
    { kind: "refused", code: "no_fee_paid" },
  ])("stops waiting on an answer that is final: $kind", async (answer) => {
    const r = joined();
    r.server.answers["trade-1"] = answer;
    await claimTrade(r.deps, "trade-1", p1);
    expect(r.waiting()).toEqual([]);
  });

  it("drops a trade whose portfolio the wallet does not have, without asking", async () => {
    const r = joined();
    await claimTrade(r.deps, "trade-1", { derivationIndex: 9 });
    expect(r.server.asked).toEqual([]);
    expect(r.waiting()).toEqual([]);
  });

  it("keeps the trade and asks nothing when the wallet locks first", async () => {
    const r = joined({ rewardClaims: [{ signature: "trade-1", derivationIndex: 1 }] });
    r.h.lock();
    await claimTrade(r.deps, "trade-1", p1);
    await claimQueuedTrades(r.deps);
    expect(r.server.asked).toEqual([]);
    expect(r.waiting()).toEqual(["trade-1"]);
  });

  it("never keeps more than the limit waiting: the oldest goes", async () => {
    const r = joined();
    const count = MAX_QUEUED_CLAIMS + 2;
    for (let n = 1; n <= count; n += 1) {
      r.server.answers[`trade-${n}`] = { kind: "notFinalized" };
      await claimTrade(r.deps, `trade-${n}`, p1);
    }
    expect(r.waiting()).toHaveLength(MAX_QUEUED_CLAIMS);
    expect(r.waiting()[0]).toBe("trade-3");
    expect(r.waiting().at(-1)).toBe(`trade-${count}`);
  });

  it("does not put the same trade in line twice", async () => {
    const r = joined();
    r.server.answers["trade-1"] = { kind: "notFinalized" };
    await claimTrade(r.deps, "trade-1", p1);
    await claimTrade(r.deps, "trade-1", p1);
    expect(r.waiting()).toEqual(["trade-1"]);
  });
});

describe("claiming what waits", () => {
  const three = () =>
    joined({
      rewardClaims: ["trade-1", "trade-2", "trade-3"].map((signature) => ({
        signature,
        derivationIndex: 1,
      })),
    });

  it("tries each one, oldest first, and leaves only the ones that are not final yet", async () => {
    const r = three();
    r.server.answers["trade-2"] = { kind: "notFinalized" };
    await claimQueuedTrades(r.deps);
    expect(r.server.claims.map((claim) => claim.transaction)).toEqual([
      "trade-1",
      "trade-2",
      "trade-3",
    ]);
    expect(r.waiting()).toEqual(["trade-2"]);
  });

  it("stops at the first one that gets no answer, and keeps it and the rest", async () => {
    const r = three();
    r.server.answers["trade-2"] = "unreachable";
    await claimQueuedTrades(r.deps);
    expect(r.server.claims).toHaveLength(2);
    expect(r.waiting()).toEqual(["trade-2", "trade-3"]);
  });
});

describe("turning rewards off on this device", () => {
  it("forgets the joining and what waited, and asks the server nothing then or after", async () => {
    const r = joined({ rewardClaims: [{ signature: "trade-1", derivationIndex: 1 }] });
    await leaveRewardsOnThisDevice(r.deps);
    expect(r.h.wallet()).not.toHaveProperty("rewardsJoined");
    expect(r.h.wallet()).not.toHaveProperty("rewardClaims");
    await claimTrade(r.deps, "trade-2", p1);
    await claimQueuedTrades(r.deps);
    expect(await rewardsState(r.deps)).toBeNull();
    expect(r.server.asked).toEqual([]);
  });
});
