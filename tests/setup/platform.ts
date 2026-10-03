import { configureHttp } from "../../src/infrastructure/httpConfig.js";
import { installPlatform } from "../../src/platform.js";
import { memoryPlatform } from "../../src/testing/index.js";

/**
 * Every suite runs with the in-memory ports and the web's relay: devnet, no
 * trade fee, requests to same-origin paths with no extra headers. A test that
 * needs something else installs its own.
 */
installPlatform(memoryPlatform());
configureHttp({ baseUrl: "", headers: () => ({}) });
