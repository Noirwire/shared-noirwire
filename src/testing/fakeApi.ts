/** One request as a fake route is handed it. */
export type ApiCall = {
  method: string;
  url: URL;
  /** The path of the request, without its origin or query. */
  path: string;
  headers: Record<string, string>;
  /** The body as it was sent, or null when there was none. */
  body: string | null;
  /** The body read as JSON, or undefined when there was none. */
  json: unknown;
};

/** What a route answers: a `Response`, or a value sent as JSON with status 200. */
export type ApiHandler = (call: ApiCall) => unknown;

export type FakeApi = {
  /** Every request made since the fake was installed, in order. */
  calls: ApiCall[];
  /** The requests made to `path`. */
  callsTo(path: string): ApiCall[];
  /** Puts back the `fetch` that was there before. */
  restore(): void;
};

function headersOf(init: RequestInit | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, name) => {
    headers[name] = value;
  });
  return headers;
}

function handlerFor(routes: Record<string, ApiHandler>, call: ApiCall): ApiHandler | undefined {
  const named = [`${call.method} ${call.path}`, call.path];
  for (const name of named) if (routes[name]) return routes[name];
  // A route ending in `*` answers every path that starts with what comes before it.
  const wild = Object.keys(routes)
    .filter((route) => route.endsWith("*"))
    .sort((a, b) => b.length - a.length)
    .find((route) => named.some((name) => name.startsWith(route.slice(0, -1))));
  return wild ? routes[wild] : undefined;
}

/**
 * Stands in for the network in a test, by path. `routes` maps a path
 * (`/v1/prices`), optionally with its method in front (`POST /v1/relayer`)
 * or a `*` at its end (`/v1/jupiter/*`), to what answers it. The host is
 * not looked at, and a request to a path with no host (the web's `/api`) is
 * read as it stands. A request no route answers throws and names itself:
 * nothing ever goes out.
 *
 * It replaces the global `fetch` until `restore()` is called.
 */
export function fakeApi(routes: Record<string, ApiHandler>): FakeApi {
  const real = globalThis.fetch;
  const calls: ApiCall[] = [];

  globalThis.fetch = async (input, init) => {
    const address = typeof input === "string" || input instanceof URL ? input : input.url;
    const url = new URL(address, "http://same-origin.test");
    const body = typeof init?.body === "string" ? init.body : null;
    const call: ApiCall = {
      method: (init?.method ?? "GET").toUpperCase(),
      url,
      path: url.pathname,
      headers: headersOf(init),
      body,
      json: body === null ? undefined : (JSON.parse(body) as unknown),
    };
    calls.push(call);
    const handler = handlerFor(routes, call);
    if (!handler) throw new Error(`fakeApi: no route answers ${call.method} ${call.path}.`);
    const answer = await handler(call);
    return answer instanceof Response
      ? answer
      : new Response(JSON.stringify(answer), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
  };

  return {
    calls,
    callsTo: (path) => calls.filter((call) => call.path === path),
    restore() {
      globalThis.fetch = real;
    },
  };
}
