/**
 * Fixed-width reads over plain bytes, for everything the checks before
 * signing decode. Deliberately not `Buffer` methods: a browser bundle can
 * carry more than one Buffer implementation, and an older one has no 64-bit
 * readers, so a check that works in Node would throw in the browser.
 * `DataView` is the same everywhere.
 */

function view(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

/** A little-endian u64 at `offset`. Throws a RangeError when `data` is too short. */
export function readU64LE(data: Uint8Array, offset: number): bigint {
  return view(data).getBigUint64(offset, true);
}

/** A little-endian u32 at `offset`. Throws a RangeError when `data` is too short. */
export function readU32LE(data: Uint8Array, offset: number): number {
  return view(data).getUint32(offset, true);
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** `bytes` in base58, as the chain writes a signature or an address. */
export function base58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let encoded = "";
  for (; value > 0n; value /= 58n) encoded = BASE58[Number(value % 58n)] + encoded;
  for (let i = 0; bytes[i] === 0; i += 1) encoded = `1${encoded}`;
  return encoded;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}
