import { configureHttp } from "../../../src/infrastructure/httpConfig.js";
import { paceImportWith } from "../../../src/infrastructure/solana/import.js";
import { guardSigningWith } from "../../../src/infrastructure/solana/signerAccounts.js";
import { installPlatform } from "../../../src/platform.js";
import { memoryPlatform } from "../../../src/testing/index.js";
import { RPC_URL } from "../global-setup.js";

/**
 * Runs before each integration test file. The suite has no relay in front of
 * it, so it names the local validator started by global-setup.ts as its RPC,
 * never devnet. Keeps localhost wiring out of the shipped client.
 *
 * The suite drives the chain clients directly, with no money action and so
 * no reservation behind a signature: its signing guard accepts the local
 * validator and keeps nothing. An app installs the real one with
 * `installMoney`, whose rules the unit suite holds it to.
 */
installPlatform(memoryPlatform());
configureHttp({ baseUrl: "", headers: () => ({}), rpcUrl: RPC_URL });
// A local validator has no request limit to keep under.
paceImportWith(null);
guardSigningWith({ confirmNetwork: async () => undefined, record: async () => undefined });
