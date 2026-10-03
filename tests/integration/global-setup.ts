import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Connection } from "@solana/web3.js";

/**
 * Spins up a throwaway `solana-test-validator`, so the integration suite
 * exercises real on-chain behaviour (real rent, real fees, real
 * confirmations) without touching devnet.
 *
 * No program is preloaded any more: the app deploys none. Everything it does
 * on chain now runs through the system and SPL Token programs the validator
 * already has built in.
 *
 * Runs once for the whole integration run (Vitest `globalSetup`), in its own
 * process - state here does not carry over to test files, only its side
 * effect (a validator listening on RPC_URL) does.
 */

export const RPC_URL = "http://127.0.0.1:8899";

let validator: ChildProcess | undefined;
let ledgerDir: string | undefined;

async function waitForValidator(timeoutMs: number): Promise<void> {
  const connection = new Connection(RPC_URL, "confirmed");
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      await connection.getVersion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error(
    `solana-test-validator did not become ready within ${timeoutMs}ms: ${String(lastError)}`,
  );
}

export async function setup(): Promise<void> {
  ledgerDir = mkdtempSync(join(tmpdir(), "noirwire-test-ledger-"));

  validator = spawn(
    "solana-test-validator",
    ["--ledger", ledgerDir, "--reset", "--quiet", "--limit-ledger-size", "10000"],
    { stdio: "ignore" },
  );

  const spawnFailure = new Promise<never>((_, reject) => {
    validator?.once("error", (error) => {
      reject(new Error(`Failed to start solana-test-validator: ${String(error)}`));
    });
    validator?.once("exit", (code, signal) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`solana-test-validator exited early (code ${code}, signal ${signal})`));
      }
    });
  });

  try {
    await Promise.race([waitForValidator(30_000), spawnFailure]);
  } catch (error) {
    await teardown();
    throw error;
  }
}

export async function teardown(): Promise<void> {
  if (validator && !validator.killed) {
    validator.kill("SIGKILL");
  }
  if (ledgerDir) {
    rmSync(ledgerDir, { recursive: true, force: true });
  }
}
