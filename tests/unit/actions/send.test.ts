import { describe, expect, it, vi } from "vitest";
import {
  reviewSend,
  send,
  type SendableAsset,
  type SendChain,
} from "../../../src/application/actions/send.js";
import { FUNDING } from "../../../src/application/pendingActions.js";
import { ChainError, UnknownOutcomeError } from "../../../src/domain/chainError.js";
import { actionFailure } from "../../../src/presentation/actionResult.js";
import { networkCostView } from "../../../src/presentation/networkCost.js";
import { sendRecipientRefusal } from "../../../src/presentation/send.js";
import {
  FUNDING_ADDRESS,
  harness,
  OTHER_ADDRESS,
  OWN_ADDRESS,
  RECIPIENT,
  wallet,
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
    checkRecipient: async () => null,
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

describe("the network cost of a send that landed", () => {
  async function withTracker() {
    const h = harness();
    await h.deps.store.update((wallet) => ({
      ...wallet,
      portfolios: wallet.portfolios.map((portfolio) =>
        portfolio.id === "p1"
          ? {
              ...portfolio,
              holdings: [...portfolio.holdings, { symbol: "SPYx", amount: 3, cost: 30 }],
            }
          : portfolio,
      ),
    }));
    return h;
  }

  it("is taken off cash at once when a tracker is sent, and is written into Activity", async () => {
    const h = await withTracker();
    const tracker = asset("SPYx", {
      balance: vi.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(2),
    });
    const deps = { ...h.deps, chain: chain([tracker]) };
    const result = await send(deps, {
      portfolioId: "p1",
      send: { symbol: "SPYx", amount: 1, to: RECIPIENT },
      network: { relayerFeeRaw: 20_000n },
    });
    expect(result).toMatchObject({ kind: "confirmed" });
    expect(h.holding("p1", "SPYx")).toMatchObject({ amount: 2 });
    // Nothing re-read the cash: it is no longer what it was before the send.
    expect(h.holding("p1", "USDC")).toMatchObject({ amount: 49.98 });
    expect(h.wallet().activity[0]).toMatchObject({
      kind: "send",
      symbol: "SPYx",
      amount: 1,
      networkCost: 0.02,
    });
  });

  it("is not taken off when the portfolio paid the network itself", async () => {
    const h = await withTracker();
    const deps = { ...h.deps, chain: chain([asset("SPYx", { balance: vi.fn(async () => 3) })]) };
    await send(deps, { portfolioId: "p1", send: { symbol: "SPYx", amount: 1, to: RECIPIENT } });
    expect(h.holding("p1", "USDC")).toMatchObject({ amount: 50 });
    expect(h.wallet().activity[0]).not.toHaveProperty("networkCost");
  });

  it("is kept with the reservation, so a send that lands unseen is recorded with it", async () => {
    const usdc = asset("USDC", {
      sendRelayed: vi.fn(async () => Promise.reject(new UnknownOutcomeError("sig", 700))),
    });
    const { h, run } = sending([usdc]);
    await run({}, 20_000n);
    expect(h.pending.pendingFor("p1")?.activity).toMatchObject({ amount: 10, networkCost: 0.02 });
  });
});

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

describe("sending from the funding wallet", () => {
  /** The funding wallet holds 100 USDC, as stored. */
  function fromFunding(
    moves = [asset("USDC", { balance: vi.fn(async () => 100) })],
    h = harness(),
    over: Partial<SendChain<FakeSigner>> = {},
  ) {
    const deps = { ...h.deps, chain: chain(moves, over) };
    return {
      h,
      deps,
      run: (
        input: { symbol?: string; amount?: number; to?: string } = {},
        relayerFeeRaw?: bigint,
      ) =>
        send(deps, {
          portfolioId: FUNDING,
          send: {
            symbol: input.symbol ?? "USDC",
            amount: input.amount ?? 10,
            to: input.to ?? RECIPIENT,
          },
          network: relayerFeeRaw === undefined ? undefined : { relayerFeeRaw },
        }),
      review: (amount: number, to = RECIPIENT) =>
        reviewSend(deps, {
          portfolioId: FUNDING,
          send: { symbol: "USDC", amount, to },
          withoutRelayer: false,
        }),
    };
  }

  it("signs with its own key, reserved under the funding wallet, and records the send there", async () => {
    const h = harness();
    const reserved: unknown[] = [];
    const usdc = asset("USDC", {
      balance: vi.fn().mockResolvedValueOnce(100).mockResolvedValueOnce(90),
      withdraw: vi.fn(async () => {
        reserved.push(h.pending.pendingFor(FUNDING)?.what, h.pending.pendingFor("p1"));
      }),
    });
    const { run } = fromFunding([usdc], h);
    expect(await run()).toEqual({ kind: "confirmed", settlement: "balancesRead" });
    expect(usdc.withdraw).toHaveBeenCalledWith(
      expect.objectContaining({ address: FUNDING_ADDRESS }),
      expect.objectContaining({ address: FUNDING_ADDRESS }),
      10,
      RECIPIENT,
      expect.any(Function),
    );
    expect(usdc.sendRelayed).not.toHaveBeenCalled();
    expect(reserved).toEqual(["a send of 10.00 USDC", undefined]);
    expect(h.pending.pendingFor(FUNDING)).toBeUndefined();
    expect(h.wallet().activity).toHaveLength(1);
    expect(h.wallet().activity[0]).toMatchObject({
      portfolioId: FUNDING,
      kind: "send",
      symbol: "USDC",
      amount: 10,
      usd: 10,
      counterparty: RECIPIENT,
    });
    expect(h.wallet().funding.tokens.USDC).toBe(90);
    // No portfolio is touched by it.
    expect(h.holding("p1", "USDC")).toMatchObject({ amount: 50 });
    expect(h.track).toHaveBeenCalledWith("sent");
  });

  it("takes a relayer's fee from its own USDC, and keeps every portfolio out of that transaction", async () => {
    const usdc = asset("USDC", {
      // The balance cannot be read back after it lands: the estimate stands in.
      balance: vi.fn().mockResolvedValueOnce(100).mockRejectedValue(new Error("unreachable")),
    });
    const { h, run } = fromFunding([usdc]);
    expect(await run({}, 20_000n)).toEqual({
      kind: "confirmed",
      signature: "relayed-sig",
      settlement: "balancesEstimated",
    });
    expect(usdc.sendRelayed).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: expect.objectContaining({ address: FUNDING_ADDRESS }),
        to: RECIPIENT,
        amount: 10,
        reviewedFeeRaw: 20_000n,
        keepOut: [OWN_ADDRESS, OTHER_ADDRESS],
      }),
    );
    expect(usdc.withdraw).not.toHaveBeenCalled();
    expect(h.wallet().funding.tokens.USDC).toBe(89.98);
    expect(h.holding("p1", "USDC")).toMatchObject({ amount: 50 });
    expect(h.wallet().activity[0]).toMatchObject({
      portfolioId: FUNDING,
      kind: "send",
      amount: 10,
      networkCost: 0.02,
    });
  });

  it("refuses a send to one of this wallet's own portfolios, with nothing priced, reserved or signed", async () => {
    const usdc = asset("USDC");
    const sendLamports = vi.fn(async () => 2_000_000);
    const checkRecipient = vi.fn(async () => null);
    const { h, run, review } = fromFunding([usdc], harness(), {
      checkRecipient,
      token: (symbol) => ({
        symbol,
        decimals: 6,
        sendLamports,
        quoteRelayed: async () => ({ feeRaw: 20_000n, opensAccount: false }),
      }),
    });
    // An active portfolio and an archived one are both this wallet's own.
    for (const own of [OWN_ADDRESS, OTHER_ADDRESS]) {
      const refusal = await run({ to: own }, 20_000n);
      expect(refusal).toMatchObject({ kind: "refused", reason: "ownPortfolioFromFunding" });
      expect(actionFailure(refusal)?.error).toContain("Use Move to portfolio");
      const reviewed = await review(10, own);
      expect(reviewed).toEqual({
        cost: { kind: "unavailable" },
        amount: 10,
        recipient: "ownPortfolio",
      });
      expect(sendRecipientRefusal(reviewed)).toContain("Use Move to portfolio");
    }
    expect(usdc.balance).not.toHaveBeenCalled();
    expect(usdc.withdraw).not.toHaveBeenCalled();
    expect(usdc.sendRelayed).not.toHaveBeenCalled();
    expect(sendLamports).not.toHaveBeenCalled();
    expect(checkRecipient).not.toHaveBeenCalled();
    expect(h.pending.pendingFor(FUNDING)).toBeUndefined();
    expect(h.wallet().activity).toEqual([]);
    expect(h.wallet().funding.tokens.USDC).toBe(100);
  });

  it("still sends from a portfolio to the funding wallet's address, as before", async () => {
    const usdc = asset("USDC", {
      balance: vi.fn().mockResolvedValueOnce(50).mockResolvedValueOnce(40),
    });
    const h = harness();
    const deps = { ...h.deps, chain: chain([usdc], { isRecipientAddress: () => true }) };
    expect(
      await send(deps, {
        portfolioId: "p1",
        send: { symbol: "USDC", amount: 10, to: FUNDING_ADDRESS },
      }),
    ).toMatchObject({ kind: "confirmed" });
    expect(usdc.withdraw).toHaveBeenCalledWith(
      expect.objectContaining({ address: OWN_ADDRESS }),
      expect.anything(),
      10,
      FUNDING_ADDRESS,
      expect.any(Function),
    );
    expect(h.wallet().activity[0]).toMatchObject({
      portfolioId: "p1",
      kind: "send",
      counterparty: FUNDING_ADDRESS,
    });
  });

  it("sends its SOL, all of it less the fee, and nothing else that sits at its address", async () => {
    const h = harness(
      wallet({ funding: { address: FUNDING_ADDRESS, sol: 0.5, tokens: { USDC: 100, SPYx: 3 } } }),
    );
    const sol = asset("SOL", {
      balance: vi.fn().mockResolvedValueOnce(0.5).mockResolvedValueOnce(0),
    });
    const tracker = asset("SPYx", { balance: vi.fn(async () => 3) });
    const { run } = fromFunding([sol, tracker], h);
    expect(await run({ symbol: "SOL", amount: 0.5 })).toMatchObject({ kind: "confirmed" });
    expect(h.wallet().funding.sol).toBe(0);
    expect(h.wallet().activity[0]).toMatchObject({
      portfolioId: FUNDING,
      symbol: "SOL",
      amount: 0.5 - 0.000005,
    });

    expect(await run({ symbol: "SPYx", amount: 1 })).toMatchObject({
      kind: "refused",
      reason: "sendNotCompleted",
    });
    expect(tracker.withdraw).not.toHaveBeenCalled();
    expect(tracker.sendRelayed).not.toHaveBeenCalled();
    expect(h.wallet().funding.tokens.SPYx).toBe(3);
  });

  it("refuses more than the chain shows it holds, in its own words", async () => {
    const usdc = asset("USDC", { balance: vi.fn(async () => 5) });
    const { h, run } = fromFunding([usdc]);
    const refusal = await run();
    expect(refusal).toMatchObject({ kind: "refused", reason: "moreThanFunding" });
    expect(actionFailure(refusal)?.error).toBe("More than your main wallet holds.");
    expect(usdc.withdraw).not.toHaveBeenCalled();
    expect(h.pending.pendingFor(FUNDING)).toBeUndefined();
  });

  it("records a send that landed unseen under the funding wallet once the chain shows it", async () => {
    const usdc = asset("USDC", {
      balance: vi.fn(async () => 100),
      withdraw: vi.fn(async () => Promise.reject(new UnknownOutcomeError("sig", 700))),
    });
    const { h, run } = fromFunding([usdc]);
    expect(await run()).toMatchObject({ kind: "unknown", signature: "sig" });
    expect(h.pending.pendingFor(FUNDING)).toMatchObject({
      status: "unknown",
      activity: { kind: "send", amount: 10, counterparty: RECIPIENT },
    });
    expect(await run()).toMatchObject({ kind: "refused", reason: "actionPending" });
    expect(h.wallet().activity).toEqual([]);

    h.settle.mockResolvedValueOnce("landed" as never);
    expect(await h.pending.settlePending(FUNDING)).toBe("landed");
    expect(h.wallet().activity).toEqual([
      expect.objectContaining({ portfolioId: FUNDING, kind: "send", amount: 10 }),
    ]);
  });

  it("pays the network from its own SOL when it holds enough, and is priced with the relayer when it does not", async () => {
    const quoteRelayed = vi.fn(async () => ({ feeRaw: 20_000n, opensAccount: false }));
    const token = (symbol: string) => ({
      symbol,
      decimals: 6,
      sendLamports: async () => 2_000_000,
      quoteRelayed,
    });
    const rich = fromFunding(undefined, harness(), {
      token,
      cost: { balance: async () => 10_000_000, shortfall: async () => null },
    });
    // All of its USDC goes: the cost is paid in SOL, not out of the amount.
    expect(await rich.review(100)).toEqual({
      cost: { kind: "ownSol", usd: 0.2 },
      amount: 100,
      recipient: null,
    });
    expect(quoteRelayed).not.toHaveBeenCalled();
    // A portfolio with the same SOL is still priced with the relayer first.
    expect(
      await reviewSend(rich.deps, {
        portfolioId: "p1",
        send: { symbol: "USDC", amount: 10, to: RECIPIENT },
        withoutRelayer: false,
      }),
    ).toMatchObject({ cost: { kind: "relayer", fee: 0.02 }, amount: 10 });

    const poor = fromFunding(undefined, harness(), { token });
    expect(await poor.review(100)).toMatchObject({
      cost: { kind: "relayer", fee: 0.02 },
      amount: 99.98,
    });
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
    ).toEqual({ cost: { kind: "covered" }, amount: 1, recipient: null });
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
    ).toEqual({ cost: { kind: "unavailable" }, amount: 10, recipient: null });
  });

  it("reads the recipient from the network in every review, so no screen can skip it", async () => {
    const checkRecipient = vi.fn(async () => "mint" as const);
    const { deps } = sending();
    const review = await reviewSend(
      { ...deps, chain: { ...deps.chain, checkRecipient } },
      {
        portfolioId: "p1",
        send: { symbol: "USDC", amount: 10, to: RECIPIENT },
        withoutRelayer: false,
      },
    );
    expect(checkRecipient).toHaveBeenCalledWith(RECIPIENT);
    expect(review).toEqual({ cost: { kind: "unavailable" }, amount: 10, recipient: "mint" });
    expect(sendRecipientRefusal(review)).toBe(
      "This is a token's own mint address, not a wallet. Anything sent to it could not be moved again.",
    );
  });

  it("says the recipient could not be checked when the network cannot be asked, not that the send cannot be made", async () => {
    const { deps } = sending();
    const review = await reviewSend(
      {
        ...deps,
        chain: { ...deps.chain, checkRecipient: () => Promise.reject(new Error("fetch failed")) },
      },
      {
        portfolioId: "p1",
        send: { symbol: "USDC", amount: 10, to: RECIPIENT },
        withoutRelayer: false,
      },
    );
    expect(review.recipient).toBe("unreadable");
    expect(sendRecipientRefusal(review)).not.toBeNull();
    expect(sendRecipientRefusal({ recipient: null })).toBeNull();
  });

  it("says a tracker sent from a portfolio with no cash needs cash, before the relayer is asked", async () => {
    const h = harness();
    await h.deps.store.update((wallet) => ({
      ...wallet,
      portfolios: wallet.portfolios.map((portfolio) =>
        portfolio.id === "p1"
          ? { ...portfolio, holdings: [{ symbol: "SPYx", amount: 3, cost: 30 }] }
          : portfolio,
      ),
    }));
    const quoteRelayed = vi.fn(async () => Promise.reject(new Error("simulation failed")));
    const deps = {
      ...h.deps,
      chain: chain([asset("SPYx")], {
        token: (symbol) => ({
          symbol,
          decimals: 8,
          sendLamports: async () => 2_000_000,
          quoteRelayed,
        }),
      }),
    };
    const review = await reviewSend(deps, {
      portfolioId: "p1",
      send: { symbol: "SPYx", amount: 1, to: RECIPIENT },
      withoutRelayer: false,
    });
    expect(review.cost).toEqual({ kind: "needsCash", cash: 0.01, free: 0 });
    expect(quoteRelayed).not.toHaveBeenCalled();
    expect(
      networkCostView({ cost: review.cost, pending: { blocked: false }, submitting: false }),
    ).toMatchObject({
      moveMoney: {
        before:
          "This portfolio needs at least 0.01 USDC to pay the network cost, and would have 0.00 USDC to spare. ",
      },
      confirmDisabled: true,
    });
  });
});
