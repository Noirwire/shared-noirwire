import { afterEach, beforeEach } from "vitest";
import {
  guardSigningWith,
  type SignedRecord,
} from "../../../src/infrastructure/solana/signerAccounts.js";

/**
 * Installs a signing guard for every test of the file that calls it: the
 * network is taken as the right one, and each signed transaction is kept, as
 * an app's reservation would keep it. Suites that test a chain client on its
 * own use it; the guard's own rules are tested with the real wiring.
 */
export function recordSigning(): SignedRecord[] {
  const records: SignedRecord[] = [];
  beforeEach(() => {
    records.length = 0;
    guardSigningWith({
      confirmNetwork: async () => undefined,
      record: async (record) => void records.push(record),
    });
  });
  afterEach(() => guardSigningWith(null));
  return records;
}
