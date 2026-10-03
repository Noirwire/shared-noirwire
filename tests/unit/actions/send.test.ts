import { describe, expect, it, vi } from "vitest";
import {
  reviewSend,
  send,
  type SendableAsset,
  type SendChain,
} from "../../../src/application/actions/send.js";
import { ChainError, UnknownOutcomeError } from "../../../src/domain/chainError.js";
import { actionFailure } from "../../../src/presentation/actionResult.js";
import {
  FUNDING_ADDRESS,
  harness,
  OTHER_ADDRESS,
  OWN_ADDRESS,
  RECIPIENT,
  type FakeSigner,
} from "../support/actions.js";

function asset(
  symbol: string,
  over: Partial<SendableAsset<FakeSigner>> = {},
): SendableAsset<FakeSigner> {
  return {
    symbol,
    balance: vi.fn(async () => 50),
    ensureAccount: vi.fn(async () => undefined),
    deposit: vi.fn(async () => undefined),
    withdraw: vi.fn(async () => undefined),
    ...(symbol === "SOL" ? {} : { sendRelayed: vi.fn(async () => "relayed-sig") }),
    ...over,
  };
}

function chain(
  moves: SendableAsset<FakeSigner>[],
  over: Partial<SendChain<FakeSigner>> = {},
): SendChain<FakeSigner> {
  return {
    asset: (symbol) => moves.find((entry) => entry.symbol === symbol),
    token: (symbol) =>
      symbol === "SOL"
        ? undefined
        : {
            symbol,
            decimals: 6,
            sendLamports: async () => 2_000_000,
            quoteRelayed: async () => ({ feeRaw: 20_000n, opensAccount: false }),
          },
    isRecipientAddress: (address) =>
      address.startsWith("Recipient") || address.startsWith("Portfolio"),
    cashSymbol: "USDC",
    networkFeeSol: 0.000005,
    cost: { balance: async () => 0, shortfall: async () => ({ required: 1 }) },
    ...over,
  };
}

function sending(moves = [asset("USDC")], h = harness()) {
  const deps = { ...h.deps, chain: chain(moves) };
  return {
    h,
    deps,
    run: (input: { symbol?: string; amount?: number; to?: string } = {}, relayerFeeRaw?: bigint) =>
      send(deps, {
        portfolioId: "p1",
        send: {
          symbol: input.symbol ?? "USDC",
          amount: input.amount ?? 10,
          to: input.to ?? RECIPIENT,
        },
        network: relayerFeeRaw === undefined ? undefined : { relayerFeeRaw },
      }),
  };
}

describe("sending from a portfolio", () => {
  it("has the relayer pay when the review showed it, keeping out every other address of the wallet but the recipient", async () => {
    const usdc = asset("USDC", {
      balance: vi.fn().mockResolvedValueOnce(50).mockResolvedValueOnce(40),
    });
    const { h, run } = sending([usdc]);
    expect(await run({ to: ` ${OTHER_ADDRESS} ` }, 20_000n)).toEqual({
      kind: "confirmed",
      signature: "relayed-sig",
      settlement: "balancesRead",
    });
    expect(usdc.sendRelayed).toHaveBeenCalledWith(
      expect.objectContaining({
        to: OTHER_ADDRESS,
        amount: 10,
        reviewedFeeRaw: 20_000n,
        keepOut: [FUNDING_ADDRESS],
      }),
    );
    expect(usdc.withdraw).not.toHaveBeenCalled();
    expect(h.holding("p1", "USDC")).toMatchObject({ amount: 40 });
    expect(h.wallet().activity[0]).toMatchObject({
      kind: "send",
      amount: 10,
      counterparty: OTHER_ADDRESS,
    });
    expect(h.track).toHaveBeenCalledWith("sent");
    expect(h.pending.pendingFor("p1")).toBeUndefined();
  });

  it("pays its own way without a reviewed relayer fee, and records all of its SOL as sent less the fee", async () => {
    const sol = asset("SOL", {
      balance: vi.fn().mockResolvedValueOnce(0.5).mockResolvedValueOnce(0),
    });
    const h = harness();
    await h.store.update((wallet) => ({
      ...wallet,
      portfolios: wallet.portfolios.map((entry) =>
        entry.id === "p1"
          ? { ...entry, holdings: [{ symbol: "SOL", amount: 0.5, cost: 50 }] }
          : entry,
      ),
    }));
    const { run } = sending([sol], h);
    expect(await run({ symbol: "SOL", amount: 0.5 })).toMatchObject({ kind: "confirmed" });
    expect(sol.withdraw).toHaveBeenCalledWith(
      expect.objectContaining({ address: OWN_ADDRESS }),
      expect.objectContaining({ address: FUNDING_ADDRESS }),
      0.5,
      RECIPIENT,
      expect.any(Function),
    );
    expect(h.wallet().activity[0]).toMatchObject({ amount: 0.5 - 0.000005 });
  });

  it("refuses what cannot be sent before reserving anything", async () => {
    const { h, run } = sending();
    expect(await run({ symbol: "DOGE" })).toMatchObject({
      reason: "notTransferable",
      symbol: "DOGE",
    });
    expect(await run({ amount: 51 })).toMatchObject({ reason: "sendNotCompleted" });
    expect(await run({ to: "not an address" })).toMatchObject({ reason: "sendNotCompleted" });
    expect(await run({ to: OWN_ADDRESS })).toMatchObject({ reason: "sendNotCompleted" });
    expect(h.pending.pendingFor("p1")).toBeUndefined();
  });

  it("refuses more than the chain shows, and releases the reservation", async () => {
    const usdc = asset("USDC", { balance: vi.fn(async () => 5) });
    const { h, run } = sending([usdc]);
    expect(await run()).toMatchObject({ kind: "refused", reason: "moreThanOnchain" });
    expect(usdc.withdraw).not.toHaveBeenCalled();
    expect(h.pending.pendingFor("p1")).toBeUndefined();
  });

  it("asks for the cost to be reviewed again when the relayer's fee rose, could not be used, or did not land", async () => {
    const cases = [
      [new ChainError("networkCostRose"), { because: "networkCostRose" }, "relayer"],
      [new ChainError("relayerUnavailable"), { because: "relayerUnavailable" }, "other"],
    ] as const;
    for (const [error, change, again] of cases) {
      const { h, run } = sending([
        asset("USDC", { sendRelayed: vi.fn(async () => Promise.reject(error)) }),
      ]);
      const result = await run({}, 20_000n);
      expect(result).toEqual({ kind: "needsReview", change, completed: [] });
      expect(actionFailure(result)?.reviewAgain).toBe(again);
      expect(h.track).not.toHaveBeenCalledWith("send_failed", expect.anything());
    }
    const { run } = sending([
      asset("USDC", {
        sendRelayed: vi.fn(async () => Promise.reject(new ChainError("relayedNotLanded"))),
      }),
    ]);
    const notLanded = await run({}, 20_000n);
    expect(notLanded).toEqual({ kind: "notLanded", completed: [] });
    expect(actionFailure(notLanded)).toEqual({
      error:
        "This was sent and did not go through. Nothing was moved. Review the network cost again.",
      reviewAgain: "other",
    });
  });

  it("counts a send that failed, by its own account", async () => {
    const { h, run } = sending([
      asset("USDC", {
        withdraw: vi.fn(async () => Promise.reject(new Error("Simulation refused."))),
      }),
    ]);
    expect(await run()).toMatchObject({
      kind: "failed",
      reason: "sendFailed",
      detail: "Simulation refused.",
    });
    expect(h.track).toHaveBeenCalledWith("send_failed", { reason: "other" });
  });

  it("keeps an unknown send pending with the activity it would write, and refuses a second confirm", async () => {
    const usdc = asset("USDC", {
      withdraw: vi.fn(async () => Promise.reject(new UnknownOutcomeError("sig", 700))),
    });
    const { h, run } = sending([usdc]);
    expect(await run()).toMatchObject({ kind: "unknown", signature: "sig" });
    expect(h.pending.pendingFor("p1")).toMatchObject({
      status: "unknown",
      what: "a send of 10.00 USDC",
      activity: { kind: "send", amount: 10, counterparty: RECIPIENT },
    });
    expect(await run()).toMatchObject({ kind: "refused", reason: "actionPending" });
    expect(usdc.withdraw).toHaveBeenCalledOnce();
  });
});

describe("reviewing a send", () => {
  it("costs nothing extra for SOL, which pays its own way", async () => {
    const { deps } = sending([asset("SOL")]);
    expect(
      await reviewSend(deps, {
        portfolioId: "p1",
        send: { symbol: "SOL", amount: 1, to: RECIPIENT },
        withoutRelayer: false,
      }),
    ).toEqual({ cost: { kind: "covered" }, amount: 1 });
  });

  it("sends the rest of the cash when all of it is sent and the relayer's fee comes out of it", async () => {
    const { deps } = sending();
    expect(
      await reviewSend(deps, {
        portfolioId: "p1",
        send: { symbol: "USDC", amount: 50, to: RECIPIENT },
        withoutRelayer: false,
      }),
    ).toMatchObject({ cost: { kind: "relayer", fee: 0.02 }, amount: 49.98 });
  });

  it("does not offer the relayer straight back after it failed", async () => {
    const { deps } = sending();
    expect(
      await reviewSend(deps, {
        portfolioId: "p1",
        send: { symbol: "USDC", amount: 10, to: RECIPIENT },
        withoutRelayer: true,
      }),
    ).toEqual({ cost: { kind: "unavailable" }, amount: 10 });
  });
});
