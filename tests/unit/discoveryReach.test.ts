import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canCreatePortfolio,
  createPortfolio,
  unusedPortfoliosInARow,
} from "../../src/application/actions/createPortfolio.js";
import { createPacer } from "../../src/application/pacer.js";
import { isTransient, withRetries } from "../../src/application/retries.js";
import { logged } from "../../src/application/walletRecord.js";
import { onboardingCopy } from "../../src/copy/onboarding.js";
import {
  DISCOVERY_GAP,
  EXTENDED_DISCOVERY_GAP,
  MAX_UNUSED_PORTFOLIOS_IN_A_ROW,
} from "../../src/domain/importResolution.js";
import type { DerivationScheme, Portfolio } from "../../src/domain/wallet.js";
import { connection } from "../../src/infrastructure/solana/client.js";
import {
  IMPORT_REQUESTS_PER_SECOND,
  lookFurtherForPortfolios,
  paceImportWith,
  resolveImportedWallet,
} from "../../src/infrastructure/solana/import.js";
import { deriveKeypair, generateWalletMnemonic } from "../../src/infrastructure/solana/keys.js";
import { refusalMessage } from "../../src/presentation/actionResult.js";
import { lookFurtherView } from "../../src/presentation/importFindings.js";
import { harness, prices, wallet } from "./support/actions.js";

const addressAt = (mnemonic: string, index: number, scheme: DerivationScheme = "app") =>
  deriveKeypair(mnemonic, index, scheme).publicKey.toBase58();

const account = (lamports: number): AccountInfo<Buffer> => ({
  lamports,
  data: Buffer.alloc(0),
  owner: PublicKey.default,
  executable: false,
});

/** A chain where the named addresses hold SOL. Records the owner each request asked about. */
function chainWith(funded: string[], answer?: (owner: string) => void) {
  const asked: string[] = [];
  const spy = vi
    .spyOn(connection, "getMultipleAccountsInfo")
    .mockImplementation(async (pubkeys: PublicKey[]) => {
      const owner = pubkeys[0].toBase58();
      answer?.(owner);
      asked.push(owner);
      return pubkeys.map((pubkey) => (funded.includes(pubkey.toBase58()) ? account(1_000) : null));
    });
  return { asked, spy };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  paceImportWith(createPacer({ perSecond: IMPORT_REQUESTS_PER_SECOND }));
});

describe("creating portfolios within an import's reach", () => {
  const newPortfolio = (label: string, address: string, derivationIndex: number): Portfolio => ({
    id: `new_${derivationIndex}`,
    label,
    address,
    derivationIndex,
    createdAt: 2,
    archivedAt: null,
    holdings: [{ symbol: "USDC", amount: 0, cost: 0 }],
  });
  let named = 0;
  const create = (h: ReturnType<typeof harness>) =>
    createPortfolio(
      { ...h.deps, newPortfolio, fundingIndex: 0, pieProblem: () => null },
      { label: `Empty ${++named}` },
    );

  it("keeps the limit on unused portfolios safely under the scan's gap", () => {
    expect(MAX_UNUSED_PORTFOLIOS_IN_A_ROW).toBeLessThan(DISCOVERY_GAP);
    expect(DISCOVERY_GAP - MAX_UNUSED_PORTFOLIOS_IN_A_ROW).toBeGreaterThanOrEqual(5);
    expect(EXTENDED_DISCOVERY_GAP).toBeGreaterThan(DISCOVERY_GAP);
  });

  it("creates up to the limit of never-used portfolios in a row, then refuses with plain words", async () => {
    const h = harness();
    expect(unusedPortfoliosInARow(h.wallet(), 0)).toBe(0);
    for (let made = 0; made < MAX_UNUSED_PORTFOLIOS_IN_A_ROW; made++) {
      expect((await create(h)).kind).toBe("created");
    }
    expect(unusedPortfoliosInARow(h.wallet(), 0)).toBe(MAX_UNUSED_PORTFOLIOS_IN_A_ROW);
    expect(canCreatePortfolio(h.wallet(), 0)).toBe(false);

    const before = h.wallet().portfolios.length;
    const result = await create(h);
    expect(result).toMatchObject({ kind: "refused", reason: "unusedPortfolios" });
    expect(h.wallet().portfolios).toHaveLength(before);
    for (const platform of ["web", "mobile"] as const) {
      expect(refusalMessage({ reason: "unusedPortfolios" }, platform)).toBe(
        "You have several portfolios that were never used. Use one of those first. An archived one can be restored.",
      );
    }
  });

  it("counts archived unused portfolios, and a reservation that never sent anything is not use", async () => {
    const h = harness();
    for (let made = 0; made < MAX_UNUSED_PORTFOLIOS_IN_A_ROW; made++) await create(h);
    await h.store.update((current) => ({
      ...current,
      portfolios: current.portfolios.map((entry) =>
        entry.id.startsWith("new_")
          ? {
              ...entry,
              archivedAt: 9,
              pendingAction: { status: "reserved" as const, id: "r", at: 1, what: "a send" },
            }
          : entry,
      ),
    }));
    expect(await create(h)).toMatchObject({ kind: "refused", reason: "unusedPortfolios" });
  });

  it("allows more once the last one holds something or has done something", async () => {
    const funded = harness();
    for (let made = 0; made < MAX_UNUSED_PORTFOLIOS_IN_A_ROW; made++) await create(funded);
    const last = funded.wallet().portfolios[0];
    await funded.store.update((current) => ({
      ...current,
      portfolios: current.portfolios.map((entry) =>
        entry.id === last.id
          ? { ...entry, holdings: [{ symbol: "USDC", amount: 5, cost: 5 }] }
          : entry,
      ),
    }));
    expect(unusedPortfoliosInARow(funded.wallet(), 0)).toBe(0);
    expect((await create(funded)).kind).toBe("created");

    const acted = harness();
    for (let made = 0; made < MAX_UNUSED_PORTFOLIOS_IN_A_ROW; made++) await create(acted);
    const emptied = acted.wallet().portfolios[0];
    await acted.store.update((current) =>
      logged(
        current,
        { portfolioId: emptied.id, kind: "send", symbol: "USDC", amount: 5, usd: 5 },
        prices,
      ),
    );
    expect((await create(acted)).kind).toBe("created");
  });

  it("counts indices the record has no portfolio for, as an import that skipped them would", () => {
    const sparse = wallet({
      portfolios: [
        {
          id: "far",
          label: "Far",
          address: "Portfolio999",
          derivationIndex: 9,
          createdAt: 1,
          archivedAt: null,
          holdings: [],
        },
      ],
    });
    expect(unusedPortfoliosInARow(sparse, 0)).toBe(9);
  });

  it("means the portfolio funded after the most unused ones is still found by an import", async () => {
    paceImportWith(null);
    const mnemonic = generateWalletMnemonic();
    // The funding wallet is used, the limit of portfolios after it never was,
    // and the next one, the furthest creation allows, holds money.
    const furthest = MAX_UNUSED_PORTFOLIOS_IN_A_ROW + 1;
    chainWith([addressAt(mnemonic, 0), addressAt(mnemonic, furthest)]);
    const resolution = await resolveImportedWallet(mnemonic);
    expect(resolution.scheme).toBe("app");
    expect(resolution.app.portfolios.map((found) => found.index)).toEqual([furthest]);
  });
});

describe("looking further after an import", () => {
  beforeEach(() => paceImportWith(null));

  it("finds a portfolio past the first scan's gap, carrying on from where that scan stopped", async () => {
    const mnemonic = generateWalletMnemonic();
    const far = DISCOVERY_GAP + 15;
    const { asked } = chainWith([addressAt(mnemonic, 0), addressAt(mnemonic, far)]);

    const first = await resolveImportedWallet(mnemonic);
    expect(first.app.portfolios).toEqual([]);
    expect(first.app.scannedThrough).toBe(DISCOVERY_GAP);

    asked.length = 0;
    const further = await lookFurtherForPortfolios(mnemonic, "app", first.app);
    expect(further.portfolios).toEqual([
      { index: far, address: addressAt(mnemonic, far), solBalance: expect.any(Number) },
    ]);
    expect(further.active).toBe(true);
    expect(further.scannedThrough).toBe(far + EXTENDED_DISCOVERY_GAP);
    // Nothing the first scan judged is asked about again.
    const already = Array.from({ length: DISCOVERY_GAP + 1 }, (_, index) =>
      addressAt(mnemonic, index),
    );
    expect(asked.some((owner) => already.includes(owner))).toBe(false);
    expect(new Set(asked).size).toBe(asked.length);
  });

  it("keeps what was found before, and says so when there is nothing more", async () => {
    const mnemonic = generateWalletMnemonic();
    chainWith([addressAt(mnemonic, 2)]);
    const first = await resolveImportedWallet(mnemonic);
    const further = await lookFurtherForPortfolios(mnemonic, "app", first.app);
    expect(further.portfolios).toEqual(first.app.portfolios);
    expect(further.scannedThrough).toBe(2 + DISCOVERY_GAP + EXTENDED_DISCOVERY_GAP);
    expect(lookFurtherView({ status: "done", before: first.app, after: further }).note).toEqual({
      text: "No more portfolios were found for this phrase.",
      tone: "dim",
    });
  });

  it("offers it, waits, and says what came of it, in the same words on both platforms", async () => {
    expect(lookFurtherView({ status: "idle" })).toEqual({
      action: "Missing a portfolio? Look further",
      waiting: null,
      note: null,
    });
    expect(lookFurtherView({ status: "looking" })).toEqual({
      action: null,
      waiting: "Looking further for your portfolios...",
      note: null,
    });
    expect(lookFurtherView({ status: "failed" }).note).toEqual({
      text: "We couldn't finish looking. Nothing was changed. Try again.",
      tone: "danger",
    });
    const before = { address: "a", balanceSol: 0, portfolios: [], active: false };
    const found = [1, 2].map((index) => ({ index, address: `p${index}`, solBalance: 0 }));
    expect(
      lookFurtherView({ status: "done", before, after: { ...before, portfolios: found } }).note,
    ).toEqual({ text: "Found 2 more portfolios.", tone: "safe" });
    expect(onboardingCopy.import.lookFurther.found(1)).toBe("Found 1 more portfolio.");
  });
});

describe("the pacer", () => {
  it("starts no more than its rate in any second, evenly spaced, by the clock it is given", async () => {
    let clock = 0;
    const started: number[] = [];
    const pacer = createPacer({
      perSecond: 8,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    for (let request = 0; request < 30; request++) {
      await pacer.turn();
      started.push(clock);
    }
    expect(started.slice(0, 4)).toEqual([0, 125, 250, 375]);
    for (const at of started) {
      expect(
        started.filter((other) => other >= at && other < at + 1_000).length,
      ).toBeLessThanOrEqual(8);
    }
  });

  it("does not make a caller wait when the last request was long ago", async () => {
    let clock = 0;
    const sleep = vi.fn(async () => undefined);
    const pacer = createPacer({ perSecond: 8, now: () => clock, sleep });
    await pacer.turn();
    clock = 5_000;
    await pacer.turn();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("is set safely under ten a second for an import", () => {
    expect(IMPORT_REQUESTS_PER_SECOND).toBeLessThan(10);
  });
});

describe("a retry's jitter", () => {
  it("stretches each pause by up to its share, so refused callers do not come back together", async () => {
    vi.useFakeTimers();
    const attempt = vi
      .fn(async () => "ok")
      .mockRejectedValueOnce(new Error("429 Too Many Requests"));
    const work = withRetries(attempt, {
      tries: 2,
      pauseMs: 1_000,
      jitter: 0.5,
      random: () => 0.5,
      retryable: isTransient,
    });
    await vi.advanceTimersByTimeAsync(1_249);
    expect(attempt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await work).toBe("ok");
  });
});

describe("an import against a provider that allows ten requests a second", () => {
  /** Refuses any request beyond the tenth started within the last second. */
  function strictProvider(funded: string[]) {
    const starts: number[] = [];
    let refusals = 0;
    const chain = chainWith(funded, () => {
      const now = Date.now();
      const lastSecond = starts.filter((at) => at > now - 1_000).length;
      if (lastSecond >= 10) {
        refusals += 1;
        throw new Error("429 Too Many Requests");
      }
      starts.push(now);
    });
    return { ...chain, refusals: () => refusals };
  }

  async function finished<T>(work: Promise<T>): Promise<T> {
    const outcome = work.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await vi.runAllTimersAsync();
    const result = await outcome;
    if ("error" in result) throw result.error;
    return result.value;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    paceImportWith(createPacer({ perSecond: IMPORT_REQUESTS_PER_SECOND }));
  });

  it("completes without a single refusal, across both schemes, asking about each address once", async () => {
    const mnemonic = generateWalletMnemonic();
    const provider = strictProvider([addressAt(mnemonic, 0), addressAt(mnemonic, 3)]);

    const resolution = await finished(resolveImportedWallet(mnemonic));

    expect(resolution.scheme).toBe("app");
    expect(resolution.app.portfolios.map((found) => found.index)).toEqual([3]);
    expect(provider.refusals()).toBe(0);
    expect(new Set(provider.asked).size).toBe(provider.asked.length);
    // Two funding wallets, thirty candidates for the scheme with a find, twenty for the other.
    expect(provider.asked).toHaveLength(2 + 30 + 20);
  });

  it("never starts more than its rate in a second when slow answers come back together", async () => {
    const mnemonic = generateWalletMnemonic();
    const starts: number[] = [];
    vi.spyOn(connection, "getMultipleAccountsInfo").mockImplementation(
      async (pubkeys: PublicKey[]) => {
        starts.push(Date.now());
        // Every answer takes two seconds, so three requests fill the slots and
        // the rest queue behind them, to be let go three at a time.
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        return pubkeys.map(() => null);
      },
    );

    await finished(resolveImportedWallet(mnemonic));

    expect(starts).toHaveLength(2 * 21);
    for (const at of starts) {
      const within = starts.filter((other) => other >= at && other < at + 1_000).length;
      expect(within).toBeLessThanOrEqual(IMPORT_REQUESTS_PER_SECOND);
    }
    const gaps = starts.slice(1).map((at, index) => at - starts[index]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1_000 / IMPORT_REQUESTS_PER_SECOND);
  });

  it("would be refused without pacing, which is what the pace is for", async () => {
    paceImportWith(null);
    const mnemonic = generateWalletMnemonic();
    const provider = strictProvider([]);
    await finished(resolveImportedWallet(mnemonic));
    expect(provider.refusals()).toBeGreaterThan(0);
  });

  it("carries on from the last completed step after a failed attempt, instead of starting again", async () => {
    const mnemonic = generateWalletMnemonic();
    const stuck = addressAt(mnemonic, 15);
    let failing = true;
    const { asked } = chainWith([addressAt(mnemonic, 0), addressAt(mnemonic, 3)], (owner) => {
      if (failing && owner === stuck) throw new Error("503 Service Unavailable");
    });

    await expect(finished(resolveImportedWallet(mnemonic))).rejects.toThrow("503");
    const firstAttempt = new Set(asked);
    expect(firstAttempt.has(addressAt(mnemonic, 0))).toBe(true);
    expect(firstAttempt.has(addressAt(mnemonic, 3))).toBe(true);

    failing = false;
    asked.length = 0;
    const resolution = await finished(resolveImportedWallet(mnemonic));

    expect(resolution.app.portfolios.map((found) => found.index)).toEqual([3]);
    // The first ten candidates, the funding wallets and the whole other
    // scheme were answered the first time, and are not asked about again.
    const completed = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((index) => addressAt(mnemonic, index));
    expect(asked.some((owner) => completed.includes(owner))).toBe(false);
    expect(asked.some((owner) => owner === addressAt(mnemonic, 0, "walletDefault"))).toBe(false);
    expect(asked).toContain(stuck);
  });
});
