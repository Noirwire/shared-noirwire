import "./buffer-polyfill.js";

import { Buffer } from "buffer";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import type { MirroredProfile } from "../../application/ports.js";
import { bytesEqual, readU32LE, readU64LE } from "./bytes.js";

/**
 * The profile program's three instructions and its one account, encoded by
 * hand: an 8-byte discriminator, then the arguments as Borsh writes them.
 * The program runs on a private rollup, where neither the gate nor the
 * owner needs any SOL.
 *
 * A profile's owner is a key derived for nothing else. Each instruction
 * names it beside the deployment's own accounts and no other wallet, and a
 * transaction built here holds that one instruction and nothing more.
 */

/**
 * The profile program. Fixed here and never taken from a server: the
 * owner's key signs for this program and for no other.
 */
export const PROFILE_PROGRAM = new PublicKey("AiS6fT2x5XELHvZPrLfdzydC9xUazjS6r4z4bNDTqtHQ");
/** The rollup's permission program, which says who may read a profile. */
export const PERMISSION_PROGRAM = new PublicKey("ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1");
/** Where the rollup collects rent. */
export const ROLLUP_VAULT = new PublicKey("MagicVau1t999999999999999999999999999999999");
export const MAGIC_PROGRAM = new PublicKey("Magic11111111111111111111111111111111111111");

const CREATE_PROFILE = [225, 205, 234, 143, 17, 186, 50, 220];
const WRITE_PROFILE = [42, 24, 36, 43, 230, 170, 36, 247];
const CLOSE_PROFILE = [167, 36, 181, 8, 136, 158, 46, 207];

const seed = (text: string) => new TextEncoder().encode(text);

/** The accounts every profile instruction names for one owner, each derived, none looked up. */
export function profileAccounts(programId: PublicKey, owner: PublicKey) {
  const [sponsor] = PublicKey.findProgramAddressSync([seed("sponsor")], programId);
  const [profile] = PublicKey.findProgramAddressSync([seed("profile"), owner.toBytes()], programId);
  const [permission] = PublicKey.findProgramAddressSync(
    [seed("permission:"), profile.toBytes()],
    PERMISSION_PROGRAM,
  );
  return { sponsor, profile, permission };
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function u64(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

/** Borsh `bytes`: the length as a u32, then the bytes. */
const lengthPrefixed = (data: Uint8Array) => [...u32(data.length), ...data];

const signer = (pubkey: PublicKey) => ({ pubkey, isSigner: true, isWritable: false });
const writable = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: true });
const readonly = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: false });

type Deployment = { programId: PublicKey; gate: PublicKey };

/** Makes `owner`'s profile, holding `data`. The gate signs beside the owner, and pays. */
export function createProfileInstruction(
  { programId, gate }: Deployment,
  owner: PublicKey,
  data: Uint8Array,
): TransactionInstruction {
  const { sponsor, profile, permission } = profileAccounts(programId, owner);
  return new TransactionInstruction({
    programId,
    keys: [
      signer(gate),
      signer(owner),
      writable(sponsor),
      writable(profile),
      writable(permission),
      readonly(PERMISSION_PROGRAM),
      writable(ROLLUP_VAULT),
      readonly(MAGIC_PROGRAM),
    ],
    data: Buffer.from([...CREATE_PROFILE, ...lengthPrefixed(data)]),
  });
}

/** Puts `data` in place of what `owner`'s profile held at `expectedRevision`, and at no other. */
export function writeProfileInstruction(
  { programId, gate }: Deployment,
  owner: PublicKey,
  expectedRevision: bigint,
  data: Uint8Array,
): TransactionInstruction {
  const { sponsor, profile } = profileAccounts(programId, owner);
  return new TransactionInstruction({
    programId,
    keys: [
      signer(gate),
      signer(owner),
      writable(sponsor),
      writable(profile),
      writable(ROLLUP_VAULT),
      readonly(MAGIC_PROGRAM),
    ],
    data: Buffer.from([...WRITE_PROFILE, ...u64(expectedRevision), ...lengthPrefixed(data)]),
  });
}

/** Removes `owner`'s profile. The owner alone signs, and so pays. */
export function closeProfileInstruction(
  programId: PublicKey,
  owner: PublicKey,
): TransactionInstruction {
  const { sponsor, profile, permission } = profileAccounts(programId, owner);
  return new TransactionInstruction({
    programId,
    keys: [
      signer(owner),
      writable(sponsor),
      writable(profile),
      writable(permission),
      readonly(PERMISSION_PROGRAM),
      writable(ROLLUP_VAULT),
      readonly(MAGIC_PROGRAM),
    ],
    data: Buffer.from(CLOSE_PROFILE),
  });
}

/** A length as a transaction writes it: seven bits a byte, the low ones first. */
function shortVec(length: number): number[] {
  const bytes: number[] = [];
  for (let rest = length; ; rest >>= 7) {
    if (rest < 0x80) return [...bytes, rest];
    bytes.push((rest & 0x7f) | 0x80);
  }
}

/** The message of a profile transaction, and whose signatures it takes, in the order it takes them. */
export type ProfileMessage = { bytes: Uint8Array; signers: PublicKey[] };

/**
 * The message of a legacy transaction holding that one instruction, written
 * out by hand. The library orders the accounts, and is not asked for the
 * bytes: it refuses any transaction over Solana's 1232, and the rollup
 * takes a whole record in one that is larger.
 */
export function profileMessage(
  instruction: TransactionInstruction,
  feePayer: PublicKey,
  blockhash: string,
): ProfileMessage {
  const compiled = new Transaction({ feePayer, recentBlockhash: blockhash })
    .add(instruction)
    .compileMessage();
  const { header, accountKeys } = compiled;
  const [only] = compiled.instructions;
  const bytes = Uint8Array.from([
    header.numRequiredSignatures,
    header.numReadonlySignedAccounts,
    header.numReadonlyUnsignedAccounts,
    ...shortVec(accountKeys.length),
    ...accountKeys.flatMap((key) => [...key.toBytes()]),
    ...new PublicKey(blockhash).toBytes(),
    ...shortVec(1),
    only.programIdIndex,
    ...shortVec(only.accounts.length),
    ...only.accounts,
    ...shortVec(instruction.data.length),
    ...instruction.data,
  ]);
  return { bytes, signers: accountKeys.slice(0, header.numRequiredSignatures) };
}

const SIGNATURE_BYTES = 64;

/**
 * A profile transaction as it travels: how many signatures, each of them in
 * the message's own order, then the message. A signer with no signature
 * here keeps its place as 64 zero bytes: the gate's, the first, which the
 * server fills.
 */
export function profileWire(
  { bytes, signers }: ProfileMessage,
  signed: { signer: PublicKey; signature: Uint8Array }[],
): Uint8Array {
  const signatures = signers.flatMap((key) => [
    ...(signed.find((entry) => entry.signer.equals(key))?.signature ??
      new Uint8Array(SIGNATURE_BYTES)),
  ]);
  return Uint8Array.from([...shortVec(signers.length), ...signatures, ...bytes]);
}

const LAYOUT = 1;
const LAYOUT_AT = 8;
const OWNER_AT = 10;
const REVISION_AT = 42;
const LENGTH_AT = 50;
const DATA_AT = 54;

/**
 * A profile account's revision and contents. Throws for an account in a
 * layout this version does not know, one that is not `owner`'s, and one
 * shorter than it says it is: none of them is read, or written over.
 */
export function readProfileAccount(account: Uint8Array, owner: PublicKey): MirroredProfile {
  if (account.length < DATA_AT || account[LAYOUT_AT] !== LAYOUT) {
    throw new Error("A profile account is in a layout this app does not know.");
  }
  if (!bytesEqual(account.subarray(OWNER_AT, REVISION_AT), owner.toBytes())) {
    throw new Error("A profile account belongs to another owner.");
  }
  const end = DATA_AT + readU32LE(account, LENGTH_AT);
  if (end > account.length) throw new Error("A profile account is shorter than it says.");
  return { revision: readU64LE(account, REVISION_AT), data: account.slice(DATA_AT, end) };
}
