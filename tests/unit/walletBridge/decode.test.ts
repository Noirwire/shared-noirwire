import { createHash } from "node:crypto";
import {
  ComputeBudgetProgram,
  Keypair,
  Message,
  MessageV0,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import type { NetworkName } from "../../../src/domain/walletBridge/protocol.js";
import type { Decoded, DecodedRequest } from "../../../src/domain/walletBridge/request.js";
import {
  decodeSignInMessage,
  decodeTransactionMessage,
} from "../../../src/infrastructure/solana/walletBridge/decode.js";
import {
  DISCRIMINATORS,
  ESPL_PROGRAM,
  type BridgePins,
} from "../../../src/infrastructure/solana/walletBridge/pins.js";
import fixture from "../../fixtures/walletBridge/transactions.json" with { type: "json" };

const { meta } = fixture;
const OWNER = new PublicKey(meta.owner);
const ATTACKER = Keypair.fromSeed(new Uint8Array(32).fill(66)).publicKey;
const OTHER_KEY = Keypair.fromSeed(new Uint8Array(32).fill(67)).publicKey;
const MEMO = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

type CaseName = keyof typeof fixture.cases;

const pinsWith = (over: Partial<BridgePins> = {}): BridgePins => ({
  orderbookProgram: new PublicKey(meta.orderbookProgram),
  rollupUrl: "https://mainnet-tee.magicblock.app",
  rollupValidator: new PublicKey(meta.validator),
  usdcMint: new PublicKey(meta.usdcMint),
  custodyAuthority: new PublicKey(meta.custodyAuthority),
  marketIds: [0],
  privateBalance: true,
  ...over,
});

const bytesOf = (name: CaseName) =>
  Uint8Array.from(Buffer.from(fixture.cases[name].message, "hex"));

function decode(
  bytes: Uint8Array,
  network: NetworkName,
  over: Partial<BridgePins> = {},
  owner: PublicKey = OWNER,
) {
  return decodeTransactionMessage(bytes, { owner, network, pins: pinsWith(over) });
}

function decodeCase(name: CaseName) {
  const { network, privateBalance } = fixture.cases[name];
  return decode(bytesOf(name), network as NetworkName, { privateBalance });
}

/** A golden message, taken apart, changed by `change` and put back together. */
function tampered(name: CaseName, change: (transaction: Transaction) => void): Uint8Array {
  const transaction = Transaction.populate(Message.from(Buffer.from(bytesOf(name))));
  change(transaction);
  return transaction.compileMessage().serialize();
}

const refusedWith = (result: Decoded<DecodedRequest>, refusal: string, why: string) =>
  expect(result).toEqual({ ok: false, refusal, why });

describe("the pinned discriminators", () => {
  it("are the first eight bytes of sha256 of global:<name>", () => {
    const of = (name: string) =>
      createHash("sha256").update(`global:${name}`).digest().subarray(0, 8).toString("hex");
    expect(DISCRIMINATORS).toEqual({
      openTrader: of("open_trader"),
      setOrderKeys: of("set_order_keys"),
      deposit: of("deposit"),
      withdraw: of("withdraw"),
    });
  });
});

describe("a message built by the SDKs", () => {
  it("is put back together byte for byte, so the tampering below changes only what it says", () => {
    for (const name of Object.keys(fixture.cases) as CaseName[]) {
      expect(Buffer.from(tampered(name, () => undefined)).toString("hex")).toBe(
        fixture.cases[name].message,
      );
    }
  });

  it("opens a trading account, with the gate paying and the owner signing", () => {
    const result = decodeCase("openTrader");
    expect(result).toMatchObject({
      ok: true,
      request: {
        kind: "openTrader",
        network: "rollup",
        owner: meta.owner,
        feePayer: meta.gate,
        signatureCount: 2,
        amountAtoms: null,
        orderKeys: meta.orderKeys,
      },
    });
  });

  it("sets the order keys with the owner alone", () => {
    expect(decodeCase("setOrderKeys")).toMatchObject({
      ok: true,
      request: { kind: "setOrderKeys", feePayer: meta.owner, signatureCount: 1 },
    });
  });

  it("deposits into the owner's seat, in atoms", () => {
    expect(decodeCase("deposit")).toMatchObject({
      ok: true,
      request: { kind: "deposit", network: "rollup", amountAtoms: 50_000_000n },
    });
  });

  it("withdraws from the owner's seat, in atoms", () => {
    expect(decodeCase("withdraw")).toMatchObject({
      ok: true,
      request: { kind: "withdraw", network: "rollup", amountAtoms: 25_500_000n },
    });
  });

  it.each([
    ["depositFirstPrivate", "first", 5],
    ["depositFirstPublic", "first", 3],
    ["depositRepeatPrivate", "repeat", 4],
    ["depositRepeatPublic", "repeat", 3],
  ] as const)("moves USDC into the rollup: %s", (name, variant, steps) => {
    const result = decodeCase(name);
    expect(result).toMatchObject({
      ok: true,
      request: {
        kind: "depositToRollup",
        network: "solana",
        variant,
        amountAtoms: 12_340_000n,
        feePayer: meta.owner,
        signatureCount: 1,
      },
    });
    expect(
      result.ok && result.request.type === "transaction" && result.request.instructions,
    ).toHaveLength(steps);
  });

  it("brings USDC back to Solana", () => {
    const result = decodeCase("withdrawToSolana");
    expect(result).toMatchObject({
      ok: true,
      request: { kind: "withdrawToSolana", amountAtoms: 7_000_001n, signatureCount: 1 },
    });
    expect(result.ok && result.request.accountsOpened).toBe(3);
  });

  it("takes a deposit only in the variant the build pins", () => {
    refusedWith(
      decode(bytesOf("depositFirstPrivate"), "solana", { privateBalance: false }),
      "notAllowed",
      "count",
    );
    refusedWith(
      decode(bytesOf("depositRepeatPublic"), "solana", { privateBalance: true }),
      "notAllowed",
      "count",
    );
  });
});

describe("the structure every message must have", () => {
  it("refuses nothing, an oversize message and a trailing byte", () => {
    refusedWith(decode(new Uint8Array(0), "rollup"), "notDecodable", "empty");
    refusedWith(decode(new Uint8Array(1233).fill(1), "rollup"), "notDecodable", "tooLong");
    const padded = Uint8Array.from([...bytesOf("deposit"), 0]);
    refusedWith(decode(padded, "rollup"), "notDecodable", "notCanonical");
  });

  it("refuses a versioned message", () => {
    const versioned = MessageV0.compile({
      payerKey: OWNER,
      recentBlockhash: meta.recentBlockhash,
      instructions: [
        SystemProgram.transfer({ fromPubkey: OWNER, toPubkey: ATTACKER, lamports: 1 }),
      ],
    }).serialize();
    refusedWith(decode(versioned, "solana"), "notDecodable", "versioned");
  });

  it("refuses bytes that are not a message", () => {
    refusedWith(decode(new Uint8Array(40).fill(9), "rollup"), "notDecodable", "unparsable");
  });

  it("refuses a compute budget instruction added", () => {
    const rollup = tampered("deposit", (tx) =>
      tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })),
    );
    refusedWith(decode(rollup, "rollup"), "notAllowed", "program");
    const solana = tampered("withdrawToSolana", (tx) =>
      tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 })),
    );
    refusedWith(decode(solana, "solana"), "notAllowed", "program");
  });

  it("refuses a memo instruction added", () => {
    const memo = new TransactionInstruction({
      programId: MEMO,
      keys: [],
      data: Buffer.from("hello"),
    });
    refusedWith(
      decode(
        tampered("setOrderKeys", (tx) => tx.add(memo)),
        "rollup",
      ),
      "notAllowed",
      "program",
    );
  });

  it("refuses a durable nonce advance as the first instruction", () => {
    const advance = SystemProgram.nonceAdvance({
      noncePubkey: OTHER_KEY,
      authorizedPubkey: OWNER,
    });
    refusedWith(
      decode(
        tampered("depositRepeatPrivate", (tx) => tx.instructions.unshift(advance)),
        "solana",
      ),
      "notAllowed",
      "program",
    );
  });

  it("refuses an instruction of a program it does not know, with the right ones beside it", () => {
    const foreign = new TransactionInstruction({
      programId: OTHER_KEY,
      keys: [],
      data: Buffer.from("x"),
    });
    refusedWith(
      decode(
        tampered("withdraw", (tx) => tx.add(foreign)),
        "rollup",
      ),
      "notAllowed",
      "program",
    );
  });

  it("refuses an instruction count one higher", () => {
    refusedWith(
      decode(
        tampered("deposit", (tx) => tx.add(tx.instructions[0])),
        "rollup",
      ),
      "notAllowed",
      "count",
    );
    refusedWith(
      decode(
        tampered("withdrawToSolana", (tx) => tx.add(tx.instructions[2])),
        "solana",
      ),
      "notAllowed",
      "count",
    );
  });

  it("refuses a rollup shape sent as Solana, and a Solana shape sent as the rollup", () => {
    refusedWith(decode(bytesOf("deposit"), "solana"), "notAllowed", "network");
    refusedWith(decode(bytesOf("withdrawToSolana"), "rollup"), "notAllowed", "network");
  });

  it("refuses a message built for another owner", () => {
    refusedWith(decode(bytesOf("deposit"), "rollup", {}, ATTACKER), "notAllowed", "mismatch");
    refusedWith(
      decode(bytesOf("withdrawToSolana"), "solana", {}, ATTACKER),
      "notAllowed",
      "mismatch",
    );
  });

  it("refuses the order book's program under another id", () => {
    refusedWith(
      decode(bytesOf("deposit"), "rollup", { orderbookProgram: ATTACKER }),
      "notAllowed",
      "program",
    );
  });

  it("refuses an unknown discriminator", () => {
    const changed = tampered("deposit", (tx) => {
      tx.instructions[0].data = Buffer.from(tx.instructions[0].data.fill(0, 0, 8));
    });
    refusedWith(decode(changed, "rollup"), "notAllowed", "discriminator");
  });
});

describe("a deposit into the order book", () => {
  const viewOf = (key: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("view"), key.toBytes()],
      new PublicKey(meta.orderbookProgram),
    )[0];
  const tokenOf = (key: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [
        key.toBytes(),
        new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").toBytes(),
        new PublicKey(meta.usdcMint).toBytes(),
      ],
      new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
    )[0];

  it("refuses to fund another trader's seat with the owner's signature", () => {
    const funded = tampered("deposit", (tx) => {
      tx.instructions[0].keys[3].pubkey = viewOf(ATTACKER);
    });
    refusedWith(decode(funded, "rollup"), "notAllowed", "mismatch");
  });

  it("refuses a source that is not the owner's token account", () => {
    const taken = tampered("deposit", (tx) => {
      tx.instructions[0].keys[6].pubkey = tokenOf(ATTACKER);
    });
    refusedWith(decode(taken, "rollup"), "notAllowed", "mismatch");
  });

  it("refuses a depositor who is not the owner", () => {
    const other = tampered("deposit", (tx) => {
      tx.feePayer = ATTACKER;
      tx.instructions[0].keys[0].pubkey = ATTACKER;
    });
    refusedWith(decode(other, "rollup"), "notAllowed", "mismatch");
  });

  it("refuses an amount of zero", () => {
    const empty = tampered("deposit", (tx) => {
      tx.instructions[0].data.fill(0, 9, 17);
    });
    refusedWith(decode(empty, "rollup"), "notAllowed", "zeroAmount");
  });

  it("refuses a spot asset where only collateral is allowed", () => {
    const spot = tampered("deposit", (tx) => {
      tx.instructions[0].data[8] = 1;
    });
    refusedWith(decode(spot, "rollup"), "notAllowed", "mismatch");
  });

  it("refuses to sign at all while the custody is not pinned", () => {
    refusedWith(
      decode(bytesOf("deposit"), "rollup", { custodyAuthority: null }),
      "notAllowed",
      "notConfigured",
    );
    refusedWith(
      decode(bytesOf("withdraw"), "rollup", { custodyAuthority: null }),
      "notAllowed",
      "notConfigured",
    );
  });

  it("refuses a custody the build did not pin", () => {
    refusedWith(
      decode(bytesOf("deposit"), "rollup", { custodyAuthority: ATTACKER }),
      "notAllowed",
      "mismatch",
    );
  });
});

describe("a withdrawal from the order book", () => {
  const tokenOf = (key: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [
        key.toBytes(),
        new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").toBytes(),
        new PublicKey(meta.usdcMint).toBytes(),
      ],
      new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
    )[0];

  it("refuses to pay a token account that is not the owner's", () => {
    const paid = tampered("withdraw", (tx) => {
      tx.instructions[0].keys[6].pubkey = tokenOf(ATTACKER);
    });
    refusedWith(decode(paid, "rollup"), "notAllowed", "mismatch");
  });

  it("refuses a withdrawal that leaves out a risk account", () => {
    const short = tampered("withdraw", (tx) => {
      tx.instructions[0].keys.pop();
    });
    refusedWith(decode(short, "rollup"), "notAllowed", "mismatch");
  });

  it("refuses a withdrawal with a risk account added", () => {
    const long = tampered("withdraw", (tx) => {
      tx.instructions[0].keys.push({ pubkey: ATTACKER, isSigner: false, isWritable: false });
    });
    refusedWith(decode(long, "rollup"), "notAllowed", "mismatch");
  });
});

describe("opening a trading account and changing the device", () => {
  it("refuses an owner marked writable", () => {
    const writable = tampered("openTrader", (tx) => {
      tx.instructions[0].keys[1].isWritable = true;
    });
    refusedWith(decode(writable, "rollup"), "notAllowed", "mismatch");
  });

  it("refuses a third signer", () => {
    const third = tampered("openTrader", (tx) => {
      tx.instructions[0].keys.push({ pubkey: OTHER_KEY, isSigner: true, isWritable: false });
    });
    refusedWith(decode(third, "rollup"), "notAllowed", "mismatch");
  });

  it("refuses an extra signer on a device change", () => {
    const extra = tampered("setOrderKeys", (tx) => {
      tx.instructions[0].keys.push({ pubkey: OTHER_KEY, isSigner: true, isWritable: false });
    });
    refusedWith(decode(extra, "rollup"), "notAllowed", "mismatch");
  });

  it("refuses the owner as the one who pays", () => {
    const self = tampered("openTrader", (tx) => {
      tx.feePayer = OWNER;
      tx.instructions[0].keys[0].pubkey = OWNER;
    });
    refusedWith(decode(self, "rollup"), "notAllowed", "payer");
  });

  it("refuses order keys that repeat, or that are the owner's or the empty key", () => {
    const withKeys = (name: CaseName, keys: PublicKey[]) =>
      tampered(name, (tx) => {
        tx.instructions[0].data = Buffer.concat([
          tx.instructions[0].data.subarray(0, 8),
          ...keys.map((key) => key.toBuffer()),
        ]);
      });
    const [a, b, c] = meta.orderKeys.map((key) => new PublicKey(key));
    for (const keys of [
      [a, a, b, c],
      [a, b, c, OWNER],
      [a, b, c, PublicKey.default],
    ]) {
      refusedWith(decode(withKeys("setOrderKeys", keys), "rollup"), "notAllowed", "orderKeys");
    }
  });

  it("refuses order keys of the wrong length", () => {
    const short = tampered("setOrderKeys", (tx) => {
      tx.instructions[0].data = tx.instructions[0].data.subarray(0, 8 + 96);
    });
    refusedWith(decode(short, "rollup"), "notAllowed", "orderKeys");
  });
});

describe("a move into or out of the rollup on Solana", () => {
  const replaceData = (index: number, change: (data: Buffer) => void) => (tx: Transaction) => {
    const data = Buffer.from(tx.instructions[index].data);
    change(data);
    tx.instructions[index].data = data;
  };

  it("refuses another validator, in the delegation and in the shuttle", () => {
    const delegation = tampered(
      "depositRepeatPrivate",
      replaceData(2, (data) => OTHER_KEY.toBuffer().copy(data, 1)),
    );
    refusedWith(decode(delegation, "solana"), "notAllowed", "mismatch");
    const shuttle = tampered(
      "withdrawToSolana",
      replaceData(3, (data) => OTHER_KEY.toBuffer().copy(data, 13)),
    );
    refusedWith(decode(shuttle, "solana"), "notAllowed", "mismatch");
  });

  it("refuses another mint", () => {
    const mint = tampered("depositFirstPrivate", (tx) => {
      tx.instructions[0].keys[3].pubkey = ATTACKER;
    });
    refusedWith(decode(mint, "solana"), "notAllowed", "mismatch");
  });

  it("refuses a destination that is not the owner's token account", () => {
    const destination = tampered("withdrawToSolana", (tx) => {
      const ata = tx.instructions[3].keys.findIndex(
        (key) => key.pubkey.toBase58() === tx.instructions[0].keys[1].pubkey.toBase58(),
      );
      tx.instructions[3].keys[ata].pubkey = ATTACKER;
    });
    refusedWith(decode(destination, "solana"), "notAllowed", "mismatch");
  });

  it("refuses a source that is not the owner's token account", () => {
    const source = tampered("depositRepeatPrivate", (tx) => {
      const last = tx.instructions[3].keys;
      last[last.length - 2].pubkey = ATTACKER;
    });
    refusedWith(decode(source, "solana"), "notAllowed", "mismatch");
  });

  it("refuses an owner who is not the one who pays", () => {
    const payer = tampered("withdrawToSolana", (tx) => {
      tx.feePayer = ATTACKER;
      for (const step of tx.instructions) {
        for (const key of step.keys)
          if (key.pubkey.equals(OWNER) && key.isWritable) key.pubkey = ATTACKER;
      }
    });
    refusedWith(decode(payer, "solana"), "notAllowed", "mismatch");
  });

  it("refuses to initialise the vault", () => {
    const vault = new TransactionInstruction({
      programId: ESPL_PROGRAM,
      keys: [],
      data: Buffer.from([1]),
    });
    refusedWith(
      decode(
        tampered("depositFirstPrivate", (tx) => tx.instructions.unshift(vault)),
        "solana",
      ),
      "notAllowed",
      "initVault",
    );
  });

  it("refuses an amount of zero", () => {
    const first = tampered(
      "depositFirstPrivate",
      replaceData(1, (data) => data.fill(0, 1, 9)),
    );
    refusedWith(decode(first, "solana"), "notAllowed", "zeroAmount");
    const shuttle = tampered(
      "withdrawToSolana",
      replaceData(3, (data) => data.fill(0, 5, 13)),
    );
    refusedWith(decode(shuttle, "solana"), "notAllowed", "zeroAmount");
  });

  it("refuses a transfer instruction whose tag is another of the program's", () => {
    const retagged = tampered(
      "depositFirstPublic",
      replaceData(1, (data) => data.writeUInt8(3, 0)),
    );
    refusedWith(decode(retagged, "solana", { privateBalance: false }), "notAllowed", "instruction");
  });

  it("takes the amount from the instruction and holds every account to the owner", () => {
    const small = tampered(
      "depositFirstPublic",
      replaceData(1, (data) => data.writeBigUInt64LE(1n, 1)),
    );
    expect(decode(small, "solana", { privateBalance: false })).toMatchObject({
      ok: true,
      request: { amountAtoms: 1n },
    });
  });

  it("refuses an instruction it does not know of the right program", () => {
    const unknown = new TransactionInstruction({
      programId: ESPL_PROGRAM,
      keys: [],
      data: Buffer.from([200]),
    });
    refusedWith(
      decode(
        tampered("withdrawToSolana", (tx) => tx.add(unknown)),
        "solana",
      ),
      "notAllowed",
      "instruction",
    );
  });

  it("refuses the right instructions in the wrong order", () => {
    const swapped = tampered("depositFirstPrivate", (tx) => {
      [tx.instructions[0], tx.instructions[1]] = [tx.instructions[1], tx.instructions[0]];
    });
    refusedWith(decode(swapped, "solana"), "notAllowed", "sequence");
  });
});

describe("a sign-in message", () => {
  const ADDRESS = OWNER.toBase58();
  const NOW = 1_750_000_000_000;
  const text = (value: string) => new TextEncoder().encode(value);

  it("is read as a sign-in for the account", () => {
    const result = decodeSignInMessage(
      text(`Login to Query Filtering Service\nTimestamp: 1750000000\nUser: ${ADDRESS}`),
      ADDRESS,
      NOW,
    );
    expect(result).toEqual({
      ok: true,
      request: { type: "signIn", address: ADDRESS, timestamp: 1_750_000_000 },
    });
  });

  it("refuses a transaction message presented as a sign-in", () => {
    refusedWith(decodeSignInMessage(bytesOf("deposit"), ADDRESS, NOW), "notDecodable", "notText");
    refusedWith(
      decodeSignInMessage(text("Sign this to continue"), ADDRESS, NOW),
      "notAllowed",
      "notChallenge",
    );
  });
});

describe("a malformed message", () => {
  /** One instruction in a message with one account: the owner, who signs. */
  function crafted(programIdIndex: number, accountIndex: number): Uint8Array {
    return Uint8Array.from([
      1,
      0,
      0,
      1,
      ...OWNER.toBytes(),
      ...new PublicKey(meta.recentBlockhash).toBytes(),
      1,
      programIdIndex,
      1,
      accountIndex,
      0,
    ]);
  }

  it("is read when every index is in range, so the cases below break only that", () => {
    expect(() => decode(crafted(0, 0), "rollup")).not.toThrow();
    refusedWith(decode(crafted(0, 0), "rollup"), "notAllowed", "program");
  });

  it("is refused, not thrown, for a program index out of range", () => {
    expect(() => decode(crafted(5, 0), "rollup")).not.toThrow();
    refusedWith(decode(crafted(5, 0), "rollup"), "notDecodable", "unparsable");
  });

  it("is refused, not thrown, for an account index out of range", () => {
    expect(() => decode(crafted(0, 9), "solana")).not.toThrow();
    refusedWith(decode(crafted(0, 9), "solana"), "notDecodable", "unparsable");
  });

  it("is refused, not thrown, when truncated at any length", () => {
    const whole = bytesOf("depositRepeatPrivate");
    for (const length of [1, 3, 4, 40, 100, whole.length - 1]) {
      const result = decode(whole.subarray(0, length), "solana");
      expect(result.ok).toBe(false);
    }
    expect(decodeSignInMessage(crafted(5, 0), OWNER.toBase58(), 0).ok).toBe(false);
  });
});

describe("the approval of trading keys", () => {
  it("lists all four keys, and states the risk for each kind", async () => {
    const { approvalView } = await import("../../../src/presentation/walletBridge.js");
    const { walletBridgeCopy } = await import("../../../src/copy/walletBridge.js");
    for (const name of ["openTrader", "setOrderKeys"] as const) {
      const decoded = decodeCase(name);
      if (!decoded.ok) throw new Error("fixture refused");
      const view = approvalView(
        decoded.request,
        { label: "Main", address: meta.owner },
        null,
        "passed",
      );
      expect(view.orderKeys.map((key) => key.full)).toEqual(meta.orderKeys);
      expect(view.orderKeys.every((key) => key.short.includes("..."))).toBe(true);
      expect(view.lines.join(" ")).toMatch(/including orders that lose it, but cannot withdraw/);
    }
    expect(walletBridgeCopy.setOrderKeys.lines.join(" ")).toMatch(/replaces the account's current/);
    expect(walletBridgeCopy.setOrderKeys.lines.join(" ")).toMatch(/old keys stops trading/);
  });
});
