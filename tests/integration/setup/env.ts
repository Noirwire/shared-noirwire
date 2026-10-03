import { configureHttp } from "../../../src/infrastructure/httpConfig.js";
import { installPlatform } from "../../../src/platform.js";
import { memoryPlatform } from "../../../src/testing/index.js";
import { RPC_URL } from "../global-setup.js";

/**
 * Runs before each integration test file. The suite has no relay in front of
 * it, so it names the local validator started by global-setup.ts as its RPC,
 * never devnet. Keeps localhost wiring out of the shipped client.
 */
installPlatform(memoryPlatform());
configureHttp({ baseUrl: "", headers: () => ({}), rpcUrl: RPC_URL });
