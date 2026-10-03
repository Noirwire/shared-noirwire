import { afterEach, describe, expect, it, vi } from "vitest";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, type PublicKey } from "@solana/web3.js";
import { getCashBalances, getPortfolioBalances } from "../../src/infrastructure/solana/balances.js";
import { connection, SUBSCRIBING_METHODS } from "../../src/infrastructure/solana/client.js";
import { ataFor } from "../../src/infrastructure/solana/tokens.js";
import {
  ALL_STOCKS,
  SUPPORTED_TOKENS,
  type TokenDefinition,
} from "../../src/infrastructure/solana/tokenRegistry.js";

afterEach(() => vi.restoreAllMocks());

function accountsOf(owner: PublicKey): string[] {
  return [
    owner,
    ...SUPPORTED_TOKENS.map((token) => ataFor(token.mint, owner, token.programId)),
  ].map((address) => address.toBase58());
}

describe("a balance refresh", () => {
  it("asks about each address in a request of its own, never two together", async () => {
    const funding = Keypair.generate().publicKey;
    const portfolios = [1, 2, 3].map(() => Keypair.generate().publicKey);
    const requests = vi
      .spyOn(connection, "getMultipleAccountsInfo")
      .mockImplementation(async (addresses) => addresses.map(() => null));

    for (const owner of [funding, ...portfolios]) await getCashBalances(owner);

    expect(requests).toHaveBeenCalledTimes(4);
    [funding, ...portfolios].forEach((owner, index) => {
      const requested = requests.mock.calls[index][0].map((address) => address.toBase58());
      expect(requested).toEqual(accountsOf(owner));
    });
  });
});

/** A token account as the chain returns it, holding `raw` base units. */
function tokenAccount(raw: bigint) {
  const data = new Uint8Array(165);
  new DataView(data.buffer).setBigUint64(64, raw, true);
  return { data, lamports: 2_039_280 } as never;
}

function tracker(symbol: string): TokenDefinition {
  return {
    symbol,
    name: symbol,
    mint: Keypair.generate().publicKey,
    decimals: 8,
    programId: TOKEN_2022_PROGRAM_ID,
  };
}

describe("a portfolio's balance refresh", () => {
  const trackerAccounts = (owner: PublicKey, trackers: readonly TokenDefinition[]) =>
    trackers.map((token) => ataFor(token.mint, owner, token.programId).toBase58());

  it("reads SOL, cash and every tracker ever listed in one request", async () => {
    const owner = Keypair.generate().publicKey;
    const held = ALL_STOCKS[3];
    const heldAccount = ataFor(held.mint, owner, held.programId).toBase58();
    const requests = vi
      .spyOn(connection, "getMultipleAccountsInfo")
      .mockImplementation(async (addresses) =>
        addresses.map((address) =>
          address.equals(owner)
            ? ({ lamports: 1_500_000_000 } as never)
            : address.toBase58() === heldAccount
              ? tokenAccount(250_000_000n)
              : null,
        ),
      );

    const balances = await getPortfolioBalances(owner, ALL_STOCKS);

    expect(requests).toHaveBeenCalledTimes(1);
    expect(requests.mock.calls[0][0].map((address) => address.toBase58())).toEqual([
      ...accountsOf(owner),
      ...trackerAccounts(owner, ALL_STOCKS),
    ]);
    expect(balances.cash).toEqual({ SOL: 1.5, USDC: 0 });
    // Every tracker read is named, so one the chain no longer holds can be removed.
    expect(Object.keys(balances.trackers)).toEqual(ALL_STOCKS.map((stock) => stock.symbol));
    expect(balances.trackers[held.symbol]).toBe(2.5);
    expect(Object.values(balances.trackers).filter((amount) => amount > 0)).toHaveLength(1);
  });

  it("derives each tracker's account under that mint's own token program", async () => {
    const owner = Keypair.generate().publicKey;
    const requests = vi
      .spyOn(connection, "getMultipleAccountsInfo")
      .mockImplementation(async (addresses) => addresses.map(() => null));
    await getPortfolioBalances(owner, ALL_STOCKS);
    const requested = requests.mock.calls[0][0].map((address) => address.toBase58());
    for (const stock of ALL_STOCKS) {
      expect(stock.programId.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
      expect(requested).toContain(ataFor(stock.mint, owner, TOKEN_2022_PROGRAM_ID).toBase58());
      expect(requested).not.toContain(ataFor(stock.mint, owner).toBase58());
    }
  });

  it("never puts more than a hundred addresses in a request, and keeps the amounts in order", async () => {
    const owner = Keypair.generate().publicKey;
    const trackers = Array.from({ length: 230 }, (_, index) => tracker(`T${index}`));
    const accounts = trackerAccounts(owner, trackers);
    const requests = vi
      .spyOn(connection, "getMultipleAccountsInfo")
      .mockImplementation(async (addresses) =>
        addresses.map((address) => {
          const index = accounts.indexOf(address.toBase58());
          return index < 0 ? null : tokenAccount(BigInt(index + 1) * 100_000_000n);
        }),
      );

    const balances = await getPortfolioBalances(owner, trackers);

    const sizes = requests.mock.calls.map(([addresses]) => addresses.length);
    expect(sizes).toEqual([100, 100, 32]);
    expect(
      requests.mock.calls.flatMap(([addresses]) => addresses.map((a) => a.toBase58())),
    ).toEqual([...accountsOf(owner), ...accounts]);
    trackers.forEach((token, index) => expect(balances.trackers[token.symbol]).toBe(index + 1));
  });

  it("names one portfolio per request: never two, and never the funding wallet with one", async () => {
    const funding = Keypair.generate().publicKey;
    const portfolios = [1, 2, 3].map(() => Keypair.generate().publicKey);
    const requests = vi
      .spyOn(connection, "getMultipleAccountsInfo")
      .mockImplementation(async (addresses) => addresses.map(() => null));

    await getCashBalances(funding);
    for (const owner of portfolios) await getPortfolioBalances(owner, ALL_STOCKS);

    // One request each for three portfolios, plus the funding wallet's own.
    expect(requests).toHaveBeenCalledTimes(4);
    const everyone = [funding, ...portfolios];
    const accountsBy = everyone.map(
      (owner) => new Set([...accountsOf(owner), ...trackerAccounts(owner, ALL_STOCKS)]),
    );
    requests.mock.calls.forEach(([addresses], index) => {
      const requested = addresses.map((address) => address.toBase58());
      expect(requested.every((address) => accountsBy[index].has(address))).toBe(true);
      accountsBy.forEach((accounts, other) => {
        if (other !== index) expect(requested.some((address) => accounts.has(address))).toBe(false);
      });
    });
  });

  it("reads no tracker off mainnet, where those mints do not exist", async () => {
    const owner = Keypair.generate().publicKey;
    const requests = vi
      .spyOn(connection, "getMultipleAccountsInfo")
      .mockImplementation(async (addresses) => addresses.map(() => null));
    expect((await getPortfolioBalances(owner)).trackers).toEqual({});
    expect(requests.mock.calls[0][0].map((address) => address.toBase58())).toEqual(
      accountsOf(owner),
    );
  });
});

describe("the RPC connection", () => {
  it("refuses every call that would open a websocket", () => {
    const subscribing = connection as unknown as Record<string, (...args: unknown[]) => unknown>;
    for (const method of SUBSCRIBING_METHODS) {
      expect(() => subscribing[method]("signature", () => undefined), method).toThrow(
        "would open a websocket",
      );
    }
  });
});
