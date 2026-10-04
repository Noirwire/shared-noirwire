# infrastructure

Clients for everything outside the device: the Solana RPC, Jupiter, Jupiter Lend, MagicBlock and the relayer, the price feeds, and the checks a transaction passes before it is signed. Each implements an interface that `application/` declares.

Every request goes to NoirWire's own server. `api.ts` builds its address, in one function, from the environment's `apiBaseUrl` and the server's `/v1` paths. `apiSession.ts` is the anonymous session each request carries: the server's two session routes behind the keeper `application/apiSession.ts` describes, and `authorizedFetch`, which adds the token and decides what is made again after the server turns one down. `readFetch.ts` is `authorizedFetch` for a read. The network, and with it the USDC mint and the cluster names, comes from the same `env` (`solana/config.ts`), read when it is asked for; `envFrom` there refuses a server address the app should not send to.

- `solana/presign-guard.ts`, `solana/signerAccounts.ts`: every signature is preceded by a simulation of what the transaction does to the portfolio's balances.
- `solana/swap/guard.ts`: a trade is held to its own quote and checked against an independent price.
- `solana/relayed.ts`, `solana/relayer.ts`: what a relayer-paid transaction may contain and what it may cost. The server's relayer route makes the same reading as `relayed.ts`.
- `solana/private-payments.ts`: private funding through MagicBlock, each built transaction checked before it is signed.
- `solana/mintPolicy.mjs`: what a stock's mint must look like. Plain JavaScript, so a catalog script can run it under Node with no build step.

**A request that hands over a signature is never made twice, and never called unsent once it has left.** `authorizedFetch` makes a request again after a 401 only when it is a `GET` or is marked `asksAgain`, which `readFetch` and `jupiterThroughApi` do for reads and unsigned builds. A swap's `execute`, a private transfer's `send`, the relayer's `signTransaction` and an RPC `sendTransaction` are sent bare: any answer short of a clear success, a 401 included, is an unknown outcome that the chain settles. Only a request that was never made, because no session could be had, fails as `notAvailableNow`.

**The server's own errors are read by their `code`** (`domain/apiError.ts`), never by their sentence. `apiErrorOf(response)` finds one; a provider's error has none and passes as it came.

**Belongs here:** request building, response parsing, retries, and the checks above.

**May import:** `domain/`, `application/` (for the interfaces it implements) and `platform.ts`.

**Must never import:** `presentation/`, `copy/`, `design/`, `testing/`. A client reports what happened; it does not decide what people are told.
