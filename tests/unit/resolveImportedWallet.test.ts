import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { connection } from "../../src/infrastructure/solana/client.js";
import { deriveKeypair, generateWalletMnemonic } from "../../src/infrastructure/solana/keys.js";
import { paceImportWith, resolveImportedWallet } from "../../src/infrastructure/solana/import.js";
import { ataFor } from "../../src/infrastructure/solana/tokens.js";
import { ALL_STOCKS } from "../../src/infrastructure/solana/tokenRegistry.js";
import type { DerivationScheme } from "../../src/domain/wallet.js";

function addressAt(mnemonic: string, index: number, scheme: DerivationScheme): string {
  return deriveKeypair(mnemonic, index, scheme).publicKey.toBase58();
}

/** Where an owner's balance of one listed stock lives, and nothing else of theirs. */
function stockAccountOf(owner: string): string {
  const stock = ALL_STOCKS[ALL_STOCKS.length - 1];
  return ataFor(stock.mint, new PublicKey(owner), stock.programId).toBase58();
}

function fakeAccountInfo(lamports: number): AccountInfo<Buffer> {
  return { lamports, data: Buffer.alloc(0), owner: PublicKey.default, executable: false };
}

/**
 * Stands in for the validator. `sol` maps an address to the lamports it
 * holds; `stockOnly` lists owners whose only trace is a token account for
 * one stock: no SOL, no cash account.
 */
function mockChain(chain: { sol?: Record<string, number>; stockOnly?: string[] }) {
  const existing = new Map([
    ...Object.entries(chain.sol ?? {}),
    ...(chain.stockOnly ?? []).map((owner) => [stockAccountOf(owner), 2_074_080] as const),
  ]);
  vi.spyOn(connection, "getTokenAccountsByOwner");
  return vi
    .spyOn(connection, "getMultipleAccountsInfo")
    .mockImplementation(async (pubkeys: PublicKey[]) =>
      pubkeys.map((pubkey) => {
        const lamports = existing.get(pubkey.toBase58());
        return lamports === undefined ? null : fakeAccountInfo(lamports);
      }),
    );
}

beforeEach(() => paceImportWith(null));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveImportedWallet", () => {
  it("chooses the scheme whose funding wallet holds only tokens and no SOL", async () => {
    const mnemonic = generateWalletMnemonic();
    mockChain({ stockOnly: [addressAt(mnemonic, 0, "walletDefault")] });

    const resolution = await resolveImportedWallet(mnemonic);

    expect(resolution.scheme).toBe("walletDefault");
    expect(resolution.walletDefault).toMatchObject({ active: true, balanceSol: 0, portfolios: [] });
    expect(resolution.app.active).toBe(false);
  });

  it("chooses the scheme by a portfolio that holds only a stock token, with the funding wallet empty", async () => {
    const mnemonic = generateWalletMnemonic();
    const portfolio = addressAt(mnemonic, 3, "walletDefault");
    mockChain({ stockOnly: [portfolio] });

    const resolution = await resolveImportedWallet(mnemonic);

    expect(resolution.scheme).toBe("walletDefault");
    expect(resolution.walletDefault.portfolios).toEqual([
      { index: 3, address: portfolio, solBalance: 0 },
    ]);
  });

  it("chooses the scheme with SOL when the other shows nothing", async () => {
    const mnemonic = generateWalletMnemonic();
    mockChain({ sol: { [addressAt(mnemonic, 0, "app")]: 1_500_000_000 } });

    const resolution = await resolveImportedWallet(mnemonic);

    expect(resolution.scheme).toBe("app");
    expect(resolution.app.balanceSol).toBe(1.5);
  });

  it("asks the user when both schemes show activity", async () => {
    const mnemonic = generateWalletMnemonic();
    mockChain({
      sol: { [addressAt(mnemonic, 0, "app")]: 1_000_000 },
      stockOnly: [addressAt(mnemonic, 2, "walletDefault")],
    });

    const resolution = await resolveImportedWallet(mnemonic);

    expect(resolution.scheme).toBeNull();
    expect(resolution.app.active).toBe(true);
    expect(resolution.walletDefault.active).toBe(true);
  });

  it("asks the user when neither scheme shows activity", async () => {
    const mnemonic = generateWalletMnemonic();
    mockChain({});

    const resolution = await resolveImportedWallet(mnemonic);

    expect(resolution.scheme).toBeNull();
    expect(resolution.app.active).toBe(false);
    expect(resolution.walletDefault.active).toBe(false);
  });

  it("reads a never-used phrase in one request per candidate address", async () => {
    const mnemonic = generateWalletMnemonic();
    const batches = mockChain({});

    await resolveImportedWallet(mnemonic);

    // Two schemes, each a funding wallet and twenty candidates, each asked
    // about on its own: its SOL, its cash and its stock accounts together.
    expect(batches.mock.calls.length).toBe(2 * 21);
    for (const [addresses] of batches.mock.calls) expect(addresses.length).toBeLessThanOrEqual(100);
    expect(connection.getTokenAccountsByOwner).not.toHaveBeenCalled();
  });

  it("never has more than three requests in flight", async () => {
    const mnemonic = generateWalletMnemonic();
    let inFlight = 0;
    let most = 0;
    vi.spyOn(connection, "getMultipleAccountsInfo").mockImplementation(async (pubkeys) => {
      most = Math.max(most, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return pubkeys.map(() => null);
    });

    await resolveImportedWallet(mnemonic);

    expect(most).toBe(3);
  });

  it("hands the thread back between owners, so the screen can draw and Cancel can be tapped", async () => {
    const mnemonic = generateWalletMnemonic();
    mockChain({ sol: { [addressAt(mnemonic, 0, "app")]: 1_000_000 } });
    // What a tap or a frame would be: a task waiting its turn on the event loop.
    let turns = 0;
    const ticking = setInterval(() => (turns += 1), 0);

    await resolveImportedWallet(mnemonic);
    clearInterval(ticking);

    // Two conventions, two steps of ten each at the least: a turn before each key and each lookup.
    expect(turns).toBeGreaterThanOrEqual(40);
  });

  it("waits and asks again when the RPC rate-limits a request, instead of failing the import", async () => {
    vi.useFakeTimers();
    const mnemonic = generateWalletMnemonic();
    const batches = mockChain({ sol: { [addressAt(mnemonic, 0, "app")]: 1_000_000 } });
    batches.mockRejectedValueOnce(new Error("429 Too Many Requests"));

    const pending = resolveImportedWallet(mnemonic);
    await vi.runAllTimersAsync();

    expect((await pending).scheme).toBe("app");
    vi.useRealTimers();
  });

  it("gives up with the RPC's own error when it keeps refusing", async () => {
    vi.useFakeTimers();
    vi.spyOn(connection, "getMultipleAccountsInfo").mockRejectedValue(
      new Error("429 Too Many Requests"),
    );

    const pending = resolveImportedWallet(generateWalletMnemonic());
    const outcome = expect(pending).rejects.toThrow("429");
    await vi.runAllTimersAsync();
    await outcome;
    vi.useRealTimers();
  });
});
