import "./buffer-polyfill.js";

import { Connection } from "@solana/web3.js";
import { getPlatform } from "../../platform.js";
import { apiUrl } from "../api.js";
import { apiErrorOf, authorizedFetch } from "../apiSession.js";

/**
 * Every RPC call goes to NoirWire's server, never to the provider, so the
 * provider cannot put a visitor's IP next to an address. Code with no server
 * in front of it and no visitor behind it (a server itself, a test suite)
 * names the provider, as `rpcUrl` in its environment, and sends no session.
 *
 * The connection is made once, when this module loads, and asks the
 * environment where to send each request at the moment it sends it. The
 * address it is made with is never contacted.
 */
const UNCONFIGURED = "http://rpc.unconfigured.invalid";

/**
 * Whether an RPC request hands a signed transaction to the chain. One that
 * cannot be read is taken to, so that it is never made a second time.
 */
export function sendsTransaction(body: unknown): boolean {
  if (typeof body !== "string") return true;
  try {
    const calls: unknown = JSON.parse(body);
    return (Array.isArray(calls) ? calls : [calls]).some(
      (call) => (call as { method?: unknown } | null)?.method === "sendTransaction",
    );
  } catch {
    return true;
  }
}

/**
 * One RPC call, through the server. The provider's own answers, its JSON-RPC
 * errors included, come back as it wrote them. An error the server wrote
 * itself is not JSON-RPC and is thrown as the `ApiError` it is, so a caller
 * sees its code and never a status line with a body pasted after it.
 */
const relayedFetch: typeof fetch = async (_input, init) => {
  const { rpcUrl } = getPlatform().env;
  if (rpcUrl) return fetch(rpcUrl, init);
  const response = await authorizedFetch(apiUrl("rpc"), {
    ...init,
    asksAgain: !sendsTransaction(init?.body),
  });
  const refusal = await apiErrorOf(response);
  if (refusal) throw refusal;
  return response;
};

/**
 * Everything on a Connection that opens a websocket. The server's RPC route
 * is a plain request and response, and a socket opened from the app would go
 * around it to wherever it pointed.
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
