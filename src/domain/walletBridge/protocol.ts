/**
 * The messages a terminal and this wallet send each other across a window
 * boundary, and the strict reading of them. A message is a plain object with
 * `v: 1` and a `type`; it has exactly the keys its type names, every string
 * is length-capped, and every base64 value is canonical (read and written
 * again it gives the same text). Anything else is not parsed at all.
 *
 * The parsers here never throw and never answer with the offending text, only
 * with the rule that was broken, so a refusal cannot echo what an attacker
 * sent.
 */

export const BRIDGE_VERSION = 1;

/** The most a message may weigh as JSON. */
export const MAX_ENVELOPE_BYTES = 8 * 1024;
/** The most a sign-in challenge may weigh. */
export const MAX_SIGN_MESSAGE_BYTES = 512;
/** The most a legacy Solana message may weigh: the size of a packet. */
export const MAX_TRANSACTION_MESSAGE_BYTES = 1232;
export const SIGNATURE_BYTES = 64;

const ID_BYTES = 16;
const CHANNEL_BYTES = 32;

export type Id = string;
export type Channel = string;
export type NetworkName = "solana" | "rollup";

export const REFUSALS = [
  "userRefused",
  "expired",
  "busy",
  "locked",
  "notAllowed",
  "notDecodable",
  "wrongNetwork",
  "networkUnchecked",
  "pendingAction",
  "unsafeBrowser",
  "staleChannel",
] as const;
export type Refusal = (typeof REFUSALS)[number];

export const DISCONNECT_REASONS = ["accountChanged", "walletGone", "closing"] as const;
export type DisconnectReason = (typeof DISCONNECT_REASONS)[number];

export type ToWallet =
  | { v: 1; type: "connect"; id: Id; terminalNonce: Channel }
  | { v: 1; type: "signMessage"; id: Id; channel: Channel; message: string }
  | {
      v: 1;
      type: "signTransaction";
      id: Id;
      channel: Channel;
      network: NetworkName;
      message: string;
    }
  | { v: 1; type: "cancel"; id: Id; channel: Channel }
  | { v: 1; type: "disconnect"; channel: Channel };

export type ToTerminal =
  | { v: 1; type: "ready" }
  | { v: 1; type: "connected"; id: Id; channel: Channel; terminalNonce: Channel; address: string }
  | { v: 1; type: "signed"; id: Id; channel: Channel; signature: string }
  | { v: 1; type: "refused"; id: Id; channel?: Channel; reason: Refusal }
  | { v: 1; type: "disconnected"; channel: Channel; reason: DisconnectReason };

/** The rule a message broke, so a test and a log can name it without quoting the message. */
export type ParseRule = "notObject" | "tooLarge" | "version" | "type" | "keys" | "field";

export type Parsed<T> = { ok: true; message: T } | { ok: false; rule: ParseRule };

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const URL_ALPHABET = ALPHABET.slice(0, 62) + "-_";

function encodeWith(alphabet: string, bytes: Uint8Array, pad: boolean): string {
  let out = "";
  for (let at = 0; at < bytes.length; at += 3) {
    const chunk = (bytes[at] << 16) | ((bytes[at + 1] ?? 0) << 8) | (bytes[at + 2] ?? 0);
    out += alphabet[(chunk >> 18) & 63] + alphabet[(chunk >> 12) & 63];
    out += at + 1 < bytes.length ? alphabet[(chunk >> 6) & 63] : pad ? "=" : "";
    out += at + 2 < bytes.length ? alphabet[chunk & 63] : pad ? "=" : "";
  }
  return out;
}

function decodeWith(alphabet: string, text: string, pad: boolean): Uint8Array | null {
  const body = pad ? text.replace(/={1,2}$/, "") : text;
  if (body.length % 4 === 1) return null;
  if (pad && text.length % 4 !== 0) return null;
  const bytes: number[] = [];
  let bits = 0;
  let held = 0;
  for (const char of body) {
    const value = alphabet.indexOf(char);
    if (value < 0) return null;
    bits = (bits << 6) | value;
    held += 6;
    if (held >= 8) {
      held -= 8;
      bytes.push((bits >> held) & 255);
      bits &= (1 << held) - 1;
    }
  }
  const decoded = Uint8Array.from(bytes);
  return encodeWith(alphabet, decoded, pad) === text ? decoded : null;
}

/** Standard base64 with padding. */
export function encodeBase64(bytes: Uint8Array): string {
  return encodeWith(ALPHABET, bytes, true);
}

/** The bytes of canonical standard base64, or null for text that is not exactly what `encodeBase64` writes. */
export function decodeBase64(text: string): Uint8Array | null {
  return decodeWith(ALPHABET, text, true);
}

/** URL-safe base64 without padding. */
export function encodeBase64Url(bytes: Uint8Array): string {
  return encodeWith(URL_ALPHABET, bytes, false);
}

/** The bytes of canonical URL-safe base64, or null for text that is not exactly what `encodeBase64Url` writes. */
export function decodeBase64Url(text: string): Uint8Array | null {
  return decodeWith(URL_ALPHABET, text, false);
}

type Field = (value: unknown) => boolean;

const isText = (value: unknown): value is string => typeof value === "string";

function urlBytes(length: number): Field {
  return (value) => isText(value) && decodeBase64Url(value)?.length === length;
}

function base64Bytes(min: number, max: number): Field {
  return (value) => {
    if (!isText(value) || value.length > Math.ceil(max / 3) * 4) return false;
    const bytes = decodeBase64(value);
    return bytes !== null && bytes.length >= min && bytes.length <= max;
  };
}

function oneOf(allowed: readonly string[]): Field {
  return (value) => isText(value) && allowed.includes(value);
}

const isId = urlBytes(ID_BYTES);
const isChannel = urlBytes(CHANNEL_BYTES);
const isAddress: Field = (value) => isText(value) && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);

type Spec = { required: Record<string, Field>; optional?: Record<string, Field> };

const TO_WALLET: Record<string, Spec> = {
  connect: { required: { id: isId, terminalNonce: isChannel } },
  signMessage: {
    required: { id: isId, channel: isChannel, message: base64Bytes(1, MAX_SIGN_MESSAGE_BYTES) },
  },
  signTransaction: {
    required: {
      id: isId,
      channel: isChannel,
      network: oneOf(["solana", "rollup"]),
      message: base64Bytes(1, MAX_TRANSACTION_MESSAGE_BYTES),
    },
  },
  cancel: { required: { id: isId, channel: isChannel } },
  disconnect: { required: { channel: isChannel } },
};

const TO_TERMINAL: Record<string, Spec> = {
  ready: { required: {} },
  connected: {
    required: { id: isId, channel: isChannel, terminalNonce: isChannel, address: isAddress },
  },
  signed: {
    required: {
      id: isId,
      channel: isChannel,
      signature: base64Bytes(SIGNATURE_BYTES, SIGNATURE_BYTES),
    },
  },
  refused: { required: { id: isId, reason: oneOf(REFUSALS) }, optional: { channel: isChannel } },
  disconnected: { required: { channel: isChannel, reason: oneOf(DISCONNECT_REASONS) } },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function jsonBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return Infinity;
  }
}

function parseWith<T>(value: unknown, specs: Record<string, Spec>): Parsed<T> {
  if (!isPlainObject(value)) return { ok: false, rule: "notObject" };
  if (jsonBytes(value) > MAX_ENVELOPE_BYTES) return { ok: false, rule: "tooLarge" };
  if (value.v !== BRIDGE_VERSION) return { ok: false, rule: "version" };
  const type = value.type;
  if (!isText(type) || !Object.hasOwn(specs, type)) return { ok: false, rule: "type" };
  const spec = specs[type];
  const fields = { ...spec.required, ...spec.optional };
  const keys = Object.keys(value).filter((key) => key !== "v" && key !== "type");
  const unknown =
    Object.getOwnPropertySymbols(value).length > 0 ||
    keys.some((key) => !Object.hasOwn(fields, key));
  const missing = Object.keys(spec.required).some((key) => !Object.hasOwn(value, key));
  if (unknown || missing) return { ok: false, rule: "keys" };
  if (!keys.every((key) => fields[key](value[key]))) return { ok: false, rule: "field" };
  return { ok: true, message: value as T };
}

/** A message from the terminal, or the rule it broke. */
export function parseToWallet(value: unknown): Parsed<ToWallet> {
  return parseWith<ToWallet>(value, TO_WALLET);
}

/** A message from the wallet, or the rule it broke. */
export function parseToTerminal(value: unknown): Parsed<ToTerminal> {
  return parseWith<ToTerminal>(value, TO_TERMINAL);
}
