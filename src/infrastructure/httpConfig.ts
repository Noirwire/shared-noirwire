/**
 * Where the clients in this folder send their requests: this site's own relay
 * routes on the web (an empty base URL, same origin), an absolute URL with a
 * header naming the client on mobile. It is configuration, not a platform
 * port: each app passes it once at boot, with `configureHttp`, next to
 * `installPlatform`.
 *
 * The relay routes keep the same paths on every platform (`/api/rpc`,
 * `/api/jupiter`, `/api/private-payments`, `/api/relayer`, `/api/prices`,
 * `/api/history`), so the provider behind each one never sees a visitor's IP
 * address next to the addresses it is asked about.
 */
export type HttpConfig = {
  baseUrl: string;
  headers(): Record<string, string>;
  /**
   * Where RPC calls go, when not to the relay's `/api/rpc` under `baseUrl`.
   * Only for code with no visitor behind it and no relay in front of it: a
   * server, or a test against a local validator.
   */
  rpcUrl?: string;
};

let configured: HttpConfig | null = null;

export function configureHttp(config: HttpConfig): void {
  configured = config;
}

export function httpConfig(): HttpConfig {
  if (!configured) {
    throw new Error(
      "@noirwire/shared: no HTTP configuration. Call configureHttp() once at app boot, before using a client.",
    );
  }
  return configured;
}

/** The address of a relay route, such as `/api/jupiter`, plus whatever follows it. */
export function relayUrl(path: string): string {
  return `${httpConfig().baseUrl}${path}`;
}

/** `init` with the configured headers added under its own, or `init` itself when there are none. */
export function relayInit(init: RequestInit = {}): RequestInit {
  const extra = httpConfig().headers();
  if (Object.keys(extra).length === 0) return init;
  return {
    ...init,
    headers: { ...extra, ...(init.headers as Record<string, string> | undefined) },
  };
}

/** The relay to the Solana RPC. */
export const RPC_RELAY_PATH = "/api/rpc";

/** Where RPC calls go: the configured provider, or the relay. */
export function rpcEndpoint(): string {
  const config = httpConfig();
  return config.rpcUrl ?? `${config.baseUrl}${RPC_RELAY_PATH}`;
}
