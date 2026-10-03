/**
 * bip39, ed25519-hd-key and @solana/web3.js all reference the bare `Buffer`
 * global. The browser has no such global, so every module that touches keys
 * or the chain imports this file first (for its side effect only) to make
 * sure `Buffer` exists before any of those libraries run.
 *
 * Deliberately not a client module, so it can also be imported from code
 * that runs on the server, where `Buffer` is already native and the guard
 * below simply does nothing.
 */
import { Buffer as BufferPolyfill } from "buffer";

type GlobalWithBuffer = typeof globalThis & { Buffer?: typeof BufferPolyfill };

const globalWithBuffer = globalThis as GlobalWithBuffer;

if (typeof globalWithBuffer.Buffer === "undefined") {
  globalWithBuffer.Buffer = BufferPolyfill;
}
