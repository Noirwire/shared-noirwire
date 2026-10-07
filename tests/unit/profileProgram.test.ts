import { createHash, createPublicKey, verify } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  Keypair,
  PACKET_DATA_SIZE,
  PublicKey,
  Transaction,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { signMessage } from "../../src/infrastructure/solana/profile.js";
import {
  MAGIC_PROGRAM,
  PERMISSION_PROGRAM,
  ROLLUP_VAULT,
  closeProfileInstruction,
  createProfileInstruction,
  profileAccounts,
  profileMessage,
  profileWire,
  readProfileAccount,
  writeProfileInstruction,
} from "../../src/infrastructure/solana/profileProgram.js";

const PROGRAM_ID = new PublicKey("AiS6fT2x5XELHvZPrLfdzydC9xUazjS6r4z4bNDTqtHQ");
const gate = Keypair.generate().publicKey;
const owner = Keypair.generate().publicKey;
const deployment = { programId: PROGRAM_ID, gate };
const DATA = Uint8Array.from([9, 8, 7, 6, 5]);
const REVISION = 0x0102030405060708n;

const built: Record<string, TransactionInstruction> = {
  create_profile: createProfileInstruction(deployment, owner, DATA),
  write_profile: writeProfileInstruction(deployment, owner, REVISION, DATA),
  close_profile: closeProfileInstruction(PROGRAM_ID, owner),
};

/** How Anchor names an instruction on the wire: the first 8 bytes of sha256("global:<name>"). */
const discriminator = (name: string) => [
  ...createHash("sha256").update(`global:${name}`).digest().subarray(0, 8),
];

const flags = (instruction: TransactionInstruction) =>
  instruction.keys.map(
    (key) => `${key.pubkey.toBase58()}${key.isSigner ? " s" : ""}${key.isWritable ? " w" : ""}`,
  );

describe("the profile program's instructions", () => {
  const { sponsor, profile, permission } = profileAccounts(PROGRAM_ID, owner);
  const fixed = {
    permissionProgram: "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1",
    vault: "MagicVau1t999999999999999999999999999999999",
    magic: "Magic11111111111111111111111111111111111111",
  };

  it("derive their accounts from the owner alone, by the seeds the program checks", () => {
    const derived = (seeds: (string | PublicKey)[], program: PublicKey) =>
      PublicKey.findProgramAddressSync(
        seeds.map((seed) => (typeof seed === "string" ? Buffer.from(seed) : seed.toBuffer())),
        program,
      )[0].toBase58();
    expect(sponsor.toBase58()).toBe(derived(["sponsor"], PROGRAM_ID));
    expect(profile.toBase58()).toBe(derived(["profile", owner], PROGRAM_ID));
    expect(permission.toBase58()).toBe(derived(["permission:", profile], PERMISSION_PROGRAM));
    const another = profileAccounts(PROGRAM_ID, Keypair.generate().publicKey);
    expect(another.profile.equals(profile)).toBe(false);
    expect(another.sponsor.equals(sponsor)).toBe(true);
    expect([PERMISSION_PROGRAM, ROLLUP_VAULT, MAGIC_PROGRAM].map(String)).toEqual(
      Object.values(fixed),
    );
  });

  it("name the accounts the program expects, in its order, each signing or writable as it must be", () => {
    expect(flags(built.create_profile)).toEqual([
      `${gate} s`,
      `${owner} s`,
      `${sponsor} w`,
      `${profile} w`,
      `${permission} w`,
      fixed.permissionProgram,
      `${fixed.vault} w`,
      fixed.magic,
    ]);
    expect(flags(built.write_profile)).toEqual([
      `${gate} s`,
      `${owner} s`,
      `${sponsor} w`,
      `${profile} w`,
      `${fixed.vault} w`,
      fixed.magic,
    ]);
    expect(flags(built.close_profile)).toEqual([
      `${owner} s`,
      `${sponsor} w`,
      `${profile} w`,
      `${permission} w`,
      fixed.permissionProgram,
      `${fixed.vault} w`,
      fixed.magic,
    ]);
    for (const instruction of Object.values(built)) {
      expect(instruction.programId.equals(PROGRAM_ID)).toBe(true);
    }
  });

  it("start with the discriminator the program's framework gives each name, then the arguments", () => {
    expect([...built.create_profile.data]).toEqual([
      ...[225, 205, 234, 143, 17, 186, 50, 220],
      ...[5, 0, 0, 0],
      ...DATA,
    ]);
    expect([...built.write_profile.data]).toEqual([
      ...[42, 24, 36, 43, 230, 170, 36, 247],
      ...[8, 7, 6, 5, 4, 3, 2, 1],
      ...[5, 0, 0, 0],
      ...DATA,
    ]);
    expect([...built.close_profile.data]).toEqual([167, 36, 181, 8, 136, 158, 46, 207]);
    for (const [name, instruction] of Object.entries(built)) {
      expect([...instruction.data.subarray(0, 8)], name).toEqual(discriminator(name));
    }
  });
});

describe("a profile transaction as it travels", () => {
  const paying = Keypair.generate();
  const owning = Keypair.generate();
  const to = { programId: PROGRAM_ID, gate: paying.publicKey };
  const blockhash = Keypair.generate().publicKey.toBase58();
  const signing = (key: Keypair, message: Uint8Array) => ({
    signer: key.publicKey,
    signature: signMessage(key, message),
  });

  /** A length as the wire writes it, and how many bytes it took. */
  function shortVecAt(bytes: Uint8Array, at: number): [length: number, next: number] {
    let length = 0;
    for (let shift = 0; ; shift += 7) {
      const byte = bytes[at++];
      length |= (byte & 0x7f) << shift;
      if (byte < 0x80) return [length, at];
    }
  }

  /** The wire bytes read back, by the layout alone and with no library. */
  function decoded(wire: Uint8Array) {
    const [signers, afterCount] = shortVecAt(wire, 0);
    const signatures = Array.from({ length: signers }, (_, index) =>
      wire.slice(afterCount + index * 64, afterCount + (index + 1) * 64),
    );
    const message = wire.slice(afterCount + signers * 64);
    const [keyCount, afterKeyCount] = shortVecAt(message, 3);
    const keys = Array.from(
      { length: keyCount },
      (_, index) =>
        new PublicKey(message.slice(afterKeyCount + index * 32, afterKeyCount + (index + 1) * 32)),
    );
    const afterKeys = afterKeyCount + keyCount * 32;
    const [instructions, afterInstructionCount] = shortVecAt(message, afterKeys + 32);
    const program = keys[message[afterInstructionCount]];
    const [named, afterNamed] = shortVecAt(message, afterInstructionCount + 1);
    const accounts = [...message.slice(afterNamed, afterNamed + named)].map((index) => keys[index]);
    const [dataLength, afterDataLength] = shortVecAt(message, afterNamed + named);
    return {
      signatures,
      message,
      header: [...message.slice(0, 3)],
      keys,
      blockhash: new PublicKey(message.slice(afterKeys, afterKeys + 32)).toBase58(),
      instructions,
      program,
      accounts,
      data: message.slice(afterDataLength, afterDataLength + dataLength),
      end: afterDataLength + dataLength,
    };
  }

  const small = (instruction: TransactionInstruction, feePayer: Keypair, signers: Keypair[]) => {
    const transaction = new Transaction({
      feePayer: feePayer.publicKey,
      recentBlockhash: blockhash,
    });
    transaction.add(instruction);
    if (signers.length > 0) transaction.partialSign(...signers);
    return Uint8Array.from(transaction.serialize({ requireAllSignatures: false }));
  };

  it.each([
    ["a creation", createProfileInstruction(to, owning.publicKey, DATA), paying],
    ["a write", writeProfileInstruction(to, owning.publicKey, REVISION, DATA), paying],
    ["a closing", closeProfileInstruction(PROGRAM_ID, owning.publicKey), owning],
  ])("is byte for byte what the library writes for %s", (_what, instruction, payer) => {
    const message = profileMessage(instruction, payer.publicKey, blockhash);
    const everyone = payer === owning ? [owning] : [paying, owning];
    const signatures = everyone.map((key) => signing(key, message.bytes));
    expect(profileWire(message, signatures)).toEqual(small(instruction, payer, everyone));
    // With the owner's signature alone, as it is handed to the server.
    expect(profileWire(message, [signing(owning, message.bytes)])).toEqual(
      small(instruction, payer, [owning]),
    );
  });

  it("leaves the gate's place, the first, as 64 zero bytes, with the owner's signature after it", () => {
    const instruction = writeProfileInstruction(to, owning.publicKey, REVISION, DATA);
    const message = profileMessage(instruction, paying.publicKey, blockhash);
    expect(message.signers.map(String)).toEqual([paying.publicKey, owning.publicKey].map(String));
    const read = decoded(profileWire(message, [signing(owning, message.bytes)]));
    expect(read.signatures[0]).toEqual(new Uint8Array(64));
    expect(signedBy(owning.publicKey, read.message, read.signatures[1])).toBe(true);
  });

  it.each([
    ["a creation", (data: Uint8Array) => createProfileInstruction(to, owning.publicKey, data)],
    ["a write", (data: Uint8Array) => writeProfileInstruction(to, owning.publicKey, 9n, data)],
  ])("carries 2,000 bytes whole in %s, past what the library writes", (_what, build) => {
    const record = Uint8Array.from({ length: 2_000 }, (_, index) => index % 251);
    const instruction = build(record);
    const message = profileMessage(instruction, paying.publicKey, blockhash);
    const wire = profileWire(message, [signing(owning, message.bytes)]);
    expect(wire.length).toBeGreaterThan(PACKET_DATA_SIZE);
    expect(() => small(instruction, paying, [owning])).toThrow();

    const read = decoded(wire);
    expect(read.end).toBe(read.message.length);
    const readonlyUnsigned = instruction.keys.filter((key) => !key.isWritable).length - 1;
    expect(read.header).toEqual([2, 1, readonlyUnsigned]);
    expect(read.blockhash).toBe(blockhash);
    expect(read.instructions).toBe(1);
    expect(read.program.equals(PROGRAM_ID)).toBe(true);
    expect(read.accounts.map(String)).toEqual(instruction.keys.map((key) => String(key.pubkey)));
    expect(read.data).toEqual(Uint8Array.from(instruction.data));
    expect(read.data.slice(-2_000)).toEqual(record);
    expect(read.signatures[0]).toEqual(new Uint8Array(64));
    expect(signedBy(owning.publicKey, read.message, read.signatures[1])).toBe(true);

    // And as the server reads it.
    const parsed = VersionedTransaction.deserialize(wire);
    expect(parsed.message.staticAccountKeys.map(String)).toEqual(read.keys.map(String));
    expect(Uint8Array.from(parsed.message.compiledInstructions[0].data)).toEqual(read.data);
  });
});

/** Whether `signature` is `signer`'s over `message`, by Node's own ed25519. */
function signedBy(signer: PublicKey, message: Uint8Array, signature: Uint8Array): boolean {
  const key = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), signer.toBuffer()]),
    format: "der",
    type: "spki",
  });
  return verify(null, message, key, signature);
}

// The program is a sibling checkout on a developer's machine and absent in
// CI, where this suite skips instead of failing.
const IDL = join(import.meta.dirname, "../../../profile-noirwire/target/idl/noirwire_profile.json");

type IdlAccount = { name: string; signer?: boolean; writable?: boolean; address?: string };
type Idl = {
  address: string;
  instructions: {
    name: string;
    discriminator: number[];
    accounts: IdlAccount[];
    args: { name: string; type: string }[];
  }[];
};

describe.skipIf(!existsSync(IDL))("the profile program's instructions against its IDL", () => {
  const idl = existsSync(IDL) ? (JSON.parse(readFileSync(IDL, "utf8")) as Idl) : null;
  const described = (name: string) => idl!.instructions.find((entry) => entry.name === name)!;

  it("are for the program the IDL is of", () => {
    expect(idl!.address).toBe(PROGRAM_ID.toBase58());
  });

  it.each(Object.keys(built))("%s matches its discriminator, accounts and arguments", (name) => {
    const { discriminator: expected, accounts, args } = described(name);
    const instruction = built[name];
    expect([...instruction.data.subarray(0, 8)]).toEqual(expected);
    expect(
      instruction.keys.map((key) => ({ signer: key.isSigner, writable: key.isWritable })),
    ).toEqual(
      accounts.map((account) => ({
        signer: account.signer === true,
        writable: account.writable === true,
      })),
    );
    accounts.forEach((account, index) => {
      if (account.address) expect(instruction.keys[index].pubkey.toBase58()).toBe(account.address);
    });
    expect(accounts.map((account) => account.name)).toEqual(
      name === "close_profile"
        ? [
            "owner",
            "sponsor",
            "profile",
            "permission",
            "permission_program",
            "vault",
            "magic_program",
          ]
        : name === "create_profile"
          ? [
              "gate",
              "owner",
              "sponsor",
              "profile",
              "permission",
              "permission_program",
              "vault",
              "magic_program",
            ]
          : ["gate", "owner", "sponsor", "profile", "vault", "magic_program"],
    );
    const argumentBytes = { u64: 8, bytes: 4 + DATA.length } as Record<string, number>;
    const expectedLength = args.reduce((total, arg) => total + argumentBytes[arg.type], 8);
    expect(instruction.data.length).toBe(expectedLength);
  });
});

describe("a profile account", () => {
  function account(over: { layout?: number; owner?: PublicKey; length?: number } = {}) {
    const bytes = new Uint8Array(54 + DATA.length + 20);
    const view = new DataView(bytes.buffer);
    bytes[8] = over.layout ?? 1;
    bytes[9] = 254;
    bytes.set((over.owner ?? owner).toBytes(), 10);
    view.setBigUint64(42, REVISION, true);
    view.setUint32(50, over.length ?? DATA.length, true);
    bytes.set(DATA, 54);
    return bytes;
  }

  it("is read as its revision and exactly the bytes it says it holds, not the room left after them", () => {
    const read = readProfileAccount(account(), owner);
    expect(read.revision).toBe(REVISION);
    expect([...read.data]).toEqual([...DATA]);
  });

  it("is refused in a layout this version does not know, for another owner, or cut short", () => {
    expect(() => readProfileAccount(account({ layout: 2 }), owner)).toThrow(/layout/);
    expect(() => readProfileAccount(account({ owner: gate }), owner)).toThrow(/owner/);
    expect(() => readProfileAccount(account({ length: 5_000 }), owner)).toThrow(/shorter/);
    expect(() => readProfileAccount(new Uint8Array(20), owner)).toThrow(/layout/);
  });
});
