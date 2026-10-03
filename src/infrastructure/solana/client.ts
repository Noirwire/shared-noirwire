import "./buffer-polyfill.js";

import { Connection } from "@solana/web3.js";
import { relayInit, rpcEndpoint } from "../httpConfig.js";

/**
 * Every RPC call goes to the app's own relay, never to the provider, so the
 * provider cannot put a visitor's IP next to an address. Code with no relay
 * in front of it and no visitor behind it (a server, a test suite) names the
 * provider itself, as `rpcUrl` in its HTTP configuration.
 *
 * The connection is made once, when this module loads, and asks the HTTP
 * configuration where to send each request at the moment it sends it. The
 * address it is made with is never contacted.
 */
const UNCONFIGURED = "http://rpc.unconfigured.invalid";

const relayedFetch: typeof fetch = (_input, init) => fetch(rpcEndpoint(), relayInit(init));

/**
 * Everything on a Connection that opens a websocket. The relay is a plain
 * request and response: a server function cannot hold a socket open, and one
 * opened from the browser would go around the relay to wherever it pointed.
 * A transaction is confirmed by asking for its status (`outcomeWithin` in
 * settlement.ts), never by subscribing.
 */
export const SUBSCRIBING_METHODS = [
  "confirmTransaction",
  "onAccountChange",
  "onProgramAccountChange",
  "onLogs",
  "onSlotChange",
  "onSlotUpdate",
  "onSignature",
  "onSignatureWithOptions",
  "onRootChange",
] as const;

function withoutSubscriptions(target: Connection): Connection {
  for (const method of SUBSCRIBING_METHODS) {
    Object.defineProperty(target, method, {
      value: () => {
        throw new Error(`connection.${method} would open a websocket. Poll instead.`);
      },
    });
  }
  return target;
}

export const connection = withoutSubscriptions(
  new Connection(UNCONFIGURED, { commitment: "confirmed", fetch: relayedFetch }),
);
