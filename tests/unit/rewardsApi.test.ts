import { createPublicKey, verify } from "node:crypto";
import { Keypair, PublicKey } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inviteCodeAsSent, isInviteCode } from "../../src/domain/rewards.js";
import { rewardsApi } from "../../src/infrastructure/solana/rewards.js";
import {
  fakeApi,
  installTestPlatform,
  type ApiCall,
  type ApiHandler,
  type FakeApi,
} from "../../src/testing/index.js";

/**
 * The rewards client against a stand-in for the server's four rewards
 * routes, which checks what a real one would: each signature, by Node's own
 * ed25519, over the message written out here and not taken from the client.
 */

const NOW_SECONDS = 1_790_000_000;
const TRADE = "5TradeSignature111";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function fromBase58(text: string): Uint8Array {
  let value = 0n;
  for (const character of text) value = value * 58n + BigInt(BASE58.indexOf(character));
  const bytes: number[] = [];
  for (; value > 0n; value >>= 8n) bytes.unshift(Number(value & 0xffn));
  for (let i = 0; text[i] === "1"; i += 1) bytes.unshift(0);
  return Uint8Array.from(bytes);
}

/** Whether `signature` (base58) is `signer`'s (base58) over `message`, as UTF-8. */
function signedBy(signer: string, message: string, signature: string): boolean {
  const key = createPublicKey({
    key: Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      new PublicKey(signer).toBuffer(),
    ]),
    format: "der",
    type: "spki",
  });
  return verify(null, new TextEncoder().encode(message), key, fromBase58(signature));
}

const STATE = {
  code: "K7M2QX9P",
  codeActive: true,
  invited: 3,
  wasInvited: false,
  memberNumber: 42,
  boostWeeksLeft: 0,
  points: "1250",
  week: {
    index: 2,
    endsAt: "2026-10-12T00:00:00.000Z",
    feeMicroUsdc: "480000",
    shareBps: 125,
    traders: 7,
  },
};

const DOUBLE_HOUR = { startsAt: "2026-10-09T18:00:00.000Z", endsAt: "2026-10-09T19:00:00.000Z" };

const refusal = (code: string, status: number) =>
  new Response(JSON.stringify({ code, error: "A sentence nobody here reads." }), { status });

const body = (call: ApiCall) => call.json as Record<string, string>;

/** The server's side of the contract: a request whose signature does not hold is turned down as unauthorized. */
function server(over: Record<string, ApiHandler> = {}) {
  // A joining signs one line more than a read: the invite code as sent, or nothing on it.
  const stamped = (action: string, call: ApiCall) => {
    const { rewardsKey, at, signature, inviteCode } = body(call);
    const last = action === "join" ? `\n${inviteCode ?? ""}` : "";
    return signedBy(
      rewardsKey,
      `NoirWire rewards v1\n${action}\n${rewardsKey}\n${at}${last}`,
      signature,
    );
  };
  return fakeApi({
    "GET /v1/rewards/config": () => ({
      enabled: true,
      seasonStart: "2026-09-28T00:00:00.000Z",
      seasonWeeks: 12,
      weeklyPoints: 100_000,
      tradersThisWeek: 5,
      members: 120,
      doubleHour: DOUBLE_HOUR,
    }),
    "POST /v1/rewards/join": (call) =>
      stamped("join", call) ? STATE : refusal("unauthorized", 401),
    "POST /v1/rewards/state": (call) =>
      stamped("state", call) ? STATE : refusal("unauthorized", 401),
    "POST /v1/rewards/claims": (call) => {
      const { rewardsKey, transaction, portfolio, portfolioSignature, rewardsSignature } =
        body(call);
      const message = `NoirWire rewards v1\nclaim\n${rewardsKey}\n${transaction}`;
      return signedBy(rewardsKey, message, rewardsSignature) &&
        signedBy(portfolio, message, portfolioSignature)
        ? { credited: true, feeMicroUsdc: "120000", state: STATE }
        : refusal("unauthorized", 401);
    },
    ...over,
  });
}

const unlocked = () => true;

let api: FakeApi | undefined;
const serve = (over?: Record<string, ApiHandler>) => (api = server(over));

beforeEach(() => {
  installTestPlatform();
  vi.useFakeTimers({ toFake: ["Date"], now: NOW_SECONDS * 1000 + 999 });
});

afterEach(() => {
  vi.useRealTimers();
  api?.restore();
  api = undefined;
});

describe("the rewards settings", () => {
  it("are asked for without a key or a body, and say off unless the server says on", async () => {
    serve();
    expect(await rewardsApi.config()).toEqual({
      seasonStart: "2026-09-28T00:00:00.000Z",
      seasonWeeks: 12,
      weeklyPoints: 100_000,
      tradersThisWeek: 5,
      members: 120,
      doubleHour: DOUBLE_HOUR,
    });
    expect(api!.calls).toHaveLength(1);
    expect(api!.calls[0].body).toBeNull();
    expect(api!.calls[0].url.search).toBe("");
    api!.restore();

    for (const config of [
      { enabled: false, seasonStart: null, seasonWeeks: null, weeklyPoints: null },
      { enabled: "true", seasonStart: "2026-09-28T00:00:00.000Z", seasonWeeks: 12 },
    ]) {
      serve({ "GET /v1/rewards/config": () => config });
      expect(await rewardsApi.config(), JSON.stringify(config)).toBeNull();
      api!.restore();
    }
  });

  it("read a server that does not count traders, or counts them as something else, as not saying", async () => {
    const season = { enabled: true, seasonStart: "2026-09-28T00:00:00.000Z", seasonWeeks: 12 };
    for (const count of [{}, { tradersThisWeek: null }, { tradersThisWeek: "5" }]) {
      serve({ "GET /v1/rewards/config": () => ({ ...season, weeklyPoints: 100_000, ...count }) });
      expect((await rewardsApi.config())?.tradersThisWeek, JSON.stringify(count)).toBeNull();
      api!.restore();
    }
    for (const members of [{}, { members: null }, { members: "120" }]) {
      serve({ "GET /v1/rewards/config": () => ({ ...season, weeklyPoints: 100_000, ...members }) });
      expect((await rewardsApi.config())?.members, JSON.stringify(members)).toBeNull();
      api!.restore();
    }
    for (const doubleHour of [
      undefined,
      null,
      "soon",
      { startsAt: DOUBLE_HOUR.startsAt },
      { startsAt: 1, endsAt: 2 },
    ]) {
      serve({
        "GET /v1/rewards/config": () => ({ ...season, weeklyPoints: 100_000, doubleHour }),
      });
      expect((await rewardsApi.config())?.doubleHour, JSON.stringify(doubleHour)).toBeNull();
      api!.restore();
    }
    for (const number of [{ memberNumber: undefined }, { memberNumber: "42" }]) {
      serve({ "POST /v1/rewards/state": () => ({ ...STATE, ...number }) });
      const state = await rewardsApi.state(Keypair.generate(), unlocked);
      expect(state?.memberNumber, JSON.stringify(number)).toBeNull();
      api!.restore();
    }
    for (const boost of [{ boostWeeksLeft: undefined }, { boostWeeksLeft: "3" }]) {
      serve({ "POST /v1/rewards/state": () => ({ ...STATE, ...boost }) });
      const state = await rewardsApi.state(Keypair.generate(), unlocked);
      expect(state?.boostWeeksLeft, JSON.stringify(boost)).toBeNull();
      api!.restore();
    }
    const { index, endsAt, feeMicroUsdc, shareBps } = STATE.week;
    const olderWeek = { index, endsAt, feeMicroUsdc, shareBps };
    for (const week of [olderWeek, { ...olderWeek, traders: "7" }]) {
      serve({ "POST /v1/rewards/state": () => ({ ...STATE, week }) });
      const state = await rewardsApi.state(Keypair.generate(), unlocked);
      expect(state?.week, JSON.stringify(week)).toEqual({ ...olderWeek, traders: null });
      api!.restore();
    }
  });
});

describe("joining rewards", () => {
  it("signs for the member at this second and sends the key, the second and the signature, and no more", async () => {
    serve();
    const member = Keypair.generate();
    expect(await rewardsApi.join(member, undefined, unlocked)).toEqual({
      kind: "joined",
      state: STATE,
    });
    const [call] = api!.callsTo("/v1/rewards/join");
    expect(Object.keys(body(call)).sort()).toEqual(["at", "rewardsKey", "signature"]);
    expect(call.json).toMatchObject({ rewardsKey: member.publicKey.toBase58(), at: NOW_SECONDS });
  });

  it("signs for the invite code it sends, trimmed and in capitals, and for an empty last line when it sends none", async () => {
    serve();
    const member = Keypair.generate();
    const key = member.publicKey.toBase58();
    await rewardsApi.join(member, " k7m2qx9p ", unlocked);
    await rewardsApi.join(member, undefined, unlocked);
    const [invited, alone] = api!.callsTo("/v1/rewards/join").map(body);
    const signedOver = (last: string) => `NoirWire rewards v1\njoin\n${key}\n${NOW_SECONDS}${last}`;

    expect(invited.inviteCode).toBe("K7M2QX9P");
    expect(signedBy(key, signedOver("\nK7M2QX9P"), invited.signature)).toBe(true);
    // Not over another code, and not over the code as it was typed.
    expect(signedBy(key, signedOver("\nZZZZ2222"), invited.signature)).toBe(false);
    expect(signedBy(key, signedOver("\n k7m2qx9p "), invited.signature)).toBe(false);

    expect(alone).not.toHaveProperty("inviteCode");
    expect(signedBy(key, signedOver("\n"), alone.signature)).toBe(true);
    expect(signedBy(key, signedOver(""), alone.signature)).toBe(false);
  });

  it("says the invite code is not valid when the server will not take it", async () => {
    const member = Keypair.generate();

    serve({ "POST /v1/rewards/join": () => refusal("invite_code_invalid", 422) });
    expect(await rewardsApi.join(member, "NOPE2345", unlocked)).toEqual({
      kind: "inviteNotValid",
    });
  });

  it.each([
    ["clock_skew", 403],
    ["signature_invalid", 403],
    ["not_found", 404],
  ])("does not blame the invite code for %s: it is a failure", async (code, status) => {
    serve({ "POST /v1/rewards/join": () => refusal(code, status) });
    await expect(rewardsApi.join(Keypair.generate(), "K7M2QX9P", unlocked)).rejects.toMatchObject({
      code,
      status,
    });
  });
});

describe("reading how a member stands", () => {
  it("signs the read as the member, and is null when the server knows no such member", async () => {
    serve();
    const member = Keypair.generate();
    expect(await rewardsApi.state(member, unlocked)).toEqual(STATE);
    api!.restore();

    serve({ "POST /v1/rewards/state": () => refusal("not_a_member", 404) });
    expect(await rewardsApi.state(member, unlocked)).toBeNull();
  });

  it.each([
    ["not_found", 404],
    ["clock_skew", 403],
  ])("fails on %s, which says nothing of the member", async (code, status) => {
    serve({ "POST /v1/rewards/state": () => refusal(code, status) });
    await expect(rewardsApi.state(Keypair.generate(), unlocked)).rejects.toMatchObject({ code });
  });

  it("takes a standing with no running week, and refuses one that is not a standing", async () => {
    serve({ "POST /v1/rewards/state": () => ({ ...STATE, week: null }) });
    expect(await rewardsApi.state(Keypair.generate(), unlocked)).toEqual({ ...STATE, week: null });
    api!.restore();

    serve({ "POST /v1/rewards/state": () => ({ ...STATE, points: 1250 }) });
    await expect(rewardsApi.state(Keypair.generate(), unlocked)).rejects.toThrow();
  });

  it.each(["k7m2qx9p", "K7M2QX9", "K7M2QX9PP", "K7M2QX1P", "K7M2&x=9", "", 12345678])(
    "refuses a standing whose invite code is not one the server issues: %j",
    async (code) => {
      serve({
        "POST /v1/rewards/state": () => ({ ...STATE, code }),
        "POST /v1/rewards/join": () => ({ ...STATE, code }),
      });
      const member = Keypair.generate();
      await expect(rewardsApi.state(member, unlocked)).rejects.toThrow();
      await expect(rewardsApi.join(member, undefined, unlocked)).rejects.toThrow();
    },
  );
});

describe("an invite code as the server issues one", () => {
  it("is eight characters of the digits 2 to 9 and the capitals without I and O, and nothing else", () => {
    for (const code of ["K7M2QX9P", "22222222", "ZZZZZZZZ", "ABCDEFGH", "JKLMNPQR", "STUVWXYZ"]) {
      expect(isInviteCode(code), code).toBe(true);
    }
    const refused = [
      "k7m2qx9p",
      "K7M2QX9",
      "K7M2QX9PP",
      " K7M2QX9P",
      "K7M2QX9P\n",
      "K7M2QX0P",
      "K7M2QX1P",
      "K7M2QXIP",
      "K7M2QXOP",
      "K7M2-X9P",
      "K7M2QX9É",
      "",
      12345678,
      null,
      undefined,
    ];
    for (const code of refused) expect(isInviteCode(code), JSON.stringify(code)).toBe(false);
  });

  it("is what a typed code becomes once it is trimmed and put in capitals", () => {
    expect(isInviteCode(inviteCodeAsSent("  k7m2qx9p "))).toBe(true);
  });
});

describe("claiming a trade", () => {
  const claim = (member = Keypair.generate(), portfolio = Keypair.generate()) =>
    rewardsApi.claim({ member, portfolio, transaction: TRADE, stillUnlocked: unlocked });

  it("is signed by the member and by the portfolio, over the same message, and names exactly what the server asks for", async () => {
    serve();
    const member = Keypair.generate();
    const portfolio = Keypair.generate();
    expect(await claim(member, portfolio)).toEqual({
      kind: "credited",
      feeMicroUsdc: "120000",
      state: STATE,
    });
    const [call] = api!.callsTo("/v1/rewards/claims");
    expect(Object.keys(body(call)).sort()).toEqual([
      "portfolio",
      "portfolioSignature",
      "rewardsKey",
      "rewardsSignature",
      "transaction",
    ]);
    expect(call.json).toMatchObject({
      rewardsKey: member.publicKey.toBase58(),
      portfolio: portfolio.publicKey.toBase58(),
      transaction: TRADE,
    });
    expect(body(call).portfolioSignature).not.toBe(body(call).rewardsSignature);
  });

  it.each([
    ["not_a_member", 404, { kind: "notMember" }],
    ["already_claimed", 409, { kind: "alreadyClaimed" }],
    ["transaction_not_finalized", 422, { kind: "notFinalized" }],
    ["transaction_failed", 422, { kind: "refused", code: "transaction_failed" }],
    ["not_a_signer", 422, { kind: "refused", code: "not_a_signer" }],
    ["no_referral_fee", 422, { kind: "refused", code: "no_referral_fee" }],
    ["outside_claim_window", 422, { kind: "refused", code: "outside_claim_window" }],
    ["signature_invalid", 403, { kind: "refused", code: "signature_invalid" }],
  ])("reads %s (%i) as the server's word on the claim", async (code, status, outcome) => {
    serve({ "POST /v1/rewards/claims": () => refusal(code, status) });
    expect(await claim()).toEqual(outcome);
  });

  it.each([
    ["not_found", 404],
    ["rate_limited", 429],
    ["unavailable", 503],
    ["upstream_timeout", 504],
  ])(
    "settles nothing on %s (%i): the claim is left to be made again, and is asked once",
    async (code, status) => {
      serve({ "POST /v1/rewards/claims": () => refusal(code, status) });
      await expect(claim()).rejects.toMatchObject({ code, status });
      expect(api!.callsTo("/v1/rewards/claims")).toHaveLength(1);
    },
  );

  it("settles nothing on an answer that is not the server's own", async () => {
    serve({
      "POST /v1/rewards/claims": () => new Response("<html>Not Found</html>", { status: 404 }),
    });
    await expect(claim()).rejects.toThrow();
    expect(api!.callsTo("/v1/rewards/claims")).toHaveLength(1);
  });
});

describe("a wallet that locked", () => {
  it("signs nothing and sends nothing", async () => {
    serve();
    const locked = () => false;
    const member = Keypair.generate();
    await expect(rewardsApi.join(member, undefined, locked)).rejects.toMatchObject({
      code: "walletLocked",
    });
    await expect(rewardsApi.state(member, locked)).rejects.toMatchObject({ code: "walletLocked" });
    await expect(
      rewardsApi.claim({
        member,
        portfolio: Keypair.generate(),
        transaction: TRADE,
        stillUnlocked: locked,
      }),
    ).rejects.toMatchObject({ code: "walletLocked" });
    expect(api!.calls).toHaveLength(0);
  });
});
