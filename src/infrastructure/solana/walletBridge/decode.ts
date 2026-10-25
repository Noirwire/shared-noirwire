import "../buffer-polyfill.js";

import { Buffer } from "buffer";
import { Message, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import type { NetworkName } from "../../../domain/walletBridge/protocol.js";
import type {
  Decoded,
  DecodedInstruction,
  DecodedSignIn,
  DecodedTransaction,
  DepositVariant,
  Refused,
  RefusalWhy,
  TransactionKind,
} from "../../../domain/walletBridge/request.js";
import { checkSignIn } from "../../../domain/walletBridge/signIn.js";
import * as expected from "./expected.js";
import { ATA_PROGRAM, DISCRIMINATORS, ESPL_PROGRAM, type BridgePins } from "./pins.js";

/**
 * What a request to sign is, read from its bytes and nothing else. A message
 * is accepted only when it is byte for byte the message the wallet would
 * have built itself for one of the shapes below, from its own pins and the
 * few values read out of the request. The terminal's own description of
 * what it is asking is not an input.
 *
 * Rollup, order book program only: `openTrader`, `setOrderKeys`, `deposit`,
 * `withdraw`. Solana, ephemeral token program and associated token program
 * only: `depositToRollup` (in two variants, a first deposit and a repeat one)
 * and `withdrawToSolana`. Everything else is refused, with the reason named.
 */

export type DecodeContext = { owner: PublicKey; network: NetworkName; pins: BridgePins };

const MAX_MESSAGE_BYTES = 1232;
const ORDER_KEYS = 4;
const PUBKEY_BYTES = 32;
const DISCRIMINATOR_BYTES = 8;
const AMOUNT_BYTES = 8;

const refuse = (refusal: Refused["refusal"], why: RefusalWhy): Refused => ({
  ok: false,
  refusal,
  why,
});

type Compiled = {
  message: Message;
  keys: PublicKey[];
  steps: { program: PublicKey; accounts: number[]; data: Uint8Array }[];
};

function parse(bytes: Uint8Array): Compiled | Refused {
  try {
    return parseUnchecked(bytes);
  } catch {
    return refuse("notDecodable", "unparsable");
  }
}

function parseUnchecked(bytes: Uint8Array): Compiled | Refused {
  if (bytes.length === 0) return refuse("notDecodable", "empty");
  if (bytes.length > MAX_MESSAGE_BYTES) return refuse("notDecodable", "tooLong");
  if ((bytes[0] & 0x80) !== 0) return refuse("notDecodable", "versioned");
  let message: Message;
  try {
    message = Message.from(Buffer.from(bytes));
  } catch {
    return refuse("notDecodable", "unparsable");
  }
  if (!Buffer.from(message.serialize()).equals(Buffer.from(bytes))) {
    return refuse("notDecodable", "notCanonical");
  }
  const keys = message.accountKeys;
  const inRange = (index: number) => Number.isInteger(index) && index >= 0 && index < keys.length;
  const steps = message.compiledInstructions;
  if (
    steps.some((step) => !inRange(step.programIdIndex) || !step.accountKeyIndexes.every(inRange))
  ) {
    return refuse("notDecodable", "unparsable");
  }
  return {
    message,
    keys,
    steps: message.compiledInstructions.map((step) => ({
      program: keys[step.programIdIndex],
      accounts: step.accountKeyIndexes,
      data: step.data,
    })),
  };
}

function sameMessage(
  bytes: Uint8Array,
  feePayer: PublicKey,
  blockhash: string,
  instructions: (TransactionInstruction | null)[],
): boolean {
  try {
    const transaction = new Transaction();
    transaction.feePayer = feePayer;
    transaction.recentBlockhash = blockhash;
    for (const instruction of instructions) {
      if (!instruction) return false;
      transaction.add(instruction);
    }
    return Buffer.from(transaction.compileMessage().serialize()).equals(Buffer.from(bytes));
  } catch {
    return false;
  }
}

const hexOf = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const viewOf = (data: Uint8Array) => new DataView(data.buffer, data.byteOffset, data.byteLength);
const u64At = (data: Uint8Array, at: number) => viewOf(data).getBigUint64(at, true);
const u32At = (data: Uint8Array, at: number) => viewOf(data).getUint32(at, true);

function orderKeysOf(data: Uint8Array, owner: PublicKey, gate?: PublicKey): PublicKey[] | null {
  if (data.length !== DISCRIMINATOR_BYTES + ORDER_KEYS * PUBKEY_BYTES) return null;
  const keys = Array.from(
    { length: ORDER_KEYS },
    (_, at) =>
      new PublicKey(
        data.slice(
          DISCRIMINATOR_BYTES + at * PUBKEY_BYTES,
          DISCRIMINATOR_BYTES + (at + 1) * PUBKEY_BYTES,
        ),
      ),
  );
  const distinct = new Set([owner, ...(gate ? [gate] : []), ...keys].map((key) => key.toBase58()));
  const wanted = ORDER_KEYS + 1 + (gate ? 1 : 0);
  if (distinct.size !== wanted || keys.some((key) => key.equals(PublicKey.default))) return null;
  return keys;
}

const ESPL_NAMES: Record<number, string> = {
  0: "initEphemeralAta",
  1: "initVault",
  2: "transferToVault",
  4: "delegateEphemeralAta",
  6: "createEataPermission",
  7: "delegateEataPermission",
  24: "setupAndDelegateShuttle",
  26: "withdrawThroughShuttle",
};

const ORDERBOOK_NAMES: Record<string, string> = {
  [DISCRIMINATORS.openTrader]: "openTrader",
  [DISCRIMINATORS.setOrderKeys]: "setOrderKeys",
  [DISCRIMINATORS.deposit]: "deposit",
  [DISCRIMINATORS.withdraw]: "withdraw",
};

function nameOf(step: Compiled["steps"][number], pins: BridgePins): string {
  if (step.program.equals(pins.orderbookProgram)) {
    return ORDERBOOK_NAMES[hexOf(step.data.slice(0, DISCRIMINATOR_BYTES))] ?? "unknown";
  }
  if (step.program.equals(ATA_PROGRAM))
    return step.data[0] === 1 ? "createTokenAccount" : "unknown";
  return ESPL_NAMES[step.data[0]] ?? "unknown";
}

function instructionsOf(compiled: Compiled, pins: BridgePins): DecodedInstruction[] {
  return compiled.steps.map((step) => ({
    program: step.program.toBase58(),
    name: nameOf(step, pins),
    accounts: step.accounts.map((index) => ({
      address: compiled.keys[index].toBase58(),
      signer: compiled.message.isAccountSigner(index),
      writable: compiled.message.isAccountWritable(index),
    })),
  }));
}

const OPENING = new Set([
  "createTokenAccount",
  "initEphemeralAta",
  "createEataPermission",
  "setupAndDelegateShuttle",
  "withdrawThroughShuttle",
]);

function accepted(
  compiled: Compiled,
  context: DecodeContext,
  shape: {
    kind: TransactionKind;
    amountAtoms?: bigint;
    variant?: DepositVariant;
    orderKeys?: PublicKey[];
  },
): DecodedTransaction {
  const instructions = instructionsOf(compiled, context.pins);
  return {
    type: "transaction",
    kind: shape.kind,
    network: context.network,
    owner: context.owner.toBase58(),
    amountAtoms: shape.amountAtoms ?? null,
    ...(shape.variant ? { variant: shape.variant } : {}),
    feePayer: compiled.keys[0].toBase58(),
    signatureCount: compiled.message.header.numRequiredSignatures,
    recentBlockhash: compiled.message.recentBlockhash,
    accountsOpened: instructions.filter((step) => OPENING.has(step.name)).length,
    ...(shape.orderKeys ? { orderKeys: shape.orderKeys.map((key) => key.toBase58()) } : {}),
    instructions,
  };
}

function decodeRollup(
  bytes: Uint8Array,
  compiled: Compiled,
  context: DecodeContext,
): Decoded<DecodedTransaction> {
  const { owner, pins } = context;
  if (compiled.steps.length !== 1) return refuse("notAllowed", "count");
  const [step] = compiled.steps;
  const name = nameOf(step, pins);
  const blockhash = compiled.message.recentBlockhash;
  const payer = compiled.keys[0];

  if (name === "openTrader") {
    if (payer.equals(owner)) return refuse("notAllowed", "payer");
    const orderKeys = orderKeysOf(step.data, owner, payer);
    if (!orderKeys) return refuse("notAllowed", "orderKeys");
    const built = [expected.openTrader(pins, payer, owner, orderKeys)];
    return sameMessage(bytes, payer, blockhash, built)
      ? { ok: true, request: accepted(compiled, context, { kind: "openTrader", orderKeys }) }
      : refuse("notAllowed", "mismatch");
  }
  if (name === "setOrderKeys") {
    const orderKeys = orderKeysOf(step.data, owner);
    if (!orderKeys) return refuse("notAllowed", "orderKeys");
    const built = [expected.setOrderKeys(pins, owner, orderKeys)];
    return sameMessage(bytes, owner, blockhash, built)
      ? { ok: true, request: accepted(compiled, context, { kind: "setOrderKeys", orderKeys }) }
      : refuse("notAllowed", "mismatch");
  }
  if (name === "deposit" || name === "withdraw") {
    if (step.data.length !== DISCRIMINATOR_BYTES + 1 + AMOUNT_BYTES)
      return refuse("notAllowed", "data");
    const amountAtoms = u64At(step.data, DISCRIMINATOR_BYTES + 1);
    if (amountAtoms === 0n) return refuse("notAllowed", "zeroAmount");
    if (!pins.custodyAuthority) return refuse("notAllowed", "notConfigured");
    const built = [
      name === "deposit"
        ? expected.deposit(pins, owner, amountAtoms)
        : expected.withdraw(pins, owner, amountAtoms),
    ];
    return sameMessage(bytes, owner, blockhash, built)
      ? { ok: true, request: accepted(compiled, context, { kind: name, amountAtoms }) }
      : refuse("notAllowed", "mismatch");
  }
  return refuse("notAllowed", "discriminator");
}

type SolanaPlan = {
  kind: "depositToRollup" | "withdrawToSolana";
  variant?: DepositVariant;
  names: string[];
  amountAt: { step: string; offset: number; shuttleAt?: number };
};

function solanaPlan(names: string[], privateBalance: boolean): SolanaPlan | null {
  if (names.includes("transferToVault")) {
    return {
      kind: "depositToRollup",
      variant: "first",
      names: privateBalance
        ? [
            "initEphemeralAta",
            "transferToVault",
            "createEataPermission",
            "delegateEphemeralAta",
            "delegateEataPermission",
          ]
        : ["initEphemeralAta", "transferToVault", "delegateEphemeralAta"],
      amountAt: { step: "transferToVault", offset: 1 },
    };
  }
  if (names.includes("setupAndDelegateShuttle")) {
    return {
      kind: "depositToRollup",
      variant: "repeat",
      names: privateBalance
        ? [
            "initEphemeralAta",
            "createEataPermission",
            "delegateEphemeralAta",
            "setupAndDelegateShuttle",
          ]
        : ["initEphemeralAta", "delegateEphemeralAta", "setupAndDelegateShuttle"],
      amountAt: { step: "setupAndDelegateShuttle", offset: 5, shuttleAt: 1 },
    };
  }
  if (names.includes("withdrawThroughShuttle")) {
    return {
      kind: "withdrawToSolana",
      names: [
        "createTokenAccount",
        "initEphemeralAta",
        "delegateEphemeralAta",
        "withdrawThroughShuttle",
      ],
      amountAt: { step: "withdrawThroughShuttle", offset: 5, shuttleAt: 1 },
    };
  }
  return null;
}

function decodeSolana(
  bytes: Uint8Array,
  compiled: Compiled,
  context: DecodeContext,
): Decoded<DecodedTransaction> {
  const { owner, pins } = context;
  const names = compiled.steps.map((step) => nameOf(step, pins));
  if (names.includes("initVault")) return refuse("notAllowed", "initVault");
  if (names.includes("unknown")) return refuse("notAllowed", "instruction");
  const plan = solanaPlan(names, pins.privateBalance);
  if (!plan) return refuse("notAllowed", "sequence");
  if (names.length !== plan.names.length) return refuse("notAllowed", "count");
  if (names.some((name, at) => name !== plan.names[at])) return refuse("notAllowed", "sequence");

  const carrier = compiled.steps[names.indexOf(plan.amountAt.step)].data;
  const { offset, shuttleAt } = plan.amountAt;
  if (carrier.length < offset + AMOUNT_BYTES) return refuse("notAllowed", "data");
  const amountAtoms = u64At(carrier, offset);
  if (amountAtoms === 0n) return refuse("notAllowed", "zeroAmount");
  const shuttleId = shuttleAt === undefined ? 0 : u32At(carrier, shuttleAt);

  const { usdcMint: mint, rollupValidator: validator } = pins;
  const built: Record<string, TransactionInstruction> = {
    createTokenAccount: expected.createTokenAccount(owner, mint),
    initEphemeralAta: expected.initEphemeralAta(owner, mint),
    transferToVault: expected.transferToVault(owner, mint, amountAtoms),
    createEataPermission: expected.createEataPermission(owner, mint),
    delegateEphemeralAta: expected.delegateEphemeralAta(owner, mint, validator),
    delegateEataPermission: expected.delegateEataPermission(owner, mint, validator),
    setupAndDelegateShuttle: expected.setupAndDelegateShuttle(
      owner,
      mint,
      validator,
      shuttleId,
      amountAtoms,
    ),
    withdrawThroughShuttle: expected.withdrawThroughShuttle(
      owner,
      mint,
      validator,
      shuttleId,
      amountAtoms,
    ),
  };
  const matches = sameMessage(
    bytes,
    owner,
    compiled.message.recentBlockhash,
    names.map((name) => built[name]),
  );
  if (!matches) return refuse("notAllowed", "mismatch");
  return {
    ok: true,
    request: accepted(compiled, context, {
      kind: plan.kind,
      amountAtoms,
      ...(plan.variant ? { variant: plan.variant } : {}),
    }),
  };
}

/**
 * The transaction message `bytes` as one of the allowed shapes for `owner`,
 * or why it is refused. `network` is what the terminal says the message is
 * for; it must be the network of the shape the bytes turn out to be.
 */
export function decodeTransactionMessage(
  bytes: Uint8Array,
  context: DecodeContext,
): Decoded<DecodedTransaction> {
  try {
    return decodeChecked(bytes, context);
  } catch {
    return refuse("notDecodable", "unparsable");
  }
}

function decodeChecked(bytes: Uint8Array, context: DecodeContext): Decoded<DecodedTransaction> {
  const compiled = parse(bytes);
  if ("ok" in compiled) return compiled;
  if (compiled.steps.length === 0) return refuse("notAllowed", "count");
  const programs = compiled.steps.map((step) => step.program);
  const rollup = programs.every((program) => program.equals(context.pins.orderbookProgram));
  const solana = programs.every(
    (program) => program.equals(ESPL_PROGRAM) || program.equals(ATA_PROGRAM),
  );
  if (!rollup && !solana) return refuse("notAllowed", "program");
  if ((rollup ? "rollup" : "solana") !== context.network) return refuse("notAllowed", "network");
  return rollup ? decodeRollup(bytes, compiled, context) : decodeSolana(bytes, compiled, context);
}

/**
 * A message to sign as the rollup's sign-in for `address`, or why it is
 * refused. A text that is also a readable Solana message is refused: the
 * template cannot be one, and this keeps it that way.
 */
export function decodeSignInMessage(
  bytes: Uint8Array,
  address: string,
  nowMs: number,
): Decoded<DecodedSignIn> {
  const check = checkSignIn(bytes, address, nowMs);
  if (!check.ok) {
    return refuse(check.reason === "notText" ? "notDecodable" : "notAllowed", check.reason);
  }
  if (!("ok" in parse(bytes))) return refuse("notAllowed", "looksLikeTransaction");
  return { ok: true, request: { type: "signIn", address, timestamp: check.timestamp } };
}
