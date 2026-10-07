import { createPublicKey, verify } from "node:crypto";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { profileMirror, signMessage } from "../../src/infrastructure/solana/profile.js";
import { profileAccounts } from "../../src/infrastructure/solana/profileProgram.js";
import {
  fakeApi,
  installTestPlatform,
  type ApiCall,
  type ApiHandler,
  type FakeApi,
} from "../../src/testing/index.js";

/**
 * The profile client against a stand-in for the server's six profile routes,
 * which checks what a real one would: the challenge really signed by the
 * owner, the token it issued, and the one transaction it is handed.
 */

const PROGRAM_ID = new PublicKey("AiS6fT2x5XELHvZPrLfdzydC9xUazjS6r4z4bNDTqtHQ");
const BLOCKHASH = Keypair.generate().publicKey.toBase58();
const DATA = Uint8Array.from([1, 2, 3, 4]);

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function fromBase58(text: string): Uint8Array {
  let value = 0n;
  for (const character of text) value = value * 58n + BigInt(BASE58.indexOf(character));
  const bytes: number[] = [];
  for (; value > 0n; value >>= 8n) bytes.unshift(Number(value & 0xffn));
  for (let i = 0; text[i] === "1"; i += 1) bytes.unshift(0);
  return Uint8Array.from(bytes);
}

/** Whether `signature` is `owner`'s over `message`, by Node's own ed25519. */
function signedBy(owner: PublicKey, message: Uint8Array, signature: Uint8Array): boolean {
  const key = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), owner.toBuffer()]),
    format: "der",
    type: "spki",
  });
  return verify(null, message, key, signature);
}

const refusal = (code: string, status: number) =>
  new Response(JSON.stringify({ code, error: "A sentence nobody here reads." }), { status });

function profileAccountBytes(owner: PublicKey, revision: bigint, data: Uint8Array): string {
  const bytes = new Uint8Array(54 + data.length);
  const view = new DataView(bytes.buffer);
  bytes[8] = 1;
  bytes.set(owner.toBytes(), 10);
  view.setBigUint64(42, revision, true);
  view.setUint32(50, data.length, true);
  bytes.set(data, 54);
  return Buffer.from(bytes).toString("base64");
}

/** The server's side of the contract, for one owner. */
function server(owner: Keypair, over: Record<string, ApiHandler> = {}) {
  const gate = Keypair.generate();
  const state = {
    gate,
    issued: 0,
    /** Tokens the rollup no longer takes. */
    expired: new Set<string>(),
    stored: null as { revision: bigint; data: Uint8Array } | null,
    submitted: [] as Transaction[],
  };
  const body = (call: ApiCall) => call.json as Record<string, string>;
  const tokenTaken = (call: ApiCall) => {
    const { token } = body(call);
    return token === `token-${state.issued}` && !state.expired.has(token);
  };
  const routes: Record<string, ApiHandler> = {
    "GET /v1/profile/config": () => ({
      enabled: true,
      programId: PROGRAM_ID.toBase58(),
      gate: gate.publicKey.toBase58(),
      maxDataLen: 1024,
    }),
    "POST /v1/profile/challenge": (call) => ({ challenge: `sign-in:${body(call).owner}:nonce` }),
    "POST /v1/profile/session": (call) => {
      const { owner: claimed, challenge, signature } = body(call);
      const genuine = signedBy(
        new PublicKey(claimed),
        new TextEncoder().encode(challenge),
        fromBase58(signature),
      );
      if (!genuine) return refusal("upstream_refused", 502);
      state.issued += 1;
      return { token: `token-${state.issued}`, expiresAt: 1_790_000_000 };
    },
    "POST /v1/profile/read": (call) => {
      if (!tokenTaken(call)) return refusal("upstream_refused", 502);
      const { stored } = state;
      return {
        data: stored ? profileAccountBytes(owner.publicKey, stored.revision, stored.data) : null,
      };
    },
    "POST /v1/profile/blockhash": (call) =>
      tokenTaken(call)
        ? { blockhash: BLOCKHASH, lastValidBlockHeight: 500 }
        : refusal("upstream_refused", 502),
    "POST /v1/profile/submit": (call) => {
      if (!tokenTaken(call)) return refusal("upstream_refused", 502);
      state.submitted.push(Transaction.from(Buffer.from(body(call).transaction, "base64")));
      return { signature: "landed" };
    },
    ...over,
  };
  return { state, api: fakeApi(routes) };
}

const sending = (keepOut: string[] = [], stillUnlocked = () => true) => ({
  keepOut,
  stillUnlocked,
});
const unlocked = () => true;

let api: FakeApi | undefined;
const serve = (owner: Keypair, over?: Record<string, ApiHandler>) => {
  const made = server(owner, over);
  api = made.api;
  return made;
};

beforeEach(() => {
  installTestPlatform();
});

afterEach(() => {
  api?.restore();
  api = undefined;
});

describe("the profile settings", () => {
  it("say the feature is off unless the server says on and names its program and gate", async () => {
    const owner = Keypair.generate();
    for (const config of [
      { enabled: false },
      { enabled: true },
      { enabled: true, programId: PROGRAM_ID.toBase58() },
      { enabled: "true", programId: PROGRAM_ID.toBase58(), gate: owner.publicKey.toBase58() },
    ]) {
      serve(owner, { "GET /v1/profile/config": () => config });
      expect(await profileMirror.limits(), JSON.stringify(config)).toBeNull();
      api!.restore();
    }
  });

  it("give the size the server allows, and 2048 when it does not say", async () => {
    const owner = Keypair.generate();
    const gate = Keypair.generate().publicKey.toBase58();
    for (const [maxDataLen, most] of [
      [512, 512],
      [4096, 4096],
      [undefined, 2048],
    ]) {
      serve(owner, {
        "GET /v1/profile/config": () => ({
          enabled: true,
          programId: PROGRAM_ID.toBase58(),
          gate,
          ...(maxDataLen ? { maxDataLen } : {}),
        }),
      });
      expect(await profileMirror.limits()).toEqual({ maxDataLen: most });
      api!.restore();
    }
  });

  it("fail when the server cannot be asked, so nothing is taken for on", async () => {
    serve(Keypair.generate(), { "GET /v1/profile/config": () => refusal("not_found", 404) });
    await expect(profileMirror.limits()).rejects.toThrow();
  });
});

describe("signing the rollup's challenge", () => {
  it("gives the owner's own ed25519 signature over the message", () => {
    const owner = Keypair.generate();
    const message = new TextEncoder().encode("a challenge of some length, to sign");
    const signature = signMessage(owner, message);
    expect(signature).toHaveLength(64);
    expect(signedBy(owner.publicKey, message, signature)).toBe(true);
    expect(signedBy(Keypair.generate().publicKey, message, signature)).toBe(false);
  });
});

describe("reading a profile", () => {
  it("signs in as the owner, asks with the token, and reads what the account holds", async () => {
    const owner = Keypair.generate();
    const { state } = serve(owner);
    expect(await profileMirror.read(owner, unlocked)).toBeNull();

    state.stored = { revision: 7n, data: DATA };
    const read = await profileMirror.read(owner, unlocked);
    expect(read?.revision).toBe(7n);
    expect([...read!.data]).toEqual([...DATA]);

    const [first] = api!.callsTo("/v1/profile/read");
    expect(first.json).toEqual({ owner: owner.publicKey.toBase58(), token: "token-1" });
    expect(first.headers.authorization).toBe("Bearer test-token-1");
    // One sign-in served both reads: the token is kept in memory.
    expect(state.issued).toBe(1);
  });

  it("signs in again when the token is turned down, and reads with the new one", async () => {
    const owner = Keypair.generate();
    const { state } = serve(owner);
    state.stored = { revision: 2n, data: DATA };
    await profileMirror.read(owner, unlocked);
    state.expired.add("token-1");

    expect((await profileMirror.read(owner, unlocked))?.revision).toBe(2n);
    expect(state.issued).toBe(2);
    expect(
      api!.callsTo("/v1/profile/read").map((call) => (call.json as { token: string }).token),
    ).toEqual(["token-1", "token-1", "token-2"]);
  });

  it("never signs a challenge once the wallet has locked", async () => {
    const owner = Keypair.generate();
    serve(owner);
    await expect(profileMirror.read(owner, () => false)).rejects.toThrow("walletLocked");
    expect(api!.callsTo("/v1/profile/session")).toHaveLength(0);
  });

  it("does not read an account that is another owner's", async () => {
    const owner = Keypair.generate();
    const stranger = Keypair.generate().publicKey;
    serve(owner, {
      "POST /v1/profile/read": () => ({ data: profileAccountBytes(stranger, 1n, DATA) }),
    });
    await expect(profileMirror.read(owner, unlocked)).rejects.toThrow(/owner/);
  });
});

describe("writing a profile", () => {
  async function ready(over?: Record<string, ApiHandler>) {
    const owner = Keypair.generate();
    const made = serve(owner, over);
    await profileMirror.limits();
    return { owner, ...made };
  }

  it("hands over one legacy transaction of one instruction, paid by the gate and signed by the owner alone", async () => {
    const { owner, state } = await ready();
    expect(await profileMirror.create(owner, DATA, sending())).toBe("written");
    expect(await profileMirror.write(owner, 3n, DATA, sending())).toBe("written");

    const { profile } = profileAccounts(PROGRAM_ID, owner.publicKey);
    for (const transaction of state.submitted) {
      expect(transaction.feePayer?.equals(state.gate.publicKey)).toBe(true);
      expect(transaction.recentBlockhash).toBe(BLOCKHASH);
      expect(transaction.instructions).toHaveLength(1);
      expect(transaction.instructions[0].programId.equals(PROGRAM_ID)).toBe(true);
      expect(transaction.instructions[0].keys[3].pubkey.equals(profile)).toBe(true);
      const signatures = Object.fromEntries(
        transaction.signatures.map((entry) => [entry.publicKey.toBase58(), entry.signature]),
      );
      expect(Object.keys(signatures).sort()).toEqual(
        [state.gate.publicKey.toBase58(), owner.publicKey.toBase58()].sort(),
      );
      expect(signatures[state.gate.publicKey.toBase58()]).toBeNull();
      expect(
        signedBy(
          owner.publicKey,
          transaction.serializeMessage(),
          signatures[owner.publicKey.toBase58()]!,
        ),
      ).toBe(true);
    }
    const [created, written] = state.submitted.map((entry) => [...entry.instructions[0].data]);
    expect(created.slice(0, 8)).toEqual([225, 205, 234, 143, 17, 186, 50, 220]);
    expect(written.slice(8, 16)).toEqual([3, 0, 0, 0, 0, 0, 0, 0]);
  });

  it.each(["StaleRevision", "ProfileExists", "ProfileMissing"])(
    "answers stale when the program says %s",
    async (code) => {
      const { owner } = await ready({
        "POST /v1/profile/submit": () => refusal(code, 409),
      });
      expect(await profileMirror.write(owner, 1n, DATA, sending())).toBe("stale");
    },
  );

  it("fails on any other refusal, and is not sent a second time", async () => {
    for (const answer of [
      () => refusal("Paused", 409),
      () => refusal("RecordTooLarge", 409),
      () => refusal("unauthorized", 401),
      () => refusal("upstream_failed", 502),
    ]) {
      const { owner } = await ready({ "POST /v1/profile/submit": answer });
      await expect(profileMirror.write(owner, 1n, DATA, sending())).rejects.toThrow();
      expect(api!.callsTo("/v1/profile/submit")).toHaveLength(1);
      api!.restore();
    }
  });

  it("signs nothing that would name one of the wallet's own addresses beside the profile's owner", async () => {
    const { owner, state } = await ready();
    const keepOut = [Keypair.generate().publicKey.toBase58(), state.gate.publicKey.toBase58()];
    await expect(profileMirror.create(owner, DATA, sending(keepOut))).rejects.toThrow(/Not signed/);
    await expect(profileMirror.write(owner, 1n, DATA, sending(keepOut))).rejects.toThrow(
      /Not signed/,
    );
    expect(api!.callsTo("/v1/profile/submit")).toHaveLength(0);
    expect(api!.callsTo("/v1/profile/blockhash")).toHaveLength(0);
  });

  it("signs nothing once the wallet has locked while the write was being built", async () => {
    const { owner } = await ready();
    await profileMirror.read(owner, unlocked);
    const lockedOnceBuilt = () => api!.callsTo("/v1/profile/blockhash").length === 0;
    await expect(
      profileMirror.write(owner, 1n, DATA, sending([], lockedOnceBuilt)),
    ).rejects.toThrow("walletLocked");
    expect(api!.callsTo("/v1/profile/blockhash")).toHaveLength(1);
    expect(api!.callsTo("/v1/profile/submit")).toHaveLength(0);
  });

  it("builds nothing for a deployment it has not been told of", async () => {
    const owner = Keypair.generate();
    serve(owner, { "GET /v1/profile/config": () => ({ enabled: false }) });
    await profileMirror.limits();
    await expect(profileMirror.create(owner, DATA, sending())).rejects.toThrow();
    expect(api!.calls.filter((call) => call.path !== "/v1/profile/config")).toHaveLength(0);
  });
});
