import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { connection } from "../../src/infrastructure/solana/client.js";
import { deriveKeypair, generateWalletMnemonic } from "../../src/infrastructure/solana/keys.js";
import { lamportsToSol } from "../../src/infrastructure/solana/sol.js";
import { ataFor } from "../../src/infrastructure/solana/tokens.js";
import { ALL_STOCKS, SUPPORTED_TOKENS } from "../../src/infrastructure/solana/tokenRegistry.js";
import { discoverExistingPortfolios } from "../../src/infrastructure/solana/import.js";

/** One probe for the keypair itself plus one per registered token's ATA. */
const PROBES_PER_INDEX = 1 + SUPPORTED_TOKENS.length;

function ownerAddressAt(mnemonic: string, index: number): string {
  return deriveKeypair(mnemonic, index, "app").publicKey.toBase58();
}

function ataAddressAt(mnemonic: string, index: number): string {
  const owner = deriveKeypair(mnemonic, index, "app").publicKey;
  return ataFor(SUPPORTED_TOKENS[0].mint, owner).toBase58();
}

function fakeAccountInfo(lamports: number): AccountInfo<Buffer> {
  return {
    lamports,
    data: Buffer.alloc(0),
    owner: PublicKey.default,
    executable: false,
    rentEpoch: 0,
  };
}

/**
 * Stands in for the validator: a vault PDA "exists" only for the indices
 * named in `balancesByIndex`. Keyed on the vault PDA (what
 * getMultipleAccountsInfo is actually called with), not the owner address.
 */
function mockChain(mnemonic: string, balancesByIndex: Record<number, number>) {
  const lookup = new Map(
    Object.entries(balancesByIndex).map(([index, lamports]) => [
      ownerAddressAt(mnemonic, Number(index)),
      lamports,
    ]),
  );
  return vi
    .spyOn(connection, "getMultipleAccountsInfo")
    .mockImplementation(async (pubkeys: PublicKey[]) =>
      pubkeys.map((pubkey) => {
        const lamports = lookup.get(pubkey.toBase58());
        return lamports === undefined ? null : fakeAccountInfo(lamports);
      }),
    );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("discoverExistingPortfolios", () => {
  it("returns [] and scans exactly gapLimit indices when nothing exists on chain", async () => {
    const mnemonic = generateWalletMnemonic();
    const spy = mockChain(mnemonic, {});

    const result = await discoverExistingPortfolios(mnemonic, "app");

    expect(result).toEqual([]);
    // Per candidate: its SOL and cash, then its stock accounts when those
    // showed nothing. Never two candidates in one request.
    expect(spy).toHaveBeenCalledTimes(20 * 2);
    for (const [addresses] of spy.mock.calls) {
      expect([PROBES_PER_INDEX, ALL_STOCKS.length]).toContain(addresses.length);
    }
  });

  it("names one candidate's accounts per request, and nobody else's", async () => {
    const mnemonic = generateWalletMnemonic();
    const spy = mockChain(mnemonic, { 1: 1_000_000 });

    await discoverExistingPortfolios(mnemonic, "app");

    const accountsOf = (index: number) => {
      const owner = deriveKeypair(mnemonic, index, "app").publicKey;
      return new Set(
        [
          owner,
          ...SUPPORTED_TOKENS.map((token) => ataFor(token.mint, owner, token.programId)),
          ...ALL_STOCKS.map((stock) => ataFor(stock.mint, owner, stock.programId)),
        ].map((address) => address.toBase58()),
      );
    };
    const candidates = Array.from({ length: 40 }, (_, offset) => accountsOf(offset + 1));
    for (const [addresses] of spy.mock.calls) {
      const requested = addresses.map((address) => address.toBase58());
      const owners = candidates.filter((accounts) => requested.some((a) => accounts.has(a)));
      expect(owners).toHaveLength(1);
      expect(requested.every((address) => owners[0].has(address))).toBe(true);
    }
  });

  it("finds a run of hits with no gaps between them", async () => {
    const mnemonic = generateWalletMnemonic();
    mockChain(mnemonic, { 1: 1_000_000, 2: 2_000_000, 3: 3_000_000 });

    const result = await discoverExistingPortfolios(mnemonic, "app");

    expect(result).toEqual([
      { index: 1, address: ownerAddressAt(mnemonic, 1), solBalance: lamportsToSol(1_000_000) },
      { index: 2, address: ownerAddressAt(mnemonic, 2), solBalance: lamportsToSol(2_000_000) },
      { index: 3, address: ownerAddressAt(mnemonic, 3), solBalance: lamportsToSol(3_000_000) },
    ]);
  });

  it("keeps scanning through a gap that doesn't reach the limit", async () => {
    const mnemonic = generateWalletMnemonic();
    // 9 misses between two hits - well under the default gap limit of 20,
    // so the scan must not stop after the first hit.
    mockChain(mnemonic, { 1: 500_000, 11: 700_000 });

    const result = await discoverExistingPortfolios(mnemonic, "app");

    expect(result).toEqual([
      { index: 1, address: ownerAddressAt(mnemonic, 1), solBalance: lamportsToSol(500_000) },
      { index: 11, address: ownerAddressAt(mnemonic, 11), solBalance: lamportsToSol(700_000) },
    ]);
  });

  it("does not find an account exactly one index past the default gap limit boundary", async () => {
    const mnemonic = generateWalletMnemonic();
    mockChain(mnemonic, { 21: 1_000_000 });

    const result = await discoverExistingPortfolios(mnemonic, "app");

    expect(result).toEqual([]);
  });

  it("finds that same account when passed an explicit gap limit covering it", async () => {
    const mnemonic = generateWalletMnemonic();
    mockChain(mnemonic, { 21: 1_000_000 });

    const result = await discoverExistingPortfolios(mnemonic, "app", 25);

    expect(result).toEqual([
      { index: 21, address: ownerAddressAt(mnemonic, 21), solBalance: lamportsToSol(1_000_000) },
    ]);
  });

  it("finds an account that holds only tokens and no SOL at all", async () => {
    // The common case now: a private account funded purely by a private USDC
    // transfer never receives SOL, so its keypair holds nothing and only its
    // token account exists. Keying discovery on SOL alone would lose it.
    const mnemonic = generateWalletMnemonic();
    const tokenOnly = ataAddressAt(mnemonic, 4);
    vi.spyOn(connection, "getMultipleAccountsInfo").mockImplementation(
      async (pubkeys: PublicKey[]) =>
        pubkeys.map((pubkey) =>
          pubkey.toBase58() === tokenOnly ? fakeAccountInfo(2_039_280) : null,
        ),
    );

    const result = await discoverExistingPortfolios(mnemonic, "app");

    expect(result).toEqual([{ index: 4, address: ownerAddressAt(mnemonic, 4), solBalance: 0 }]);
  });

  it("resets the miss counter to 0 after a hit, instead of accumulating across it", async () => {
    const mnemonic = generateWalletMnemonic();
    // 15 misses, then a hit at 16 - if the counter didn't reset there, the
    // trailing misses after it would falsely be treated as having already
    // reached the gap limit and the scan would stop before finding anything.
    mockChain(mnemonic, { 16: 900_000 });

    const result = await discoverExistingPortfolios(mnemonic, "app");

    expect(result).toEqual([
      { index: 16, address: ownerAddressAt(mnemonic, 16), solBalance: lamportsToSol(900_000) },
    ]);
  });
});
