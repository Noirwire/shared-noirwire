import "./buffer-polyfill.js";

import { Buffer } from "buffer";
import {
  Ed25519Program,
  PublicKey,
  type Keypair,
  type TransactionInstruction,
} from "@solana/web3.js";
import type { MirrorSending, MirrorWrite, ProfileMirror } from "../../application/ports.js";
import { apiUrl } from "../api.js";
import { apiErrorOf, authorizedFetch } from "../apiSession.js";
import { readFetch } from "../readFetch.js";
import { base58 } from "./bytes.js";
import {
  PROFILE_PROGRAM,
  createProfileInstruction,
  profileMessage,
  profileWire,
  readProfileAccount,
  writeProfileInstruction,
} from "./profileProgram.js";
import { WalletLockedError, type StillUnlocked } from "./signerAccounts.js";

/**
 * A wallet's profile on the private rollup: the encrypted copy of its
 * labels, in an account its own key owns.
 *
 * Asked for through NoirWire's server and nowhere else. The server knows the
 * rollup's address and holds the deployment's gate key, which signs beside
 * the owner and pays for every write, so neither a profile's owner nor its
 * wallet ever needs SOL for one. What passes through the server is
 * ciphertext and the owner's address, which is derived for this alone and
 * is no funding wallet's and no portfolio's.
 */

/** The size a deployment allows when it does not say. */
const DEFAULT_MAX_DATA_LEN = 2048;

/** The program's refusals that say the profile is not the one a write was built on. */
const MOVED = ["StaleRevision", "ProfileExists", "ProfileMissing"];

type Deployment = { programId: PublicKey; gate: PublicKey };

/** The deployment the server last described. A write is built for it, and for no other. */
let deployment: Deployment | null = null;

/**
 * The rollup's read token for one owner. Kept in memory only: it reads
 * nothing but ciphertext, and a reload asks for another.
 */
let reading: { owner: string; token: string } | null = null;

const posting = (body: Record<string, unknown>): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

async function answerOf<T>(response: Response, what: string): Promise<T> {
  const ours = await apiErrorOf(response);
  if (ours) throw ours;
  if (!response.ok) throw new Error(`${response.status} from ${what}.`);
  return (await response.json()) as T;
}

/**
 * `owner`'s signature on `message`. The library signs a message only as it
 * builds the instruction that proves one, so the signature is read out of
 * that instruction, at the place its own header says.
 */
export function signMessage(owner: Keypair, message: Uint8Array): Uint8Array {
  const { data } = Ed25519Program.createInstructionWithPrivateKey({
    privateKey: owner.secretKey,
    message,
  });
  const at = data[2] | (data[3] << 8);
  return Uint8Array.from(data.subarray(at, at + 64));
}

/** A read token for `owner`: the one in memory, or a new one for the rollup's challenge signed. */
async function tokenFor(owner: Keypair, stillUnlocked: StillUnlocked): Promise<string> {
  const address = owner.publicKey.toBase58();
  if (reading?.owner === address) return reading.token;
  const { challenge } = await answerOf<{ challenge?: unknown }>(
    await readFetch(apiUrl("profile", "/challenge"), posting({ owner: address })),
    "a profile challenge",
  );
  if (typeof challenge !== "string")
    throw new Error("A profile challenge was answered without one.");
  if (!stillUnlocked()) throw new WalletLockedError();
  const signature = base58(signMessage(owner, new TextEncoder().encode(challenge)));
  const { token } = await answerOf<{ token?: unknown }>(
    await readFetch(
      apiUrl("profile", "/session"),
      posting({ owner: address, challenge, signature }),
    ),
    "a profile session",
  );
  if (typeof token !== "string") throw new Error("A profile session was answered without a token.");
  reading = { owner: address, token };
  return token;
}

/**
 * A read that carries the token. Any answer short of a success is taken for
 * the token being turned down, and the read is asked once more with a new
 * one, signed for again: the rollup's tokens run out, and the answer does
 * not say when it was that.
 */
async function read<T>(
  owner: Keypair,
  stillUnlocked: StillUnlocked,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const ask = async () =>
    readFetch(
      apiUrl("profile", path),
      posting({ ...body, token: await tokenFor(owner, stillUnlocked) }),
    );
  let response = await ask();
  if (!response.ok) {
    reading = null;
    response = await ask();
  }
  return answerOf<T>(response, "a profile read");
}

/**
 * Signs the one instruction's message as `owner` and hands the transaction
 * to the server, which puts the gate's signature in the place left for it
 * and sends it. Sent once: a write that got no
 * clear answer is found, or found missing, by the next read.
 */
async function submit(
  owner: Keypair,
  build: (deployment: Deployment) => TransactionInstruction,
  { keepOut, stillUnlocked }: MirrorSending,
): Promise<MirrorWrite> {
  if (!deployment) throw new Error("No profile deployment has been read.");
  const instruction = build(deployment);
  // The owner's key is for profiles alone: nothing it signs may name a wallet beside it.
  const named = [deployment.gate, ...instruction.keys.map((key) => key.pubkey)];
  if (named.some((key) => keepOut.includes(key.toBase58()))) {
    throw new Error("A profile write would name one of the wallet's own addresses. Not signed.");
  }
  const latest = await read<{ blockhash: string }>(owner, stillUnlocked, "/blockhash", {});
  const message = profileMessage(instruction, deployment.gate, latest.blockhash);
  if (!stillUnlocked()) throw new WalletLockedError();
  const signature = signMessage(owner, message.bytes);
  const transaction = profileWire(message, [{ signer: owner.publicKey, signature }]);

  const response = await authorizedFetch(
    apiUrl("profile", "/submit"),
    posting({
      token: await tokenFor(owner, stillUnlocked),
      transaction: Buffer.from(transaction).toString("base64"),
    }),
  );
  if (response.ok) return "written";
  const refusal = await apiErrorOf(response);
  if (refusal && MOVED.includes(refusal.code)) return "stale";
  // Whatever turned it down, the token may be why: the next sync asks for another.
  reading = null;
  throw refusal ?? new Error(`${response.status} from a profile write.`);
}

export const profileMirror: ProfileMirror<Keypair> = {
  async limits() {
    deployment = null;
    const { enabled, programId, gate, maxDataLen } = await answerOf<Record<string, unknown>>(
      await readFetch(apiUrl("profile", "/config")),
      "the profile settings",
    );
    if (enabled !== true || typeof gate !== "string") return null;
    // A server that names another program has no mirrors this app will sign for.
    if (programId !== PROFILE_PROGRAM.toBase58()) return null;
    deployment = { programId: PROFILE_PROGRAM, gate: new PublicKey(gate) };
    const allowed = typeof maxDataLen === "number" && maxDataLen > 0;
    return { maxDataLen: allowed ? maxDataLen : DEFAULT_MAX_DATA_LEN };
  },

  async read(owner, stillUnlocked) {
    const { data } = await read<{ data?: unknown }>(owner, stillUnlocked, "/read", {
      owner: owner.publicKey.toBase58(),
    });
    if (data === null) return null;
    if (typeof data !== "string") throw new Error("A profile read was answered without one.");
    return readProfileAccount(Buffer.from(data, "base64"), owner.publicKey);
  },

  create: (owner, data, sending) =>
    submit(owner, (to) => createProfileInstruction(to, owner.publicKey, data), sending),

  write: (owner, expectedRevision, data, sending) =>
    submit(
      owner,
      (to) => writeProfileInstruction(to, owner.publicKey, expectedRevision, data),
      sending,
    ),
};
