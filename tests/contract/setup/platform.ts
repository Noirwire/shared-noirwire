import { configureHttp } from "../../../src/infrastructure/httpConfig.js";
import { installPlatform } from "../../../src/platform.js";
import { memoryPlatform, testEnv } from "../../../src/testing/index.js";

/**
 * These run against mainnet by definition, so the network is part of the
 * suite's setup. RPC calls go straight to `SOLANA_RPC_URL` (see
 * vitest.contract.config.ts); nothing here goes through a relay.
 */
installPlatform(memoryPlatform({ env: testEnv({ network: "mainnet-beta" }) }));
configureHttp({ baseUrl: "", headers: () => ({}), rpcUrl: process.env.SOLANA_RPC_URL });
