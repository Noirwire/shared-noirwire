import { describe, expect, it } from "vitest";
import { ExtensionType, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair } from "@solana/web3.js";
import {
  inspectMint,
  multiplierAt,
  multiplierSchedule,
  multiplierSwitching,
  MULTIPLIER_SWITCH_PAUSE_SECONDS,
} from "../../src/infrastructure/solana/mintPolicy.mjs";
import { mintAccount } from "./support/mintAccount.js";

const MINT = Keypair.generate().publicKey.toBase58();
const NOW = 2_000_000_000;

describe("the mint profile a listed stock must match", () => {
  it("accepts the extension set every listed stock carries", () => {
    expect(inspectMint(MINT, mintAccount())).toEqual({
      problem: null,
      decimals: 8,
      multiplier: { current: 1, scheduled: 1, scheduledAt: 0 },
    });
  });

  it("refuses a mint that does not exist or is not Token-2022", () => {
    expect(inspectMint(MINT, null).problem).toMatch(/does not exist/);
    expect(inspectMint(MINT, mintAccount({ owner: TOKEN_PROGRAM_ID })).problem).toMatch(
      /not the Token-2022 program/,
    );
  });

  it("refuses a paused mint, a default-frozen one and one with a transfer hook program", () => {
    expect(inspectMint(MINT, mintAccount({ paused: true })).problem).toMatch(/paused/);
    expect(inspectMint(MINT, mintAccount({ defaultState: 2 })).problem).toMatch(/frozen/);
    expect(
      inspectMint(MINT, mintAccount({ hookProgram: Keypair.generate().publicKey })).problem,
    ).toMatch(/transfer hook/);
  });

  it("refuses every extension that changes what an amount is, and any it does not know", () => {
    for (const type of [
      ExtensionType.TransferFeeConfig,
      ExtensionType.InterestBearingConfig,
      ExtensionType.NonTransferable,
      ExtensionType.MintCloseAuthority,
      ExtensionType.PermissionedBurn,
      999 as ExtensionType,
    ]) {
      expect(inspectMint(MINT, mintAccount({ extra: [type] })).problem).toMatch(
        /unsupported extension/,
      );
    }
  });

  it("reads the multiplier in force now, not one scheduled for later", () => {
    const mint = inspectMint(MINT, mintAccount({ multiplier: [1.25, NOW + 60, 1.5] }));
    if (mint.problem !== null) throw new Error(mint.problem);
    expect(multiplierAt(mint.multiplier, NOW)).toBe(1.25);
    expect(multiplierAt(mint.multiplier, NOW + 60)).toBe(1.5);
  });
});

describe("a stock's display multiplier", () => {
  it("is read from a mint even when the mint no longer matches the profile", () => {
    const changed = mintAccount({ paused: true, multiplier: [2, 0, 2] });
    expect(multiplierSchedule(MINT, changed)).toEqual({ current: 2, scheduled: 2, scheduledAt: 0 });
  });

  it("is unknown for an account that is missing or not a Token-2022 mint", () => {
    expect(multiplierSchedule(MINT, null)).toBeNull();
    expect(multiplierSchedule(MINT, mintAccount({ owner: TOKEN_PROGRAM_ID }))).toBeNull();
  });

  it("counts as switching only within the pause window of a real change", () => {
    const schedule = { current: 1, scheduled: 1.01, scheduledAt: NOW };
    expect(multiplierSwitching(schedule, NOW - MULTIPLIER_SWITCH_PAUSE_SECONDS)).toBe(true);
    expect(multiplierSwitching(schedule, NOW + MULTIPLIER_SWITCH_PAUSE_SECONDS)).toBe(true);
    expect(multiplierSwitching(schedule, NOW + MULTIPLIER_SWITCH_PAUSE_SECONDS + 1)).toBe(false);
    expect(multiplierSwitching({ ...schedule, scheduled: 1 }, NOW)).toBe(false);
  });
});
