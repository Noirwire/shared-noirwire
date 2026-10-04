import { installTestPlatform } from "../../src/testing/index.js";

/**
 * Every suite runs with the in-memory ports and a fake session: devnet, no
 * trade fee, requests addressed to a server nothing answers at, carrying a
 * token nobody issued. A test that needs something else installs its own.
 */
installTestPlatform();
