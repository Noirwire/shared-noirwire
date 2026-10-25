import "./buffer-polyfill.js";

import { Ed25519Program, type Keypair } from "@solana/web3.js";

/**
 * `owner`'s signature on `message`. The library signs a message only as it
 * builds the instruction that proves one, so the signature is read out of
 * that instruction, at the place its own header says. `secretKey` hands out
 * a fresh copy of the key's bytes, which is zeroed once it has signed.
 */
export function signMessage(owner: Keypair, message: Uint8Array): Uint8Array {
  const privateKey = owner.secretKey;
  try {
    const { data } = Ed25519Program.createInstructionWithPrivateKey({ privateKey, message });
    const at = data[2] | (data[3] << 8);
    return Uint8Array.from(data.subarray(at, at + 64));
  } finally {
    privateKey.fill(0);
  }
}
