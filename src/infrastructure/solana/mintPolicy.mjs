import {
  ExtensionType,
  getExtensionData,
  getExtensionTypes,
  getScaledUiAmountConfig,
  TOKEN_2022_PROGRAM_ID,
  unpackMint,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

/**
 * What a mint must look like on chain before the app will list it.
 *
 * A Token-2022 mint can carry extensions that change what an amount means or
 * whether a transfer settles at all. The app's balance reads, quotes and
 * pre-sign checks are written against one known profile, the one every xStocks
 * mint has today, so a mint is accepted only when it carries nothing outside
 * that profile and each configurable extension is in its harmless state.
 * Anything else is refused, including extensions this file has never heard of.
 *
 * Plain JavaScript because three things share it: the catalog generator, which
 * runs under Node with no build step, decides what is listed with it; the swap
 * guard reads the mint against it again before a buy is signed, since an
 * issuer can change these settings at any time; and the contract suite pins it
 * for every listed mint.
 */

const DEFAULT_STATE_INITIALIZED = 1;
const NO_PROGRAM = PublicKey.default;

/** Carried by every accepted mint without affecting amounts or transfers. */
const INERT_EXTENSIONS = new Set([
  ExtensionType.MetadataPointer,
  ExtensionType.TokenMetadata,
  // Encrypted balances are opt-in per account; the app never configures one.
  ExtensionType.ConfidentialTransferMint,
  // The issuer can move or burn a balance. Disclosed in the trade flow.
  ExtensionType.PermanentDelegate,
  // Display only: the raw amounts the app reads and builds transactions with are
  // unaffected. The multiplier is applied when an amount is shown.
  ExtensionType.ScaledUiAmountConfig,
]);

/** Accepted only in the state named here; returns why not, or null. */
const CONDITIONAL_EXTENSIONS = new Map([
  [
    ExtensionType.DefaultAccountState,
    (data) =>
      data[0] === DEFAULT_STATE_INITIALIZED ? null : "new token accounts start frozen (allowlist)",
  ],
  [ExtensionType.PausableConfig, (data) => (data[32] === 0 ? null : "the mint is paused")],
  [
    ExtensionType.TransferHook,
    (data) =>
      new PublicKey(data.subarray(32, 64)).equals(NO_PROGRAM)
        ? null
        : "a transfer hook program runs on every transfer",
  ],
]);

/**
 * A stock's display multiplier as the mint publishes it: the one in force,
 * and the next one with the moment it takes over. The issuer raises it to
 * reinvest a dividend or apply a split, and publishes the change ahead of
 * time, so one read stays right across the switch.
 *
 * @typedef {{ current: number, scheduled: number, scheduledAt: number }} MultiplierSchedule
 */

/** A mint without the extension has no multiplier: one token is one unit. */
const NO_MULTIPLIER = { current: 1, scheduled: 1, scheduledAt: 0 };

/**
 * @param {import("@solana/spl-token").Mint} mint
 * @returns {MultiplierSchedule}
 */
function scheduleOf(mint) {
  const config = getScaledUiAmountConfig(mint);
  if (!config) return NO_MULTIPLIER;
  return {
    current: config.multiplier,
    scheduled: config.newMultiplier,
    scheduledAt: Number(config.newMultiplierEffectiveTimestamp),
  };
}

/**
 * The multiplier in force at `nowSeconds`. The issuer's rule for Solana:
 * displayed balance = raw amount x multiplier, raw amounts in transactions.
 *
 * @param {MultiplierSchedule} schedule
 * @param {number} nowSeconds
 */
export function multiplierAt(schedule, nowSeconds) {
  return nowSeconds >= schedule.scheduledAt ? schedule.scheduled : schedule.current;
}

/**
 * The issuer advises pausing interactions with a token for a brief window
 * around the moment a new multiplier takes effect. This is that window, each
 * side of the switch.
 */
export const MULTIPLIER_SWITCH_PAUSE_SECONDS = 5 * 60;

/**
 * Whether a new multiplier takes over within the pause window around `nowSeconds`.
 *
 * @param {MultiplierSchedule} schedule
 * @param {number} nowSeconds
 */
export function multiplierSwitching(schedule, nowSeconds) {
  return (
    schedule.scheduled !== schedule.current &&
    Math.abs(nowSeconds - schedule.scheduledAt) <= MULTIPLIER_SWITCH_PAUSE_SECONDS
  );
}

/**
 * A mint's multiplier schedule, whatever else the mint carries, or null when
 * the account is not a readable Token-2022 mint. Reading a balance for
 * display needs this even for a stock that no longer matches the profile.
 *
 * @param {string} address
 * @param {import("@solana/web3.js").AccountInfo<Buffer> | null} info
 * @returns {MultiplierSchedule | null}
 */
export function multiplierSchedule(address, info) {
  if (!info || !info.owner.equals(TOKEN_2022_PROGRAM_ID)) return null;
  try {
    return scheduleOf(unpackMint(new PublicKey(address), info, info.owner));
  } catch {
    return null;
  }
}

/**
 * Reads a mint account against the accepted profile.
 *
 * @param {string} address
 * @param {import("@solana/web3.js").AccountInfo<Buffer> | null} info
 * @returns {{ problem: string } | { problem: null, decimals: number, multiplier: MultiplierSchedule }}
 */
export function inspectMint(address, info) {
  if (!info) return { problem: "the mint does not exist on chain" };
  if (!info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    return { problem: `owned by ${info.owner.toBase58()}, not the Token-2022 program` };
  }
  const mint = unpackMint(new PublicKey(address), info, info.owner);
  if (!mint.isInitialized) return { problem: "the mint is not initialized" };
  for (const type of getExtensionTypes(mint.tlvData)) {
    if (INERT_EXTENSIONS.has(type)) continue;
    const check = CONDITIONAL_EXTENSIONS.get(type);
    if (!check) return { problem: `unsupported extension ${ExtensionType[type] ?? type}` };
    const problem = check(getExtensionData(type, mint.tlvData));
    if (problem) return { problem };
  }
  return { problem: null, decimals: mint.decimals, multiplier: scheduleOf(mint) };
}
