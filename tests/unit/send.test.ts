import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordSigning } from "./support/signing.js";
import {
  AccountLayout,
  MintLayout,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  VersionedTransaction,
  type AccountInfo,
} from "@solana/web3.js";
import { connection } from "../../src/infrastructure/solana/client.js";
import { sendSolTo, toRawUnits } from "../../src/infrastructure/solana/sol.js";
import { OWN_SEND_WAIT_MS } from "../../src/infrastructure/solana/settlement.js";
import { UnknownOutcomeError } from "../../src/infrastructure/solana/swap/types.js";
import { ataFor, withdrawToken } from "../../src/infrastructure/solana/tokens.js";

recordSigning();

const DECIMALS = 6;
const TOKEN_ACCOUNT_RENT = 2_039_280;
const RENT_EXEMPT_MINIMUM = 890_880;
const LAST_VALID_BLOCK_HEIGHT = 1_000;

const mint = Keypair.generate().publicKey;
const funder = Keypair.generate();
const portfolio = Keypair.generate();
const recipient = Keypair.generate().publicKey;

function account(owner: PublicKey, data: Buffer, lamports = 1, executable = false) {
  return { owner, data, lamports, executable, rentEpoch: 0 } satisfies AccountInfo<Buffer>;
}

function mintAccount() {
  const data = Buffer.alloc(MintLayout.span);
  MintLayout.encode(
    {
      mintAuthorityOption: 0,
      mintAuthority: PublicKey.default,
      supply: 0n,
      decimals: DECIMALS,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    data,
  );
  return account(TOKEN_PROGRAM_ID, data);
}

function tokenAccount(owner: PublicKey, amount: bigint, programId = TOKEN_PROGRAM_ID) {
  const data = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode(
    {
      mint,
      owner,
      amount,
      delegateOption: 0,
      delegate: PublicKey.default,
      state: 1,
      isNativeOption: 0,
      isNative: 0n,
      delegatedAmount: 0n,
      closeAuthorityOption: 0,
      closeAuthority: PublicKey.default,
    },
    data,
  );
  return account(programId, data, TOKEN_ACCOUNT_RENT);
}

/**
 * Stands in for the validator: `accounts` is everything that exists, by
 * address. Returns the transactions that were sent, decoded.
 */
function mockChain(accounts: Record<string, AccountInfo<Buffer>>) {
  const all = { [mint.toBase58()]: mintAccount(), ...accounts };
  const sent: VersionedTransaction[] = [];
  vi.spyOn(connection, "getAccountInfo").mockImplementation(
    async (address) => all[address.toBase58()] ?? null,
  );
  vi.spyOn(connection, "getMultipleAccountsInfo").mockImplementation(async (addresses) =>
    addresses.map((address) => all[address.toBase58()] ?? null),
  );
  vi.spyOn(connection, "getBalance").mockImplementation(
    async (address) => all[address.toBase58()]?.lamports ?? 0,
  );
  vi.spyOn(connection, "getMinimumBalanceForRentExemption").mockImplementation(async (size) =>
    size === 0 ? RENT_EXEMPT_MINIMUM : TOKEN_ACCOUNT_RENT,
  );
  vi.spyOn(connection, "getLatestBlockhash").mockResolvedValue({
    blockhash: Keypair.generate().publicKey.toBase58(),
    lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
  });
  vi.spyOn(connection, "sendRawTransaction").mockImplementation(async (raw) => {
    sent.push(VersionedTransaction.deserialize(raw as Uint8Array));
    return "signature";
  });
  vi.spyOn(connection, "getBlockHeight").mockResolvedValue(LAST_VALID_BLOCK_HEIGHT - 10);
  vi.spyOn(connection, "getSignatureStatus").mockResolvedValue({
    context: { slot: 1 },
    value: { slot: 1, confirmations: 1, err: null, confirmationStatus: "confirmed" },
  });
  return sent;
}

function wallet(lamports: number) {
  return account(SystemProgram.programId, Buffer.alloc(0), lamports);
}

/** A portfolio holding `tokens` raw units and `lamports` of SOL, sending to a recipient that has a token account. */
function fundedPortfolio(tokens: bigint, lamports: number, recipientHasAccount = true) {
  return {
    [portfolio.publicKey.toBase58()]: wallet(lamports),
    [ataFor(mint, portfolio.publicKey).toBase58()]: tokenAccount(portfolio.publicKey, tokens),
    ...(recipientHasAccount
      ? { [ataFor(mint, recipient).toBase58()]: tokenAccount(recipient, 0n) }
      : {}),
  };
}

function accountKeysOf(transaction: VersionedTransaction): string[] {
  return transaction.message.staticAccountKeys.map((key) => key.toBase58());
}

/** The amount a TransferChecked instruction carries: a u64 right after its one-byte tag. */
function transferredAmount(transaction: VersionedTransaction): bigint {
  const instruction = transaction.message.compiledInstructions.at(-1)!;
  return Buffer.from(instruction.data).readBigUInt64LE(1);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a send from a portfolio", () => {
  it("pays for a token send itself, and the funding wallet is nowhere in the transaction", async () => {
    const sent = mockChain(fundedPortfolio(50_000_000n, 10_000_000, false));

    await withdrawToken(mint, DECIMALS, portfolio, funder, 20, recipient);

    expect(sent).toHaveLength(1);
    const keys = accountKeysOf(sent[0]);
    expect(keys[0]).toBe(portfolio.publicKey.toBase58());
    expect(keys).not.toContain(funder.publicKey.toBase58());
    expect(sent[0].message.header.numRequiredSignatures).toBe(1);
    expect(sent[0].signatures).toHaveLength(1);
    // The recipient's token account is opened in the same transaction, by the portfolio.
    expect(sent[0].message.compiledInstructions).toHaveLength(2);
    expect(transferredAmount(sent[0])).toBe(20_000_000n);
  });

  it("pays for a SOL send itself, and the funding wallet is nowhere in the transaction", async () => {
    const sent = mockChain({ [portfolio.publicKey.toBase58()]: wallet(2_000_000_000) });

    await sendSolTo(portfolio, funder, recipient, 0.5);

    const keys = accountKeysOf(sent[0]);
    expect(keys[0]).toBe(portfolio.publicKey.toBase58());
    expect(keys).not.toContain(funder.publicKey.toBase58());
    expect(sent[0].message.header.numRequiredSignatures).toBe(1);
  });

  it("refuses a token send before building anything when the portfolio cannot pay for it", async () => {
    const sent = mockChain(fundedPortfolio(50_000_000n, 0, false));

    await expect(withdrawToken(mint, DECIMALS, portfolio, funder, 20, recipient)).rejects.toThrow(
      "This portfolio cannot pay for the network fee and the recipient's token account right now. Review it again.",
    );
    expect(connection.getLatestBlockhash).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it("asks only for the network fee when the recipient already has a token account", async () => {
    mockChain(fundedPortfolio(50_000_000n, 1_000));

    await expect(withdrawToken(mint, DECIMALS, portfolio, funder, 20, recipient)).rejects.toThrow(
      "This portfolio cannot pay for the network fee right now.",
    );
  });

  it("refuses a SOL send whose amount and fee together exceed the balance", async () => {
    const sent = mockChain({ [portfolio.publicKey.toBase58()]: wallet(1_000_000_000) });

    await expect(sendSolTo(portfolio, funder, recipient, 0.999999)).rejects.toThrow(
      "This portfolio cannot pay for this amount and the network fee right now.",
    );
    expect(sent).toHaveLength(0);
  });

  it("takes the fee out of the amount when all of the SOL is sent", async () => {
    const sent = mockChain({ [portfolio.publicKey.toBase58()]: wallet(1_000_000_000) });

    await sendSolTo(portfolio, funder, recipient, 1);

    const lamports = Buffer.from(sent[0].message.compiledInstructions[0].data).readBigUInt64LE(4);
    expect(lamports).toBe(999_995_000n);
  });
});

describe("recipients nobody could sign for", () => {
  const send = (to: PublicKey) => withdrawToken(mint, DECIMALS, portfolio, funder, 20, to);

  beforeEach(() => {
    mockChain(fundedPortfolio(50_000_000n, 10_000_000));
  });

  it("refuses a program", async () => {
    const program = Keypair.generate().publicKey;
    vi.mocked(connection.getAccountInfo).mockResolvedValue(
      account(PublicKey.default, Buffer.alloc(36), 1, true),
    );
    await expect(send(program)).rejects.toThrow("This is a program's address, not a wallet.");
    await expect(sendSolTo(portfolio, funder, program, 0.001)).rejects.toThrow(
      "This is a program's address, not a wallet.",
    );
  });

  it("refuses a mint, under either token program", async () => {
    await expect(send(mint)).rejects.toThrow("This is a token's own mint address, not a wallet.");

    const stockMint = Buffer.alloc(200);
    stockMint[165] = 1;
    vi.mocked(connection.getAccountInfo).mockResolvedValue(
      account(TOKEN_2022_PROGRAM_ID, stockMint),
    );
    await expect(send(Keypair.generate().publicKey)).rejects.toThrow(
      "This is a token's own mint address, not a wallet.",
    );
  });

  it("refuses a token account", async () => {
    const existing = ataFor(mint, recipient);
    await expect(send(existing)).rejects.toThrow("This is a token account, not a wallet.");

    const stockAccount = Buffer.alloc(200);
    stockAccount[165] = 2;
    vi.mocked(connection.getAccountInfo).mockResolvedValue(
      account(TOKEN_2022_PROGRAM_ID, stockAccount),
    );
    await expect(send(Keypair.generate().publicKey)).rejects.toThrow(
      "This is a token account, not a wallet.",
    );
  });

  it("refuses an existing account that a program other than the System program owns", async () => {
    const stakeProgram = new PublicKey("Stake11111111111111111111111111111111111111");
    for (const owner of [stakeProgram, Keypair.generate().publicKey]) {
      vi.mocked(connection.getAccountInfo).mockResolvedValue(account(owner, Buffer.alloc(200)));
      await expect(send(Keypair.generate().publicKey)).rejects.toThrow(
        "This address is an account that a program controls, such as a stake account, not an ordinary wallet.",
      );
      await expect(
        sendSolTo(portfolio, funder, Keypair.generate().publicKey, 0.001),
      ).rejects.toThrow("an account that a program controls");
    }
    expect(connection.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("allows an existing wallet and one that does not exist yet", async () => {
    await expect(send(recipient)).resolves.toBeUndefined();
    vi.mocked(connection.getAccountInfo).mockImplementation(async (address) =>
      address.equals(recipient) ? wallet(1_000_000) : mintAccount(),
    );
    await expect(send(recipient)).resolves.toBeUndefined();
  });

  it("refuses an address with no private key, even one that holds nothing yet", async () => {
    const offCurve = ataFor(mint, Keypair.generate().publicKey);
    await expect(send(offCurve)).rejects.toThrow("This address has no private key behind it");
    await expect(sendSolTo(portfolio, funder, offCurve, 0.001)).rejects.toThrow(
      "This address has no private key behind it",
    );
  });

  it("sends nothing in any of those cases", async () => {
    await expect(send(mint)).rejects.toThrow();
    expect(connection.sendRawTransaction).not.toHaveBeenCalled();
  });
});

describe("amounts", () => {
  it("refuses an amount that rounds to zero base units", () => {
    expect(() => toRawUnits(0.0000001, 6)).toThrow("smaller than the smallest unit");
    expect(() => toRawUnits(0, 6)).toThrow("smaller than the smallest unit");
  });

  it("refuses an amount a number cannot hold exactly", () => {
    expect(() => toRawUnits(9_007_199_255, 6)).toThrow("too large to send exactly");
    expect(() => toRawUnits(Number.POSITIVE_INFINITY, 6)).toThrow("too large to send exactly");
    expect(toRawUnits(9_007_199_254, 6)).toBe(9_007_199_254_000_000n);
  });

  it("converts an ordinary amount without float drift", () => {
    expect(toRawUnits(0.1 + 0.2, 6)).toBe(300_000n);
    expect(toRawUnits(1.1, 9)).toBe(1_100_000_000n);
  });

  it("sends the exact raw balance when asked for everything the chain reports", async () => {
    // Past 2^53: the shown figure cannot name this balance exactly, the raw one can.
    const held = 123_456_789_012_345_678n;
    const sent = mockChain(fundedPortfolio(held, 10_000_000));

    await withdrawToken(
      mint,
      DECIMALS,
      portfolio,
      funder,
      Number(held) / 10 ** DECIMALS,
      recipient,
    );

    expect(transferredAmount(sent[0])).toBe(held);
  });

  it("refuses more than the chain holds", async () => {
    const sent = mockChain(fundedPortfolio(5_000_000n, 10_000_000));

    await expect(withdrawToken(mint, DECIMALS, portfolio, funder, 6, recipient)).rejects.toThrow(
      "More than this address holds onchain.",
    );
    expect(sent).toHaveLength(0);
  });
});

describe("a send, confirmed by asking the chain", () => {
  const send = () => withdrawToken(mint, DECIMALS, portfolio, funder, 20, recipient);
  const chain = () => mockChain(fundedPortfolio(50_000_000n, 10_000_000));
  const noTrace = { context: { slot: 1 }, value: null };

  afterEach(() => vi.useRealTimers());

  it("is a success when the chain says it landed", async () => {
    const sent = chain();

    await expect(send()).resolves.toBeUndefined();
    expect(sent).toHaveLength(1);
  });

  it("keeps asking until the chain shows it", async () => {
    vi.useFakeTimers();
    const sent = chain();
    const status = vi
      .mocked(connection.getSignatureStatus)
      .mockResolvedValueOnce(noTrace)
      .mockResolvedValueOnce(noTrace);

    const outcome = expect(send()).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(5_000);

    await outcome;
    expect(status).toHaveBeenCalledTimes(3);
    expect(sent).toHaveLength(1);
  });

  it("is a failure when the chain recorded an error", async () => {
    chain();
    vi.mocked(connection.getSignatureStatus).mockResolvedValue({
      context: { slot: 1 },
      value: { slot: 1, confirmations: 1, err: { InstructionError: [0, "Custom"] } },
    });

    await expect(send()).rejects.toThrow("The transfer failed on chain.");
  });

  it("is a failure once its blockhash has expired with no trace of it", async () => {
    chain();
    vi.mocked(connection.getSignatureStatus).mockResolvedValue(noTrace);
    vi.mocked(connection.getBlockHeight).mockResolvedValue(LAST_VALID_BLOCK_HEIGHT + 1);

    await expect(send()).rejects.toThrow("The transfer failed on chain.");
  });

  it("is unknown, not a failure, when the wait ends with no trace and a live blockhash", async () => {
    vi.useFakeTimers();
    const sent = chain();
    vi.mocked(connection.getSignatureStatus).mockResolvedValue(noTrace);

    const outcome = expect(send()).rejects.toBeInstanceOf(UnknownOutcomeError);
    await vi.advanceTimersByTimeAsync(OWN_SEND_WAIT_MS + 5_000);

    await outcome;
    // Signed and sent once: nothing here tries again on its own.
    expect(sent).toHaveLength(1);
  });

  it("is unknown when the send itself got no answer", async () => {
    chain();
    vi.mocked(connection.sendRawTransaction).mockRejectedValue(new Error("fetch failed"));
    vi.mocked(connection.getSignatureStatus).mockResolvedValue(noTrace);

    await expect(send()).rejects.toBeInstanceOf(UnknownOutcomeError);
    expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1);
  });
});
