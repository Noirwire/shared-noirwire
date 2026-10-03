import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  VersionedTransaction,
  type AccountInfo,
} from "@solana/web3.js";
import {
  planNetworkCost,
  planSendCost,
  type CostChain,
} from "../../src/application/networkCost.js";
import type { NetworkCost } from "../../src/domain/networkCost.js";
import { networkCostView } from "../../src/presentation/networkCost.js";
import { connection } from "../../src/infrastructure/solana/client.js";
import { shortfallFor } from "../../src/infrastructure/solana/fees.js";
import { usdcMint } from "../../src/infrastructure/solana/config.js";
import { settle, type SentUnconfirmed } from "../../src/infrastructure/solana/pending.js";
import * as presignGuard from "../../src/infrastructure/solana/presign-guard.js";
import { checkBalanceChanges } from "../../src/infrastructure/solana/presign-guard.js";
import { readRelayed } from "../../src/infrastructure/solana/relayed.js";
import {
  checkCoSigned,
  compileRelayed,
  quoteRelayed,
  RelayedNotLandedError,
  RelayerFeeRoseError,
  RelayerUnavailableError,
  resetRelayerPins,
  runRelayed,
} from "../../src/infrastructure/solana/relayer.js";
import { UnknownOutcomeError } from "../../src/infrastructure/solana/swap/types.js";
import {
  ataFor,
  relayedOpenDraft,
  relayedSendDraft,
} from "../../src/infrastructure/solana/tokens.js";
import { ALL_STOCKS } from "../../src/infrastructure/solana/tokenRegistry.js";

/**
 * A relayer-paid action from the wallet's side: what gets built, what is
 * asked of the relay and in which order, what happens when the price moves
 * or the relay goes quiet, how the cost of an action is met, and how an
 * action whose outcome is unknown is kept from being done twice.
 */

const USDC = new PublicKey(usdcMint());
const relayer = Keypair.generate();
const secondRelayer = Keypair.generate();
const relayerKeys = [relayer, secondRelayer];
const paymentWallet = Keypair.generate().publicKey;
const portfolio = Keypair.generate();
const owner = portfolio.publicKey;
const recipient = Keypair.generate().publicKey;
const tracker = ALL_STOCKS[0];
const FEE = 20_000n;
const LAST_VALID = 1_000;

function tokenAccount(mint: PublicKey, of: PublicKey, amount: bigint): AccountInfo<Buffer> {
  const data = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode(
    {
      mint,
      owner: of,
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
  return { owner: TOKEN_PROGRAM_ID, data, lamports: 2_039_280, executable: false, rentEpoch: 0 };
}

/** Everything that exists on the pretend chain, by address. */
let accounts: Record<string, AccountInfo<Buffer>>;
/** What the relay is asked, in order, and how it answers each method. */
let asked: { method: string; params?: Record<string, unknown> }[];
let relay: Record<string, (params: Record<string, unknown>) => Response | Promise<Response>>;
let available: boolean;
let sent: VersionedTransaction[];
let status: "confirmed" | "failed" | "absent";
let blockHeight: number;

const answer = (result: unknown) => Response.json({ result });
const refusal = (error: string, code = 422) => Response.json({ error }, { status: code });

/** Adds the fee payer's signature, as the relayer does: the same message, first slot filled. */
function coSigned(encoded: unknown) {
  const transaction = VersionedTransaction.deserialize(Buffer.from(encoded as string, "base64"));
  const feePayer = transaction.message.staticAccountKeys[0];
  transaction.sign([relayerKeys.find((key) => key.publicKey.equals(feePayer))!]);
  return Buffer.from(transaction.serialize()).toString("base64");
}

beforeEach(() => {
  accounts = {
    [ataFor(USDC, owner).toBase58()]: tokenAccount(USDC, owner, 100_000_000n),
    [ataFor(USDC, recipient).toBase58()]: tokenAccount(USDC, recipient, 0n),
  };
  asked = [];
  sent = [];
  available = true;
  status = "confirmed";
  blockHeight = LAST_VALID - 10;
  resetRelayerPins();
  relay = {
    // The first replica that the wallet has not just seen fail.
    getPayerSigner: (params) => {
      const not = (params.not as string[] | undefined) ?? [];
      const next = relayerKeys.find((key) => !not.includes(key.publicKey.toBase58()));
      return next
        ? answer({
            signer_address: next.publicKey.toBase58(),
            payment_address: paymentWallet.toBase58(),
          })
        : refusal("unavailable", 503);
    },
    estimateTransactionFee: () => answer({ fee_in_token: Number(FEE) }),
    signTransaction: (params) => answer({ signed_transaction: coSigned(params.transaction) }),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method || init.method === "GET") {
        return Response.json(
          available
            ? {
                available: true,
                feePayers: relayerKeys.map((key) => key.publicKey.toBase58()),
                paymentWallet: paymentWallet.toBase58(),
                accountCreation: true,
              }
            : { available: false },
        );
      }
      const call = JSON.parse(init.body as string) as {
        method: string;
        params?: Record<string, unknown>;
      };
      asked.push(call);
      return relay[call.method](call.params ?? {});
    }),
  );
  vi.spyOn(connection, "getAccountInfo").mockImplementation(
    async (address) => accounts[address.toBase58()] ?? null,
  );
  vi.spyOn(connection, "getBalance").mockResolvedValue(0);
  vi.spyOn(connection, "getMinimumBalanceForRentExemption").mockResolvedValue(890_880);
  vi.spyOn(connection, "getLatestBlockhash").mockResolvedValue({
    blockhash: Keypair.generate().publicKey.toBase58(),
    lastValidBlockHeight: LAST_VALID,
  });
  vi.spyOn(connection, "sendRawTransaction").mockImplementation(async (raw) => {
    sent.push(VersionedTransaction.deserialize(raw as Uint8Array));
    return "signature";
  });
  vi.spyOn(connection, "getBlockHeight").mockImplementation(async () => blockHeight);
  vi.spyOn(connection, "getSignatureStatus").mockImplementation(async () => ({
    context: { slot: 1 },
    value:
      status === "absent"
        ? null
        : {
            slot: 1,
            confirmations: 1,
            err: status === "failed" ? { InstructionError: [0, "Custom"] } : null,
            confirmationStatus: "confirmed",
          },
  }));
  vi.spyOn(presignGuard, "verifyBalancesBeforeSigning").mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const sendOf = (amount: number, to = recipient) => ({
  mint: USDC,
  decimals: 6,
  programId: TOKEN_PROGRAM_ID,
  owner,
  to,
  amount,
});
const build = (amount = 5, to = recipient) =>
  ((terms) => relayedSendDraft(sendOf(amount, to), terms)) as Parameters<typeof quoteRelayed>[1];
const run = (over: Partial<Parameters<typeof runRelayed>[0]> = {}) =>
  runRelayed({
    owner: portfolio,
    build: build(),
    reviewedFeeRaw: FEE,
    keepOut: [],
    stillUnlocked: () => true,
    ...over,
  });
const methods = () => asked.map((call) => call.method);
const terms = (feeRaw = FEE, pricing = false) => ({ feePayer: relayer.publicKey, feeRaw, pricing });

describe("building a relayer-paid send", () => {
  it("is the transfer alone when the recipient has an account for the token", async () => {
    const draft = await relayedSendDraft(sendOf(5), terms());
    expect(draft.opens).toBeNull();
    expect(draft.instructions).toHaveLength(1);
    expect(draft.intent).toMatchObject({ kind: "send", amountRaw: 5_000_000n });
  });

  it("opens the recipient's account, at the relayer's expense, only when it is missing", async () => {
    const stranger = Keypair.generate().publicKey;
    const draft = await relayedSendDraft(sendOf(5, stranger), terms());
    expect(draft.opens?.owner.equals(stranger)).toBe(true);
    expect(draft.instructions).toHaveLength(2);
    expect(draft.instructions[0].keys[0].pubkey.equals(relayer.publicKey)).toBe(true);

    const transaction = compileRelayed(
      draft,
      owner,
      relayer.publicKey,
      paymentWallet,
      2_263_208n,
      Keypair.generate().publicKey.toBase58(),
    );
    const { message } = transaction;
    expect(message.staticAccountKeys[0].equals(relayer.publicKey)).toBe(true);
    expect(message.staticAccountKeys[1].equals(owner)).toBe(true);
    expect(message.header.numRequiredSignatures).toBe(2);
    expect(
      message.compiledInstructions.some((instruction) =>
        message.staticAccountKeys[instruction.programIdIndex].equals(
          ComputeBudgetProgram.programId,
        ),
      ),
    ).toBe(false);
    // And it is a transaction the relay's own reading accepts.
    const reading = readRelayed(transaction, {
      feePayers: [relayer.publicKey],
      paymentWallet,
      accountCreation: true,
    });
    expect(reading.ok && reading.relayed.opens?.owner.equals(stranger)).toBe(true);
  });

  it("leaves room for the fee in a cash send: reduced while pricing, refused once the fee is known", async () => {
    const pricing = await relayedSendDraft(sendOf(100), terms(1n, true));
    expect(pricing.intent).toMatchObject({ amountRaw: 99_999_999n });
    await expect(relayedSendDraft(sendOf(100), terms())).rejects.toThrow(
      /once its network cost is paid/,
    );
    const max = await relayedSendDraft(sendOf(99.98), terms());
    expect(max.intent).toMatchObject({ amountRaw: 99_980_000n });
    expect(max.limits(FEE)).toMatchObject({
      maxCashSpent: 100_000_000n,
      exact: true,
      maxLamportsSpent: 0n,
    });
  });

  it("holds a tracker send to exactly its amount, and the recipient to exactly that gain", async () => {
    const { mint, programId, decimals } = tracker;
    accounts[ataFor(mint, owner, programId).toBase58()] = tokenAccount(mint, owner, 50_000_000n);
    accounts[ataFor(mint, recipient, programId).toBase58()] = tokenAccount(mint, recipient, 0n);
    const draft = await relayedSendDraft(
      { mint, programId, decimals, owner, to: recipient, amount: 0.1 },
      terms(),
    );
    const limits = draft.limits(FEE);
    expect(limits.maxCashSpent).toBe(FEE);
    expect(limits.alsoSpends?.maxAmount).toBe(10_000_000n);
    expect(limits.receive).toEqual({
      account: ataFor(mint, recipient, programId),
      minAmount: 10_000_000n,
    });
  });

  it("opens a portfolio's own holding with one instruction and nothing else", async () => {
    const draft = await relayedOpenDraft({ ...tracker, owner }, terms(2_370_392n));
    expect(draft.intent).toEqual({ kind: "open" });
    expect(draft.instructions).toHaveLength(1);
    expect(draft.opens?.owner.equals(owner)).toBe(true);
  });
});

describe("what the simulation must show", () => {
  const cashAccount = Keypair.generate().publicKey;
  const asset = Keypair.generate().publicKey;
  const theirs = Keypair.generate().publicKey;
  const limits = {
    cashAccount,
    maxCashSpent: 20_000n,
    alsoSpends: { account: asset, maxAmount: 500n },
    receive: { account: theirs, minAmount: 500n },
    exact: true,
    maxLamportsSpent: 0n,
    programs: [],
  };
  const snapshot = (cash: bigint, held: bigint, received: bigint, lamports = 0n) => ({
    lamports,
    tokens: new Map([
      [cashAccount.toBase58(), cash],
      [asset.toBase58(), held],
      [theirs.toBase58(), received],
    ]),
  });

  it("passes the fee leaving cash, the amount leaving the asset and arriving with the recipient", () => {
    expect(
      checkBalanceChanges(snapshot(100_000n, 900n, 0n), snapshot(80_000n, 400n, 500n), limits),
    ).toEqual({ ok: true });
  });

  it("refuses anything else: more, less, short delivery, or SOL leaving", () => {
    const before = snapshot(100_000n, 900n, 0n, 10n);
    for (const after of [
      snapshot(79_999n, 400n, 500n, 10n),
      snapshot(80_001n, 400n, 500n, 10n),
      snapshot(80_000n, 399n, 500n, 10n),
      snapshot(80_000n, 400n, 499n, 10n),
      snapshot(80_000n, 400n, 501n, 10n),
      snapshot(80_000n, 400n, 500n, 9n),
    ]) {
      expect(checkBalanceChanges(before, after, limits).ok).toBe(false);
    }
  });
});

describe("pricing an action with the relayer", () => {
  it("asks which fee payer, then for the fee of a draft built against it", async () => {
    const quote = await quoteRelayed(owner, build());
    expect(quote).toEqual({ feeRaw: FEE, opensAccount: false });
    expect(methods()).toEqual(["getPayerSigner", "estimateTransactionFee"]);
    expect(asked[1].params).toMatchObject({
      fee_token: usdcMint(),
      signer_key: relayer.publicKey.toBase58(),
    });
    expect(sent).toHaveLength(0);
  });

  it("is unavailable when there is no relayer, with nothing asked of it", async () => {
    available = false;
    await expect(quoteRelayed(owner, build())).rejects.toBeInstanceOf(RelayerUnavailableError);
    expect(asked).toHaveLength(0);
  });

  it("refuses a fee payer or a fee outside what the app accepts", async () => {
    relay.getPayerSigner = () =>
      answer({
        signer_address: Keypair.generate().publicKey.toBase58(),
        payment_address: paymentWallet.toBase58(),
      });
    await expect(quoteRelayed(owner, build())).rejects.toThrow();
    expect(methods()).toEqual(["getPayerSigner"]);
  });

  it("refuses a fee above the cap", async () => {
    relay.estimateTransactionFee = () => answer({ fee_in_token: 50_001 });
    await expect(quoteRelayed(owner, build())).rejects.toBeInstanceOf(RelayerUnavailableError);
  });
});

describe("running a relayer-paid action", () => {
  it("signs, has the relayer sign, sends what came back and reports the fee payer's signature", async () => {
    const signature = await run();
    expect(methods()).toEqual(["getPayerSigner", "signTransaction"]);
    expect(sent).toHaveLength(1);
    expect(sent[0].message.staticAccountKeys[0].equals(relayer.publicKey)).toBe(true);
    expect(sent[0].signatures.every((bytes) => bytes.some((byte) => byte !== 0))).toBe(true);
    expect(signature).not.toBe("signature");
    expect(signature.length).toBeGreaterThan(80);
  });

  it("signs nothing when the wallet locked in the meantime", async () => {
    await expect(run({ stillUnlocked: () => false })).rejects.toMatchObject({
      code: "walletLocked",
    });
    expect(methods()).toEqual(["getPayerSigner"]);
  });

  it("signs nothing the simulation does not bear out", async () => {
    vi.mocked(presignGuard.verifyBalancesBeforeSigning).mockResolvedValue({
      ok: false,
      reason: "This transaction would also move another asset. Not signed.",
    });
    await expect(run()).rejects.toThrow(/Not signed/);
    expect(methods()).toEqual(["getPayerSigner"]);
  });

  it("signs nothing that names another of the wallet's addresses", async () => {
    await expect(run({ keepOut: [recipient] })).rejects.toThrow(/would link them/);
    expect(methods()).toEqual(["getPayerSigner"]);
  });

  it("falls back, before anything is signed, when the relayer does not answer", async () => {
    relay.getPayerSigner = () => refusal("unavailable", 503);
    await expect(run()).rejects.toBeInstanceOf(RelayerUnavailableError);
    expect(sent).toHaveLength(0);
  });

  it("falls back when the relayer refuses to sign, without trying again", async () => {
    relay.signTransaction = () => refusal("refused");
    await expect(run()).rejects.toBeInstanceOf(RelayerUnavailableError);
    expect(methods()).toEqual(["getPayerSigner", "signTransaction"]);
    expect(sent).toHaveLength(0);
  });

  it("asks for the fee once more when the payment was too small, and never pays more than was reviewed", async () => {
    relay.signTransaction = () => refusal("insufficient_payment");
    relay.estimateTransactionFee = () => answer({ fee_in_token: Number(FEE) + 1 });
    const rose = await run().catch((error: unknown) => error);
    expect(rose).toBeInstanceOf(RelayerFeeRoseError);
    expect((rose as RelayerFeeRoseError).feeRaw).toBe(FEE + 1n);
    expect(methods()).toEqual(["getPayerSigner", "signTransaction", "estimateTransactionFee"]);
    expect(sent).toHaveLength(0);
  });

  it("signs the same payment again when the fee is back within what was reviewed, once", async () => {
    let attempts = 0;
    relay.signTransaction = (params) => {
      attempts += 1;
      return attempts === 1
        ? refusal("insufficient_payment")
        : answer({ signed_transaction: coSigned(params.transaction) });
    };
    await run();
    expect(methods()).toEqual([
      "getPayerSigner",
      "signTransaction",
      "estimateTransactionFee",
      "getPayerSigner",
      "signTransaction",
    ]);
    expect(sent).toHaveLength(1);

    asked = [];
    relay.signTransaction = () => refusal("insufficient_payment");
    await expect(run()).rejects.toBeInstanceOf(RelayerUnavailableError);
    expect(methods().filter((method) => method === "signTransaction")).toHaveLength(2);
  });

  it("builds again against another replica only when the first is certain never to have had the transaction", async () => {
    const downed = relayer.publicKey.toBase58();
    relay.signTransaction = (params) =>
      params.signer_key === downed
        ? refusal("unavailable", 503)
        : answer({ signed_transaction: coSigned(params.transaction) });
    await run();
    expect(methods()).toEqual([
      "getPayerSigner",
      "signTransaction",
      "getPayerSigner",
      "signTransaction",
    ]);
    expect(asked[2].params).toEqual({ not: [downed] });
    // The guard ran again on the rebuilt transaction before the portfolio signed it.
    expect(presignGuard.verifyBalancesBeforeSigning).toHaveBeenCalledTimes(2);
    expect(sent).toHaveLength(1);
    expect(sent[0].message.staticAccountKeys[0].equals(secondRelayer.publicKey)).toBe(true);
    // The same fee, to the unit: what was reviewed.
    const reading = readRelayed(sent[0], {
      feePayers: relayerKeys.map((key) => key.publicKey),
      paymentWallet,
      accountCreation: true,
    });
    expect(reading.ok && reading.relayed.feeRaw).toBe(FEE);
  });

  it("is not available, with nothing sent, when no replica can be reached to sign", async () => {
    relay.signTransaction = () => refusal("unavailable", 503);
    await expect(run()).rejects.toBeInstanceOf(RelayerUnavailableError);
    expect(methods().filter((method) => method === "signTransaction")).toHaveLength(2);
    expect(sent).toHaveLength(0);
  });

  it.each([
    ["answers with a failure", () => refusal("no_answer", 502)],
    ["times out", () => refusal("timeout", 504)],
    [
      "drops the connection",
      () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])(
    "signs nothing more when the replica it sent a signed transaction to %s",
    async (_how, respond) => {
      relay.signTransaction = respond;
      const error = await run().catch((caught: unknown) => caught);
      // It may hold a complete transaction. A second one, signed for another
      // replica, could land beside it: the same send twice.
      expect(error).toBeInstanceOf(UnknownOutcomeError);
      expect((error as UnknownOutcomeError).lastValidBlockHeight).toBe(LAST_VALID);
      expect(methods()).toEqual(["getPayerSigner", "signTransaction"]);
      expect(presignGuard.verifyBalancesBeforeSigning).toHaveBeenCalledTimes(1);
      expect(sent).toHaveLength(0);
    },
  );

  it("prices against another replica when the first does not answer", async () => {
    const downed = relayer.publicKey.toBase58();
    relay.estimateTransactionFee = (params) =>
      params.signer_key === downed
        ? refusal("no_answer", 502)
        : answer({ fee_in_token: Number(FEE) });
    expect(await quoteRelayed(owner, build())).toEqual({ feeRaw: FEE, opensAccount: false });
    expect(methods()).toEqual([
      "getPayerSigner",
      "estimateTransactionFee",
      "getPayerSigner",
      "estimateTransactionFee",
    ]);
  });

  it("refuses to send a transaction the relayer changed", async () => {
    relay.signTransaction = async () => {
      const other = await relayedSendDraft(sendOf(6), terms());
      const transaction = compileRelayed(
        other,
        owner,
        relayer.publicKey,
        paymentWallet,
        FEE,
        Keypair.generate().publicKey.toBase58(),
      );
      transaction.sign([relayer, portfolio]);
      return answer({
        signed_transaction: Buffer.from(transaction.serialize()).toString("base64"),
      });
    };
    await expect(run()).rejects.toThrow(/different transaction/);
    expect(sent).toHaveLength(0);
  });

  it("reports an unknown outcome with what is needed to settle it, never a failure", async () => {
    status = "absent";
    vi.spyOn(connection, "sendRawTransaction").mockRejectedValue(new Error("network down"));
    const error = await run().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnknownOutcomeError);
    expect((error as UnknownOutcomeError).signature).toBeTruthy();
    expect((error as UnknownOutcomeError).lastValidBlockHeight).toBe(LAST_VALID);
  });

  it("reports one the chain shows did not land as that, so it can be offered the other way", async () => {
    status = "failed";
    await expect(run()).rejects.toBeInstanceOf(RelayedNotLandedError);
  });
});

describe("the transaction the relayer returns", () => {
  it("is accepted only as the signed one with the fee payer's signature added", async () => {
    const draft = await relayedSendDraft(sendOf(5), terms());
    const signed = compileRelayed(
      draft,
      owner,
      relayer.publicKey,
      paymentWallet,
      FEE,
      Keypair.generate().publicKey.toBase58(),
    );
    signed.sign([portfolio]);
    const encode = (transaction: VersionedTransaction) =>
      Buffer.from(transaction.serialize()).toString("base64");

    expect(checkCoSigned(coSigned(encode(signed)), signed)).not.toBeNull();
    // The fee payer's slot still empty.
    expect(checkCoSigned(encode(signed), signed)).toBeNull();
    // The portfolio's signature replaced.
    const tampered = VersionedTransaction.deserialize(signed.serialize());
    tampered.sign([relayer]);
    tampered.signatures[1] = new Uint8Array(64).fill(7);
    expect(checkCoSigned(encode(tampered), signed)).toBeNull();
    expect(checkCoSigned("not base64 of a transaction", signed)).toBeNull();
  });
});

describe("choosing how a network cost is met", () => {
  const SEND_LAMPORTS = 5_000;
  const chain: CostChain = {
    balance: (address) => connection.getBalance(new PublicKey(address)),
    shortfall: shortfallFor,
  };
  const planCost = (need: Parameters<typeof planNetworkCost>[0]) => planNetworkCost(need, chain);
  const planSend = (send: Parameters<typeof planSendCost>[0]) => planSendCost(send, chain);
  const need = (over: Partial<Parameters<typeof planNetworkCost>[0]> = {}) => ({
    owner: owner.toBase58(),
    lamportsNeeded: SEND_LAMPORTS,
    cashFree: 50,
    ...over,
  });
  const quoting = (feeRaw: bigint, opensAccount = false) => ({
    quote: vi.fn(async () => ({ feeRaw, opensAccount })),
    opens: "recipient" as const,
  });

  it("is nothing to meet when the action costs the portfolio nothing", async () => {
    expect(await planCost(need({ lamportsNeeded: 0 }))).toEqual({ kind: "covered" });
  });

  it("has the relayer pay whenever it can, whatever SOL the portfolio holds", async () => {
    vi.mocked(connection.getBalance).mockResolvedValue(10_000_000);
    expect(await planCost(need({ solPrice: 200, relayer: quoting(FEE) }))).toEqual({
      kind: "relayer",
      fee: 0.02,
      feeRaw: FEE,
      opens: null,
      count: 1,
    });
    expect(await planCost(need({ relayer: quoting(2_263_208n, true) }))).toMatchObject({
      kind: "relayer",
      opens: "recipient",
    });
  });

  it("is simply not available when the relayer cannot be used and the portfolio holds no SOL", async () => {
    const failing = {
      quote: vi.fn(async () => {
        throw new RelayerUnavailableError();
      }),
      opens: "recipient" as const,
    };
    expect(await planCost(need({ solPrice: 200, relayer: failing }))).toEqual({
      kind: "unavailable",
    });
    expect(await planCost(need({ solPrice: 200 }))).toEqual({ kind: "unavailable" });
  });

  it("falls to the portfolio's own SOL only then, and says what that comes to in dollars", async () => {
    vi.mocked(connection.getBalance).mockResolvedValue(10_000_000);
    const cost = await planCost(need({ lamportsNeeded: 50_000, solPrice: 200 }));
    expect(cost).toEqual({ kind: "ownSol", usd: 0.01 });
    const shown = (shownCost: NetworkCost) =>
      networkCostView({ cost: shownCost, pending: { blocked: false }, submitting: false });
    expect(shown(cost).value).toBe("about 0.01 USD, paid from this portfolio's SOL balance");
    expect(shown(await planCost(need({ solPrice: 200 }))).value).toBe(
      "less than 0.01 USD, paid from this portfolio's SOL balance",
    );
    expect(shown(cost).confirmDisabled).toBe(false);
  });

  it("does not spend SOL it cannot state the worth of", async () => {
    vi.mocked(connection.getBalance).mockResolvedValue(10_000_000);
    expect(await planCost(need())).toEqual({ kind: "unavailable" });
  });

  it("says how much cash is missing when the relayer's fee cannot be paid", async () => {
    expect(await planCost(need({ cashFree: 0.01, relayer: quoting(FEE) }))).toEqual({
      kind: "needsCash",
      cash: 0.02,
      free: 0.01,
    });
  });

  it("lets a withdrawal pay the relayer out of what it returns, with no cash at all beforehand", async () => {
    const relayerOption = { ...quoting(FEE), paidFromProceeds: true };
    expect(await planCost(need({ cashFree: 0, relayer: relayerOption }))).toMatchObject({
      kind: "relayer",
      feeRaw: FEE,
    });
  });

  it("charges a pie once for each holding it opens", async () => {
    const relayerOption = { ...quoting(2_370_392n, true), opens: "holding" as const, count: 3 };
    expect(await planCost(need({ relayer: relayerOption }))).toEqual({
      kind: "relayer",
      fee: 7.111176,
      feeRaw: 2_370_392n,
      opens: "holding",
      count: 3,
    });
    expect(await planCost(need({ cashFree: 7, relayer: relayerOption }))).toMatchObject({
      kind: "needsCash",
    });
  });

  it("sends the rest when all of a portfolio's cash is sent and the relayer's fee comes out of it", async () => {
    const relayerQuote = vi.fn(async () => ({ feeRaw: FEE, opensAccount: false }));
    const plan = await planSend({
      owner: owner.toBase58(),
      lamportsNeeded: SEND_LAMPORTS,
      isCash: true,
      amount: 100,
      held: 100,
      cashHeld: 100,
      decimals: 6,
      relayerQuote,
    });
    expect(plan.amount).toBe(99.98);
    expect(plan.cost).toMatchObject({ kind: "relayer", fee: 0.02 });
    expect(relayerQuote).toHaveBeenCalledTimes(1);
  });

  it("does not quietly reduce any other amount that leaves too little for the fee", async () => {
    const plan = await planSend({
      owner: owner.toBase58(),
      lamportsNeeded: SEND_LAMPORTS,
      isCash: true,
      amount: 99.99,
      held: 100,
      cashHeld: 100,
      decimals: 6,
      relayerQuote: async () => ({ feeRaw: FEE, opensAccount: false }),
    });
    expect(plan.amount).toBe(99.99);
    expect(plan.cost.kind).toBe("needsCash");
  });

  it("takes the fee of a tracker send from cash, and leaves the tracker amount alone", async () => {
    const plan = await planSend({
      owner: owner.toBase58(),
      lamportsNeeded: SEND_LAMPORTS,
      isCash: false,
      amount: 3,
      held: 3,
      cashHeld: 10,
      decimals: 8,
      relayerQuote: async () => ({ feeRaw: FEE, opensAccount: false }),
    });
    expect(plan).toMatchObject({ amount: 3, cost: { kind: "relayer" } });
  });

  it("sends all of it, untouched, when the portfolio pays the network itself", async () => {
    vi.mocked(connection.getBalance).mockResolvedValue(10_000_000);
    const plan = await planSend({
      owner: owner.toBase58(),
      lamportsNeeded: SEND_LAMPORTS,
      isCash: true,
      amount: 100,
      held: 100,
      cashHeld: 100,
      decimals: 6,
      solPrice: 200,
    });
    expect(plan).toMatchObject({ amount: 100, cost: { kind: "ownSol" } });
  });
});

describe("a transaction that was sent and not confirmed", () => {
  let blockhashValid: boolean;
  beforeEach(() => {
    blockhashValid = true;
    vi.spyOn(connection, "isBlockhashValid").mockImplementation(async () => ({
      context: { slot: 1 },
      value: blockhashValid,
    }));
  });

  it("is landed when the chain shows it, expired when it failed or its blockhash expired with no trace", async () => {
    const sent: SentUnconfirmed = { signature: "sig", lastValidBlockHeight: LAST_VALID };
    expect(await settle(sent)).toBe("landed");
    status = "failed";
    expect(await settle(sent)).toBe("expired");
    status = "absent";
    expect(await settle(sent)).toBe("pending");
    blockHeight = LAST_VALID + 1;
    expect(await settle(sent)).toBe("expired");
  });

  it("is still landed if it shows up just as its blockhash expires", async () => {
    blockHeight = LAST_VALID + 1;
    expect(await settle({ signature: "sig", lastValidBlockHeight: LAST_VALID })).toBe("landed");
  });

  it("with no id to look up, waits for the chain to pass its last valid block, and nothing less", async () => {
    expect(await settle({ lastValidBlockHeight: LAST_VALID })).toBe("pending");
    blockHeight = LAST_VALID + 1;
    expect(await settle({ lastValidBlockHeight: LAST_VALID })).toBe("expired");
    vi.mocked(connection.getBlockHeight).mockRejectedValue(new Error("down"));
    expect(await settle({ lastValidBlockHeight: LAST_VALID })).toBe("pending");
  });

  it("with no height, goes by whether the chain still accepts its blockhash", async () => {
    status = "absent";
    expect(await settle({ blockhash: "hash" })).toBe("pending");
    blockhashValid = false;
    expect(await settle({ blockhash: "hash" })).toBe("expired");
    expect(await settle({ signature: "sig", blockhash: "hash" })).toBe("expired");
    status = "confirmed";
    expect(await settle({ signature: "sig", blockhash: "hash" })).toBe("landed");
  });

  it("is never released by time: with nothing to settle it by it is unknown, however long ago", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    status = "absent";
    expect(await settle({})).toBe("unknown");
    expect(await settle({ signature: "sig" })).toBe("unknown");
    status = "confirmed";
    expect(await settle({ signature: "sig" })).toBe("landed");
    vi.useRealTimers();
  });
});

describe("what never appears in a relayer-paid transaction", () => {
  it("is a System instruction: the recipient is checked to be a wallet before anything is built", async () => {
    accounts[recipient.toBase58()] = {
      owner: SystemProgram.programId,
      data: Buffer.alloc(0),
      lamports: 1,
      executable: true,
      rentEpoch: 0,
    };
    await expect(relayedSendDraft(sendOf(5), terms())).rejects.toThrow(/program's address/);
  });
});
