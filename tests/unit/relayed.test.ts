import { describe, expect, it } from "vitest";
import {
  ACCOUNT_SIZE,
  ExtensionType,
  getAccountLen,
  createApproveInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  createTransferCheckedInstruction,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { usdcMint } from "../../src/infrastructure/solana/config.js";
import {
  lamportsInUsdc,
  LEND_PROGRAM,
  LEND_RECEIPT_MINT,
  MAX_RELAYER_FEE_OPENING_RAW,
  MAX_RELAYER_FEE_RAW,
  readRelayed,
  relayedCostLamports,
  type RelayerPins,
} from "../../src/infrastructure/solana/relayed.js";
import {
  checkRelayedIntent,
  type RelayedExpectation,
} from "../../src/infrastructure/solana/relayer.js";
import { ALL_STOCKS } from "../../src/infrastructure/solana/tokenRegistry.js";
import { ataFor } from "../../src/infrastructure/solana/tokens.js";

/**
 * A relayer-paid transaction is one of a few exact shapes or it is refused.
 * The same reading decides that for the relay route, which anyone can call,
 * and for the wallet before a portfolio signs. These build the genuine
 * shapes and then every hostile variation of them, and hold both readers to
 * the same answer.
 */

const USDC = new PublicKey(usdcMint());
const tracker = ALL_STOCKS[0];
const PLAIN_FEE = 20_000n;
/** Rent as the chain charges it: 6,960 lamports for each byte, and for 128 bytes of overhead. */
const rentOf = (bytes: number) => (bytes + 128) * 6_960;
/** What opening an account of `bytes` costs: its rent and a tenth more, and twice the network fee. */
const openingFee = (bytes: number) => PLAIN_FEE + (BigInt(rentOf(bytes)) * 11n) / 10n;
const OPENING_FEE = openingFee(ACCOUNT_SIZE);
/** The trackers' mints carry a transfer hook slot, so each of their accounts carries its counterpart. */
const TRACKER_ACCOUNT = getAccountLen([
  ExtensionType.ImmutableOwner,
  ExtensionType.TransferHookAccount,
]);
const TRACKER_OPENING_FEE = openingFee(TRACKER_ACCOUNT);

const relayer = Keypair.generate();
const paymentWallet = Keypair.generate().publicKey;
const portfolio = Keypair.generate();
const recipient = Keypair.generate().publicKey;
const funding = Keypair.generate().publicKey;
const sibling = Keypair.generate().publicKey;

const pins: RelayerPins = {
  feePayers: [relayer.publicKey],
  paymentWallet,
  accountCreation: true,
};

const owner = portfolio.publicKey;
const cash = ataFor(USDC, owner);
const paymentAccount = ataFor(USDC, paymentWallet);

function payment(feeRaw: bigint, to = paymentAccount, mint = USDC, from = cash) {
  return createTransferCheckedInstruction(from, mint, to, owner, feeRaw, 6);
}

function sendUsdc(amountRaw = 5_000_000n, to = recipient) {
  return createTransferCheckedInstruction(cash, USDC, ataFor(USDC, to), owner, amountRaw, 6);
}

function sendTracker(amountRaw = 1_000_000n, to = recipient) {
  const { mint, programId, decimals } = tracker;
  return createTransferCheckedInstruction(
    ataFor(mint, owner, programId),
    mint,
    ataFor(mint, to, programId),
    owner,
    amountRaw,
    decimals,
    undefined,
    programId,
  );
}

function open(account: PublicKey, of: PublicKey, mint: PublicKey, programId = TOKEN_PROGRAM_ID) {
  return createAssociatedTokenAccountIdempotentInstruction(
    relayer.publicKey,
    account,
    of,
    mint,
    programId,
  );
}

const LEND_VAULT = {
  deposit: [
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "5nmGjA4s7ATzpBQXC5RNceRpaJ7pYw2wKsNBWyuSAZV6",
    "2vVYHYM8VYnvZqQWpTJSj8o8DBf1wM8pVs3bsTgYZiqJ",
    "9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D",
    "94vK29npVbyRHXH63rRcTiSr26SFhrQTzbpNJuhQEDu",
    "Hf9gtkM4dpVBahVSzEXSVCAPpKzBsBcns3s8As3z77oF",
    "5pjzT5dFTsXcwixoab1QDLvZQvpYJxJeBphkyfHGn688",
    "BmkUoKMFYBxNSzWXyUjyMJjMAaVz4d8ZnxwwmhDCUXFB",
    "7s1da8DduuBFqGra5bJBjpnvL5E9mGzCuMk1Qkh4or2Z",
    "jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC",
    "5xSPBiD3TibamAnwHDhZABdB4z4F9dcj5PnbteroBTTd",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
    "11111111111111111111111111111111",
  ],
  withdraw: [
    "5nmGjA4s7ATzpBQXC5RNceRpaJ7pYw2wKsNBWyuSAZV6",
    "2vVYHYM8VYnvZqQWpTJSj8o8DBf1wM8pVs3bsTgYZiqJ",
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D",
    "94vK29npVbyRHXH63rRcTiSr26SFhrQTzbpNJuhQEDu",
    "Hf9gtkM4dpVBahVSzEXSVCAPpKzBsBcns3s8As3z77oF",
    "5pjzT5dFTsXcwixoab1QDLvZQvpYJxJeBphkyfHGn688",
    "BmkUoKMFYBxNSzWXyUjyMJjMAaVz4d8ZnxwwmhDCUXFB",
    "HN1r4VfkDn53xQQfeGDYrNuDKFdemAhZsHYRwBrFhsW",
    "7s1da8DduuBFqGra5bJBjpnvL5E9mGzCuMk1Qkh4or2Z",
    "jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC",
    "5xSPBiD3TibamAnwHDhZABdB4z4F9dcj5PnbteroBTTd",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
    "11111111111111111111111111111111",
  ],
};
const LEND_DISCRIMINATOR = {
  deposit: [0xf2, 0x23, 0xc6, 0x89, 0x52, 0xe1, 0xf2, 0xb6],
  withdraw: [0xb7, 0x12, 0x46, 0x9c, 0x94, 0x6d, 0xa1, 0x22],
};

/** Jupiter Lend's instruction as its API builds it, for `depositor`. */
function lend(kind: "deposit" | "withdraw", amountRaw = 7_000_000n, depositor = owner) {
  const data = Buffer.alloc(16);
  Buffer.from(LEND_DISCRIMINATOR[kind]).copy(data);
  data.writeBigUInt64LE(amountRaw, 8);
  const own =
    kind === "deposit"
      ? [ataFor(USDC, depositor), ataFor(LEND_RECEIPT_MINT, depositor)]
      : [ataFor(LEND_RECEIPT_MINT, depositor), ataFor(USDC, depositor)];
  return new TransactionInstruction({
    programId: LEND_PROGRAM,
    keys: [
      { pubkey: depositor, isSigner: true, isWritable: true },
      ...own.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })),
      ...LEND_VAULT[kind].map((key) => ({
        pubkey: new PublicKey(key),
        isSigner: false,
        isWritable: false,
      })),
    ],
    data,
  });
}

function compile(instructions: TransactionInstruction[], payer = relayer.publicKey) {
  return new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions,
    }).compileToLegacyMessage(),
  );
}

const genuine = {
  sendUsdc: () => compile([sendUsdc(), payment(PLAIN_FEE)]),
  sendTracker: () => compile([sendTracker(), payment(PLAIN_FEE)]),
  sendToNew: () =>
    compile([open(ataFor(USDC, recipient), recipient, USDC), sendUsdc(), payment(OPENING_FEE)]),
  deposit: () => compile([lend("deposit"), payment(PLAIN_FEE)]),
  firstDeposit: () =>
    compile([
      open(ataFor(LEND_RECEIPT_MINT, owner), owner, LEND_RECEIPT_MINT),
      lend("deposit"),
      payment(OPENING_FEE),
    ]),
  withdraw: () => compile([lend("withdraw"), payment(PLAIN_FEE)]),
  withdrawToNoAccount: () =>
    compile([open(cash, owner, USDC), lend("withdraw"), payment(OPENING_FEE)]),
  openHolding: () =>
    compile([
      open(ataFor(tracker.mint, owner, tracker.programId), owner, tracker.mint, tracker.programId),
      payment(TRACKER_OPENING_FEE),
    ]),
};

/** Every transaction that is not a relayer-paid one, with the fixed reason it is refused for. */
const hostile: Record<string, [() => VersionedTransaction, string]> = {
  "a fee payer that is not pinned": [
    () => compile([sendUsdc(), payment(PLAIN_FEE)], Keypair.generate().publicKey),
    "fee_payer_not_pinned",
  ],
  "a third signer": [
    () => {
      const transfer = sendUsdc();
      transfer.keys.push({
        pubkey: Keypair.generate().publicKey,
        isSigner: true,
        isWritable: false,
      });
      return compile([transfer, payment(PLAIN_FEE)]);
    },
    "signers",
  ],
  "no portfolio signing at all": [
    () =>
      compile([
        new TransactionInstruction({
          programId: TOKEN_PROGRAM_ID,
          keys: [],
          data: Buffer.alloc(1),
        }),
        new TransactionInstruction({
          programId: TOKEN_PROGRAM_ID,
          keys: [],
          data: Buffer.alloc(1),
        }),
      ]),
    "signers",
  ],
  "a lookup table": [
    () =>
      new VersionedTransaction(
        new TransactionMessage({
          payerKey: relayer.publicKey,
          recentBlockhash: Keypair.generate().publicKey.toBase58(),
          instructions: [sendUsdc(), payment(PLAIN_FEE)],
        }).compileToV0Message([
          new AddressLookupTableAccount({
            key: Keypair.generate().publicKey,
            state: {
              deactivationSlot: 0n,
              lastExtendedSlot: 0,
              lastExtendedSlotStartIndex: 0,
              addresses: [ataFor(USDC, recipient)],
            },
          }),
        ]),
      ),
    "lookup_table",
  ],
  "a priority fee": [
    () =>
      compile([
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 }),
        sendUsdc(),
        payment(PLAIN_FEE),
      ]),
    "compute_budget",
  ],
  "a raw System transfer of the fee payer's SOL": [
    () =>
      compile([
        SystemProgram.transfer({ fromPubkey: relayer.publicKey, toPubkey: owner, lamports: 1 }),
        payment(PLAIN_FEE),
      ]),
    "system_instruction",
  ],
  "a durable nonce": [
    () =>
      compile([
        SystemProgram.nonceAdvance({
          noncePubkey: Keypair.generate().publicKey,
          authorizedPubkey: owner,
        }),
        sendUsdc(),
        payment(PLAIN_FEE),
      ]),
    "system_instruction",
  ],
  "no payment": [() => compile([sendUsdc(), sendUsdc(1n)]), "payment"],
  "a second payment": [() => compile([payment(PLAIN_FEE), payment(PLAIN_FEE)]), "payment"],
  "a payment above the cap": [
    () => compile([sendUsdc(), payment(MAX_RELAYER_FEE_RAW + 1n)]),
    "payment_above_cap",
  ],
  "an opening payment above its cap": [
    () =>
      compile([
        open(ataFor(USDC, recipient), recipient, USDC),
        sendUsdc(),
        payment(MAX_RELAYER_FEE_OPENING_RAW + 1n),
      ]),
    "payment_above_cap",
  ],
  "a payment to another account": [
    () => compile([sendUsdc(), payment(PLAIN_FEE, ataFor(USDC, Keypair.generate().publicKey))]),
    "payment",
  ],
  "a payment to the fee payer's own account": [
    () => compile([sendUsdc(), payment(PLAIN_FEE, ataFor(USDC, relayer.publicKey))]),
    "payment",
  ],
  "a payment in another token": [
    () =>
      compile([
        sendUsdc(),
        createTransferCheckedInstruction(
          ataFor(tracker.mint, owner, tracker.programId),
          tracker.mint,
          ataFor(tracker.mint, paymentWallet, tracker.programId),
          owner,
          PLAIN_FEE,
          tracker.decimals,
          undefined,
          tracker.programId,
        ),
      ]),
    "payment",
  ],
  "a payment out of an account that is not the portfolio's own": [
    () =>
      compile([sendUsdc(), payment(PLAIN_FEE, paymentAccount, USDC, Keypair.generate().publicKey)]),
    "payment",
  ],
  "an extra instruction": [
    () => compile([sendUsdc(), sendUsdc(1n), sendUsdc(2n), payment(PLAIN_FEE)]),
    "instruction_count",
  ],
  "a program outside the shapes (Memo)": [
    () =>
      compile([
        new TransactionInstruction({
          programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
          keys: [],
          data: Buffer.from("hi"),
        }),
        payment(PLAIN_FEE),
      ]),
    "action",
  ],
  "an approval in place of the action": [
    () =>
      compile([
        createApproveInstruction(cash, Keypair.generate().publicKey, owner, 1n),
        payment(1n),
      ]),
    "action",
  ],
  "a CloseAccount in place of the action": [
    () => compile([createCloseAccountInstruction(cash, owner, owner), payment(PLAIN_FEE)]),
    "action",
  ],
  "an account opened and then closed": [
    () => {
      const account = ataFor(tracker.mint, owner, tracker.programId);
      return compile([
        open(account, owner, tracker.mint, tracker.programId),
        createCloseAccountInstruction(account, owner, owner, [], TOKEN_2022_PROGRAM_ID),
        payment(OPENING_FEE),
      ]);
    },
    "action",
  ],
  "a send out of an account the portfolio does not own": [
    () =>
      compile([
        createTransferCheckedInstruction(
          ataFor(USDC, Keypair.generate().publicKey),
          USDC,
          ataFor(USDC, recipient),
          owner,
          1n,
          6,
        ),
        payment(PLAIN_FEE),
      ]),
    "action",
  ],
  "a send of a token the app does not list": [
    () => {
      const mint = Keypair.generate().publicKey;
      return compile([
        createTransferCheckedInstruction(
          ataFor(mint, owner),
          mint,
          ataFor(mint, recipient),
          owner,
          1n,
          6,
        ),
        payment(PLAIN_FEE),
      ]);
    },
    "action",
  ],
  "a send on the fee payer's authority": [
    () =>
      compile([
        createTransferCheckedInstruction(
          ataFor(USDC, relayer.publicKey),
          USDC,
          cash,
          relayer.publicKey,
          1n,
          6,
        ),
        payment(PLAIN_FEE),
      ]),
    "fee_payer_named",
  ],
  "a Lend deposit of the fee payer's own funds": [
    () => compile([lend("deposit", 1_000n, relayer.publicKey), payment(PLAIN_FEE)]),
    "fee_payer_named",
  ],
  "a Lend instruction with one account swapped": [
    () => {
      const instruction = lend("deposit");
      instruction.keys[5].pubkey = Keypair.generate().publicKey;
      return compile([instruction, payment(PLAIN_FEE)]);
    },
    "action",
  ],
  "a Lend instruction for somebody else's token accounts": [
    () => {
      const instruction = lend("withdraw");
      instruction.keys[2].pubkey = ataFor(USDC, Keypair.generate().publicKey);
      return compile([instruction, payment(PLAIN_FEE)]);
    },
    "action",
  ],
  "another Lend instruction": [
    () => {
      const instruction = lend("deposit");
      instruction.data = Buffer.concat([Buffer.alloc(8, 7), instruction.data.subarray(8)]);
      return compile([instruction, payment(PLAIN_FEE)]);
    },
    "action",
  ],
  "an account opened for a stranger": [
    () => {
      const stranger = Keypair.generate().publicKey;
      return compile([
        open(ataFor(USDC, stranger), stranger, USDC),
        sendUsdc(),
        payment(OPENING_FEE),
      ]);
    },
    "account_creation",
  ],
  "an account opened for a token the app does not hold": [
    () => {
      const mint = Keypair.generate().publicKey;
      return compile([open(ataFor(mint, owner), owner, mint), payment(OPENING_FEE)]);
    },
    "account_creation",
  ],
  "the portfolio's own USDC account opened on its own": [
    () => compile([open(cash, owner, USDC), payment(OPENING_FEE)]),
    "account_creation",
  ],
  "a deposit that opens a tracker account": [
    () =>
      compile([
        open(
          ataFor(tracker.mint, owner, tracker.programId),
          owner,
          tracker.mint,
          tracker.programId,
        ),
        lend("deposit"),
        payment(OPENING_FEE),
      ]),
    "account_creation",
  ],
  "two accounts opened": [
    () => {
      const other = Keypair.generate().publicKey;
      return compile([
        open(ataFor(USDC, recipient), recipient, USDC),
        open(ataFor(USDC, other), other, USDC),
        payment(OPENING_FEE),
      ]);
    },
    "fee_payer_named",
  ],
  "a plain Create in place of CreateIdempotent": [
    () =>
      compile([
        createAssociatedTokenAccountInstruction(
          relayer.publicKey,
          ataFor(USDC, recipient),
          recipient,
          USDC,
        ),
        sendUsdc(),
        payment(OPENING_FEE),
      ]),
    "account_creation",
  ],
  "an account opened at an address that is not the owner's": [
    () => {
      const instruction = open(ataFor(USDC, recipient), recipient, USDC);
      instruction.keys[2].pubkey = Keypair.generate().publicKey;
      return compile([instruction, sendUsdc(), payment(OPENING_FEE)]);
    },
    "account_creation",
  ],
};

describe("reading a relayer-paid transaction", () => {
  it("reads each genuine shape, with what it pays and what it does", () => {
    const read = (transaction: VersionedTransaction) => {
      const reading = readRelayed(transaction, pins);
      if (!reading.ok) throw new Error(reading.reason);
      return reading.relayed;
    };

    const send = read(genuine.sendUsdc());
    expect(send.feePayer.equals(relayer.publicKey)).toBe(true);
    expect(send.portfolio.equals(owner)).toBe(true);
    expect(send.feeRaw).toBe(PLAIN_FEE);
    expect(send.opens).toBeNull();
    expect(send.action).toMatchObject({ kind: "send", amountRaw: 5_000_000n });

    expect(read(genuine.sendTracker()).action).toMatchObject({
      kind: "send",
      amountRaw: 1_000_000n,
    });
    expect(read(genuine.sendToNew()).opens?.owner.equals(recipient)).toBe(true);
    expect(read(genuine.deposit()).action).toEqual({ kind: "deposit", amountRaw: 7_000_000n });
    expect(read(genuine.firstDeposit()).opens?.mint.equals(LEND_RECEIPT_MINT)).toBe(true);
    expect(read(genuine.withdraw()).action).toEqual({ kind: "withdraw", amountRaw: 7_000_000n });
    expect(read(genuine.withdrawToNoAccount()).opens?.mint.equals(USDC)).toBe(true);
    expect(read(genuine.openHolding())).toMatchObject({ action: { kind: "open" } });
  });

  it("builds a send with the relayer first, the portfolio second and read-only, and no priority fee", () => {
    const { message } = genuine.sendToNew();
    expect(message.staticAccountKeys[0].equals(relayer.publicKey)).toBe(true);
    expect(message.staticAccountKeys[1].equals(owner)).toBe(true);
    expect(message.header.numRequiredSignatures).toBe(2);
    expect(message.isAccountWritable(1)).toBe(false);
    const programs = message.compiledInstructions.map(
      (instruction) => message.staticAccountKeys[instruction.programIdIndex],
    );
    expect(programs.some((program) => program.equals(ComputeBudgetProgram.programId))).toBe(false);
  });

  it.each(Object.entries(hostile))("refuses %s", (_name, [build, reason]) => {
    expect(readRelayed(build(), pins)).toEqual({ ok: false, reason });
  });

  it("opens no account at all when the server has that switched off", () => {
    const off = { ...pins, accountCreation: false };
    expect(readRelayed(genuine.sendUsdc(), off).ok).toBe(true);
    for (const build of [genuine.sendToNew, genuine.firstDeposit, genuine.openHolding]) {
      expect(readRelayed(build(), off)).toEqual({ ok: false, reason: "account_creation" });
    }
  });
});

describe("what the relayer charges", () => {
  it("is twice the network fee, and for an opened account its rent and a tenth more", () => {
    expect(relayedCostLamports(null)).toBe(20_000n);
    expect(relayedCostLamports(2_039_280n)).toBe(20_000n + 2_243_208n);
    expect(relayedCostLamports(2_136_720n)).toBe(20_000n + 2_350_392n);
  });

  it("is priced in USDC at the SOL price, rounded up", () => {
    expect(lamportsInUsdc(20_000n, 1_000)).toBe(20_000n);
    expect(lamportsInUsdc(20_000n, 150)).toBe(3_000n);
    expect(lamportsInUsdc(2_263_208n, 200)).toBe(452_642n);
    expect(lamportsInUsdc(1n, 0.01)).toBe(1n);
  });
});

describe("the wallet's check before a portfolio signs", () => {
  const expectation = (over: Partial<RelayedExpectation> = {}): RelayedExpectation => ({
    pins,
    portfolio: owner,
    feeRaw: PLAIN_FEE,
    maxFeeRaw: PLAIN_FEE,
    intent: {
      kind: "send",
      mint: USDC,
      programId: TOKEN_PROGRAM_ID,
      to: recipient,
      amountRaw: 5_000_000n,
    },
    opens: null,
    mints: [{ mint: USDC, programId: TOKEN_PROGRAM_ID }],
    keepOut: [funding, sibling],
    ...over,
  });

  it("passes the send that was reviewed", () => {
    expect(checkRelayedIntent(genuine.sendUsdc(), expectation())).toEqual({ ok: true });
  });

  it.each(Object.entries(hostile))("refuses %s, as the route does", (_name, [build]) => {
    const verdict = checkRelayedIntent(build(), expectation());
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.reason).toMatch(/Not signed\.$/);
  });

  it("refuses a send to anyone but the reviewed recipient", () => {
    const elsewhere = compile([
      sendUsdc(5_000_000n, Keypair.generate().publicKey),
      payment(PLAIN_FEE),
    ]);
    expect(checkRelayedIntent(elsewhere, expectation()).ok).toBe(false);
  });

  it("refuses any amount but the reviewed one, and any token but the reviewed one", () => {
    const more = compile([sendUsdc(5_000_001n), payment(PLAIN_FEE)]);
    expect(checkRelayedIntent(more, expectation()).ok).toBe(false);
    expect(checkRelayedIntent(genuine.sendTracker(), expectation()).ok).toBe(false);
  });

  it("refuses a payment that is not the reviewed fee, in either direction", () => {
    for (const fee of [PLAIN_FEE + 1n, PLAIN_FEE - 1n]) {
      const transaction = compile([sendUsdc(), payment(fee)]);
      expect(checkRelayedIntent(transaction, expectation()).ok).toBe(false);
    }
    // Even when told to expect more than was reviewed.
    const raised = compile([sendUsdc(), payment(PLAIN_FEE + 1n)]);
    expect(checkRelayedIntent(raised, expectation({ feeRaw: PLAIN_FEE + 1n })).ok).toBe(false);
  });

  it("refuses an account the review did not count on, and the lack of one it did", () => {
    expect(
      checkRelayedIntent(
        genuine.sendToNew(),
        expectation({ feeRaw: OPENING_FEE, maxFeeRaw: OPENING_FEE }),
      ).ok,
    ).toBe(false);
    const opening = expectation({
      feeRaw: OPENING_FEE,
      maxFeeRaw: OPENING_FEE,
      opens: { owner: recipient, mint: USDC, programId: TOKEN_PROGRAM_ID },
    });
    expect(checkRelayedIntent(genuine.sendToNew(), opening)).toEqual({ ok: true });
    expect(checkRelayedIntent(compile([sendUsdc(), payment(OPENING_FEE)]), opening).ok).toBe(false);
  });

  it("refuses a transaction that names the funding wallet or another portfolio, or a token account of theirs", () => {
    for (const own of [funding, sibling]) {
      const toOwn = compile([sendUsdc(5_000_000n, own), payment(PLAIN_FEE)]);
      const verdict = checkRelayedIntent(
        toOwn,
        expectation({ intent: { ...expectation().intent, to: own } as never }),
      );
      expect(verdict).toEqual({
        ok: false,
        reason:
          "This transaction names another of your addresses, which would link them. Not signed.",
      });
    }
    // The wallet itself named, not only its token account.
    const opensForSibling = compile([
      open(ataFor(USDC, sibling), sibling, USDC),
      sendUsdc(5_000_000n, sibling),
      payment(OPENING_FEE),
    ]);
    expect(
      checkRelayedIntent(
        opensForSibling,
        expectation({
          feeRaw: OPENING_FEE,
          maxFeeRaw: OPENING_FEE,
          intent: { ...expectation().intent, to: sibling } as never,
          opens: { owner: sibling, mint: USDC, programId: TOKEN_PROGRAM_ID },
        }),
      ).ok,
    ).toBe(false);
  });

  it("passes a deposit, a withdrawal and an opened holding only for what was reviewed", () => {
    const earn = (kind: "deposit" | "withdraw", amountRaw: bigint) =>
      expectation({ intent: { kind, amountRaw } });
    expect(checkRelayedIntent(genuine.deposit(), earn("deposit", 7_000_000n))).toEqual({
      ok: true,
    });
    expect(checkRelayedIntent(genuine.deposit(), earn("deposit", 6_000_000n)).ok).toBe(false);
    expect(checkRelayedIntent(genuine.deposit(), earn("withdraw", 7_000_000n)).ok).toBe(false);
    expect(checkRelayedIntent(genuine.withdraw(), earn("withdraw", 7_000_000n))).toEqual({
      ok: true,
    });
    expect(
      checkRelayedIntent(
        genuine.openHolding(),
        expectation({
          feeRaw: TRACKER_OPENING_FEE,
          maxFeeRaw: TRACKER_OPENING_FEE,
          intent: { kind: "open" },
          opens: { owner, mint: tracker.mint, programId: tracker.programId },
        }),
      ),
    ).toEqual({ ok: true });
  });
});
