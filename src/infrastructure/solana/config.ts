import { PublicKey } from "@solana/web3.js";
import { getPlatform, type Env } from "../../platform.js";

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
 * The browser never talks to the RPC provider, Jupiter or MagicBlock. It
 * talks to its own relay routes, so those three see the relay's address and
 * never a visitor's. Where the relay is comes from `configureHttp`
 * (../httpConfig.ts); the providers' real URLs and keys belong to the server.
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
    label: "Solana mainnet",
    privatePaymentCluster: "mainnet",
    usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    genesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  },
  devnet: {
    label: "Solana devnet",
    privatePaymentCluster: "devnet",
    usdcMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  },
};

/** The public devnet RPC, for a server or a script on devnet with no provider of its own. Mainnet has none, on purpose. */
export const DEVNET_RPC_URL = "https://api.devnet.solana.com";

function network(): SolanaNetwork {
  return getPlatform().env.network === "mainnet-beta" ? "mainnet" : "devnet";
}

function profile(): NetworkProfile {
  return NETWORKS[network()];
}

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

/** The relay to MagicBlock's private-payment API. */
export const PRIVATE_PAYMENT_RELAY_PATH = "/api/private-payments";

/** The relay to Jupiter, the swap venue. Every trade is priced and built through it. */
export const JUPITER_RELAY_PATH = "/api/jupiter";

const RATE_LIMIT_RETRIES = 3;

/**
 * A request to Jupiter that waits out a rate limit instead of failing on it,
 * for as long as the API asks or, through the relay, which passes no upstream
 * header on, with a doubling pause. A pie prices several orders back to back,
 * and one busy second must not fail the whole review. Only for requests that
 * move nothing - prices and unsigned transactions - never for submitting a
 * signed one.
 */
export async function jupiterFetch(url: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, init);
    if (response.status !== 429 || attempt >= RATE_LIMIT_RETRIES) return response;
    const wait = Number(response.headers.get("retry-after")) * 1000 || 2_000 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
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
};

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
  const env: Env = {
    network: name === "mainnet" ? "mainnet-beta" : "devnet",
    referralAccount: settings.referralAccount?.trim() || null,
    feeBps: feeText ? Number(feeText) : 0,
  };
  if (feeText && env.feeBps === 0) {
    throw new Error("The NoirWire fee must be a whole number of basis points from 50 to 255.");
  }
  referralOf(env);
  return env;
}

/** Jupiter's chart data; the source of every chart and sparkline. Only the server reads it. */
export const PRICE_HISTORY_API_URL = "https://datapi.jup.ag";
