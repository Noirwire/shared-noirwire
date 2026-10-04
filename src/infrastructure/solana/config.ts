import { PublicKey } from "@solana/web3.js";
import type { AppPlatform } from "../../domain/appPlatform.js";
import { getPlatform, type Env } from "../../platform.js";
import { apiUrl } from "../api.js";
import { apiErrorOf, authorizedFetch } from "../apiSession.js";

/**
 * Chain configuration. Nothing else in this package may hardcode a cluster
 * name or the USDC mint.
 *
 * One value, the installed `Env`'s network, decides all of them. They used to
 * be three independent switches, and a half-flipped deploy - RPC on mainnet,
 * private-payment cluster still on devnet - builds a transfer against the
 * wrong network with real money in the wallet. Deriving them from one value
 * makes that combination unrepresentable. The RPC an app talks to is checked
 * against the network too, by its genesis hash (`expectedGenesisHash`).
 *
 * Every value is read when it is asked for, never when a module loads, so an
 * app installs its platform at boot and nothing here runs before that.
 *
 * An app never talks to the RPC provider, Jupiter or MagicBlock. It talks
 * to NoirWire's server, so those three see the server's address and never a
 * visitor's. Where the server is comes from the same `Env` (`apiBaseUrl`,
 * ../api.ts); the providers' real URLs and keys belong to the server.
 */

type SolanaNetwork = "mainnet" | "devnet";

type NetworkProfile = {
  label: string;
  /** The cluster name MagicBlock's private-payment API expects. */
  privatePaymentCluster: SolanaNetwork;
  usdcMint: string;
  /** Identifies the chain an RPC actually serves, whatever its URL says. */
  genesisHash: string;
};

const NETWORKS: Record<SolanaNetwork, NetworkProfile> = {
  mainnet: {
    label: "Solana",
    privatePaymentCluster: "mainnet",
    usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    genesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  },
  devnet: {
    label: "Solana test network",
    privatePaymentCluster: "devnet",
    usdcMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  },
};

function network(): SolanaNetwork {
  return getPlatform().env.network === "mainnet-beta" ? "mainnet" : "devnet";
}

function profile(): NetworkProfile {
  return NETWORKS[network()];
}

/**
 * The network as a person is told it. On the main network that is only the
 * chain's name: which network it is goes without saying there, and is said
 * only where the app is on another one.
 */
export function networkLabel(): string {
  return profile().label;
}

export function privatePaymentCluster(): SolanaNetwork {
  return profile().privatePaymentCluster;
}

export function usdcMint(): string {
  return profile().usdcMint;
}

const mintKeys = new Map<string, PublicKey>();

/** The USDC mint as a key, one object per mint, so it compares the same however often it is asked for. */
export function usdcMintKey(): PublicKey {
  const mint = usdcMint();
  let key = mintKeys.get(mint);
  if (!key) {
    key = new PublicKey(mint);
    mintKeys.set(mint, key);
  }
  return key;
}

export function expectedGenesisHash(): string {
  return profile().genesisHash;
}

export function isMainnet(): boolean {
  return network() === "mainnet";
}

const RATE_LIMIT_RETRIES = 3;

/**
 * A request to Jupiter that waits out a rate limit instead of failing on it,
 * for as long as the API asks or, through NoirWire's server, which passes no
 * upstream header on, with a doubling pause. A pie prices several orders back to back,
 * and one busy second must not fail the whole review. Only for requests that
 * move nothing - prices and unsigned transactions - never for submitting a
 * signed one. `send` is how the request is made: plain `fetch` for a server
 * that asks Jupiter itself.
 */
export async function jupiterFetch(
  url: string,
  init: RequestInit = {},
  send: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await send(url, init);
    if (response.status !== 429 || attempt >= RATE_LIMIT_RETRIES) return response;
    const wait = Number(response.headers.get("retry-after")) * 1000 || 2_000 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

/**
 * `jupiterFetch` as an app makes it: to Jupiter's own `path`, through
 * NoirWire's server and with the app's session. Every trade is priced and
 * built through it, and Earn is read and built through it. Jupiter's own
 * answers, refusals included, come back as Jupiter wrote them; an error the
 * server wrote itself is thrown as an `ApiError`. The path carries no query:
 * the server refuses one, and builds Jupiter's from the body.
 */
export async function jupiterThroughApi(path: string, init?: RequestInit): Promise<Response> {
  const response = await jupiterFetch(apiUrl("jupiter", path), init, (url, request) =>
    authorizedFetch(url, { ...request, asksAgain: true }),
  );
  const refusal = await apiErrorOf(response);
  if (refusal) throw refusal;
  return response;
}

type Referral = { account: string | undefined; bps: number };

/**
 * NoirWire's own fee on trades, collected through Jupiter's referral program:
 * the referral account receives it (Jupiter keeps 20% of it) and the order's
 * quoted amounts already include it, so the pre-sign guard needs no change.
 * Jupiter accepts 50 to 255 basis points. Both values or neither: a fee with
 * nowhere to go is refused rather than silently not charged.
 */
function referralOf(env: Env): Referral {
  const account = env.referralAccount?.trim() || undefined;
  const bps = env.feeBps;
  if (!account && bps === 0) return { account: undefined, bps: 0 };
  if (!account || bps === 0) {
    throw new Error("Set both the Jupiter referral account and the NoirWire fee, or neither.");
  }
  if (!Number.isInteger(bps) || bps < 50 || bps > 255) {
    throw new Error("The NoirWire fee must be a whole number of basis points from 50 to 255.");
  }
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(account)) {
    throw new Error("The Jupiter referral account is not a Solana address.");
  }
  return { account, bps };
}

/** The account trade fees are paid to, or undefined when none is set. */
export function jupiterReferralAccount(): string | undefined {
  return referralOf(getPlatform().env).account;
}

/**
 * NoirWire's fee on a trade, in basis points. 0 when unset. It replaces
 * Jupiter's own default fee on the order rather than adding to it.
 */
export function noirwireFeeBps(): number {
  return referralOf(getPlatform().env).bps;
}

/** The settings an app keeps as text, such as its build-time environment variables. */
export type EnvSettings = {
  /** "mainnet" or "devnet"; unset means devnet. */
  network?: string;
  referralAccount?: string;
  feeBps?: string;
  /**
   * Where NoirWire's server is: its origin (`https://api.noirwire.com`), or
   * on the web a path of the page's own origin that the host forwards to it
   * (`/api`).
   */
  apiBaseUrl?: string;
  /** Which app this is. Only "web" runs in a browser, where `apiBaseUrl` may be a path. */
  platform?: AppPlatform;
  /** An RPC provider asked directly, for a server or a test with no visitor behind it. */
  rpcUrl?: string;
  /** True in a development build, where a server on this machine may be reached over plain http. */
  development?: boolean;
};

/** Where a development build finds a server on its own machine: itself, and the host as an Android emulator names it. */
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "10.0.2.2"];

/**
 * `text` as what every request's path is added to. Either an origin: https,
 * or http to this machine in a development build, and nothing after the host
 * but an optional port. Or, in a browser only, a path on the page's own
 * origin: it starts with one slash and has no query and no fragment. A
 * trailing slash is dropped from either.
 */
function apiBaseFrom(text: string | undefined, browser: boolean, development: boolean): string {
  const name = "The API base URL";
  const value = text?.trim();
  if (!value) throw new Error(`${name} is not set.`);
  if (value.startsWith("/")) {
    if (!browser) {
      throw new Error(`${name} can be a path only in a browser. Give an origin: "${value}".`);
    }
    if (value.startsWith("//") || /[?#\\\s]/.test(value)) {
      throw new Error(`${name} as a path must start with one slash and have no query: "${value}".`);
    }
    return value.replace(/\/+$/, "");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a URL: "${value}".`);
  }
  const local = development && url.protocol === "http:" && LOCAL_HOSTS.includes(url.hostname);
  if (url.protocol !== "https:" && !local) {
    throw new Error(
      `${name} must be https, or http to localhost, 127.0.0.1 or 10.0.2.2 in development: "${value}".`,
    );
  }
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error(`${name} must be an origin with no path: "${value}".`);
  }
  return url.origin;
}

/**
 * An `Env` from settings kept as text, refusing any combination this file
 * would refuse later. An app calls it at boot, so a bad deploy fails there
 * rather than at the first trade.
 */
export function envFrom(settings: EnvSettings): Env {
  const name = settings.network?.trim() || "devnet";
  if (name !== "mainnet" && name !== "devnet") {
    throw new Error(`The network must be "mainnet" or "devnet", got "${name}".`);
  }
  const feeText = settings.feeBps?.trim();
  const development = settings.development === true;
  const env: Env = {
    network: name === "mainnet" ? "mainnet-beta" : "devnet",
    referralAccount: settings.referralAccount?.trim() || null,
    feeBps: feeText ? Number(feeText) : 0,
    apiBaseUrl: apiBaseFrom(settings.apiBaseUrl, settings.platform === "web", development),
    ...(settings.rpcUrl?.trim() ? { rpcUrl: settings.rpcUrl.trim() } : {}),
  };

  if (feeText && env.feeBps === 0) {
    throw new Error("The NoirWire fee must be a whole number of basis points from 50 to 255.");
  }
  referralOf(env);
  return env;
}

/** Jupiter's chart data; the source of every chart and sparkline. Only the server reads it. */
export const PRICE_HISTORY_API_URL = "https://datapi.jup.ag";
