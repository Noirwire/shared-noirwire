import type { Wallet } from "../domain/wallet.js";
import type { NetworkName, Refusal } from "../domain/walletBridge/protocol.js";
import type {
  Decoded,
  DecodedRequest,
  DecodedSignIn,
  DecodedTransaction,
} from "../domain/walletBridge/request.js";

/**
 * Taking a request to sign from the terminal to the point where a person is
 * shown it: read what the bytes are, ask the network, and answer in reason
 * codes. Nothing here signs; `wallet/bridge.ts` is the only code that
 * touches a key.
 */

/** An account the terminal may be connected to, as the connect screen lists it. */
export type BridgeChoice = {
  kind: "funding" | "portfolio";
  /** A portfolio's own label; the main wallet has none here. */
  label: string | null;
  address: string;
  derivationIndex: number;
  /** False while an action of the account is in progress: it is shown, not selectable. */
  selectable: boolean;
};

/** The main wallet and every portfolio that is not archived. */
export function bridgeChoices(wallet: Wallet): BridgeChoice[] {
  return [
    {
      kind: "funding",
      label: null,
      address: wallet.funding.address,
      derivationIndex: 0,
      selectable: wallet.funding.pendingAction === undefined,
    },
    ...wallet.portfolios
      .filter((portfolio) => portfolio.archivedAt === null)
      .map((portfolio) => ({
        kind: "portfolio" as const,
        label: portfolio.label,
        address: portfolio.address,
        derivationIndex: portfolio.derivationIndex,
        selectable: portfolio.pendingAction === undefined,
      })),
  ];
}

/** How long a shown request waits before it is refused as expired. */
export const REQUEST_LIFETIME_MS = 120_000;
/** How long a network check holds. A request approved later than this is checked again first. */
export const NETWORK_CHECK_FRESH_MS = 60_000;

export type BridgeRequest =
  | { type: "signMessage"; message: Uint8Array }
  | { type: "signTransaction"; network: NetworkName; message: Uint8Array };

export type NetworkVerdict = "ok" | "wrongNetwork" | "networkUnchecked";

/** What the application needs from the chain clients; the wallet wires them. */
export type BridgePorts = {
  decodeSignIn(message: Uint8Array, address: string, nowMs: number): Decoded<DecodedSignIn>;
  decodeTransaction(
    message: Uint8Array,
    network: NetworkName,
    owner: string,
  ): Decoded<DecodedTransaction>;
  checkNetwork(decoded: DecodedTransaction): Promise<NetworkVerdict>;
  now(): number;
};

/** A request read and checked, ready to be shown. */
export type Reviewed = { decoded: DecodedRequest; checkedAtMs: number };

export type Review = { ok: true; reviewed: Reviewed } | { ok: false; refusal: Refusal };

/** Reads `request` for the account at `address` and checks the network it is for. */
export async function reviewRequest(
  ports: BridgePorts,
  request: BridgeRequest,
  address: string,
): Promise<Review> {
  const nowMs = ports.now();
  if (request.type === "signMessage") {
    const decoded = ports.decodeSignIn(request.message, address, nowMs);
    return decoded.ok
      ? { ok: true, reviewed: { decoded: decoded.request, checkedAtMs: nowMs } }
      : { ok: false, refusal: decoded.refusal };
  }
  const decoded = ports.decodeTransaction(request.message, request.network, address);
  if (!decoded.ok) return { ok: false, refusal: decoded.refusal };
  const verdict = await ports.checkNetwork(decoded.request);
  if (verdict !== "ok") return { ok: false, refusal: verdict };
  return { ok: true, reviewed: { decoded: decoded.request, checkedAtMs: ports.now() } };
}

/** Whether the network check on `reviewed` is too old to sign on without asking again. */
export function needsNetworkCheck(reviewed: Reviewed, nowMs: number): boolean {
  return (
    reviewed.decoded.type === "transaction" && nowMs - reviewed.checkedAtMs > NETWORK_CHECK_FRESH_MS
  );
}

/** Asks the network again for a request whose check has gone stale. */
export async function recheckNetwork(ports: BridgePorts, reviewed: Reviewed): Promise<Review> {
  if (reviewed.decoded.type !== "transaction") return { ok: true, reviewed };
  const verdict = await ports.checkNetwork(reviewed.decoded);
  return verdict === "ok"
    ? { ok: true, reviewed: { ...reviewed, checkedAtMs: ports.now() } }
    : { ok: false, refusal: verdict };
}
