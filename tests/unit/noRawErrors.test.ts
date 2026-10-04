import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { failedOf } from "../../src/application/actions/common.js";
import type { FailureReason } from "../../src/application/result.js";
import { ApiError } from "../../src/domain/apiError.js";
import { simulationRefusal } from "../../src/infrastructure/solana/presign-guard.js";
import {
  describeFailure,
  failureMessage,
  saysRawChainError,
} from "../../src/presentation/actionResult.js";

/**
 * No raw chain, program or JSON error text may reach a person. It is held
 * at both ends: where a simulation's failure is worded, and where any
 * failure, whatever its source, becomes the words a view model shows.
 */

/** What the chain, a program, an RPC or a library really say when something fails. */
const RAW = [
  '{"InstructionError":[0,{"Custom":1}]}',
  'The transaction would fail on chain ({"InstructionError":[0,{"Custom":1}]}).',
  'The transaction would fail on chain ("InsufficientFundsForFee").',
  "InsufficientFundsForFee",
  '{"InstructionError":[2,"InsufficientFunds"]}',
  "Transaction simulation failed: Error processing Instruction 0: custom program error: 0x1771",
  "Program jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9 failed: custom program error: 0x1",
  "Program log: AnchorError occurred. Error Code: AccountNotInitialized. Error Number: 3012.",
  'SendTransactionError: failed to send transaction: {"code":-32002}',
  '{"code":"rate_limited","error":"Too many requests. Wait and try again."}',
  "[object Object]",
];

const REASONS: FailureReason[] = [
  "fundingFailed",
  "privateNotStarted",
  "sendFailed",
  "noPrice",
  "tradeFailed",
  "orderNotPlaced",
  "holdingsNotOpened",
  "earnFailed",
];

const RAW_LOOKING =
  /[{}[\]]|InstructionError|Insufficient|Custom|0x[0-9a-f]+|Program |custom program/i;

describe("a failure as a person reads it", () => {
  it.each(REASONS)("%s never carries the chain's own words, on either platform", (reason) => {
    for (const raw of RAW) {
      for (const platform of ["web", "mobile"] as const) {
        const failed = failedOf(reason, new Error(raw));
        const said = failureMessage(failed, platform);
        expect(said, raw).not.toMatch(RAW_LOOKING);
        expect(describeFailure(failed, platform).error, raw).not.toMatch(RAW_LOOKING);
        expect(said).not.toContain(raw);
      }
    }
  });

  it.each(REASONS)("%s never carries the server's code or sentence", (reason) => {
    const said = failureMessage(failedOf(reason, new ApiError("upstream_failed", 502)));
    expect(said).not.toMatch(/upstream|502|provider/i);
  });

  it("still passes on a guard's own plain account of why it refused", () => {
    const plain = "This transaction would also move another asset. Not signed.";
    expect(saysRawChainError(plain)).toBe(false);
    expect(failureMessage(failedOf("sendFailed", new Error(plain)))).toBe(plain);
    for (const raw of RAW) expect(saysRawChainError(raw), raw).toBe(true);
  });
});

describe("a simulation that fails", () => {
  it.each([
    { InstructionError: [0, { Custom: 1 }] },
    { InstructionError: [2, "InsufficientFunds"] },
    "AccountNotFound",
    "BlockhashNotFound",
    { InsufficientFundsForRent: { account_index: 1 } },
  ])("is worded plainly, with nothing of %j in it", (err) => {
    const { reason } = simulationRefusal(err);
    expect(reason).toBe("This would not go through if it were sent, so it was not signed.");
    expect(saysRawChainError(reason)).toBe(false);
  });

  it("says when whoever pays the network for it cannot", () => {
    expect(simulationRefusal("InsufficientFundsForFee")).toEqual({
      ok: false,
      reason: "There is not enough to cover the network cost, so this was not signed.",
      feePayerShort: true,
    });
  });
});

describe("the source", () => {
  function files(folder: string): string[] {
    return readdirSync(folder, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? files(join(folder, entry.name))
        : /\.(ts|mjs)$/.test(entry.name) && !entry.name.includes(".test.")
          ? [join(folder, entry.name)]
          : [],
    );
  }

  it("never builds a reason, an error or a string for a person out of serialised JSON", () => {
    const offenders: string[] = [];
    for (const file of files("src")) {
      if (file.includes("testing")) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          const serialises = /JSON\.stringify\(/.test(line);
          const forAPerson = /reason:|new Error\(|throw |message:|`[^`]*\$\{JSON/.test(line);
          if (serialises && forAPerson) offenders.push(`${file}:${index + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("never passes a simulation's own error into a sentence", () => {
    for (const file of files("src/infrastructure")) {
      const text = readFileSync(file, "utf8");
      if (!text.includes("simulateTransaction")) continue;
      expect(text, file).not.toMatch(/\$\{[^}]*\.err\b[^}]*\}/);
      expect(text, file).toContain("simulationRefusal(");
    }
  });
});
