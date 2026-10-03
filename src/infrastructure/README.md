# infrastructure

Clients for everything outside the device: the Solana RPC, Jupiter, Jupiter Lend, MagicBlock and the relayer, the price feeds, and the checks a transaction passes before it is signed. Each implements an interface that `application/` declares.

Where requests go is an `HttpConfig` (`httpConfig.ts`): the relay's base URL and the headers each app passes in once with `configureHttp`, and optionally an RPC provider for code with no relay in front of it. That is configuration, not a platform port. The network, and with it the USDC mint and the cluster names, comes from the platform's `env` (`solana/config.ts`), read when it is asked for.

- `solana/presign-guard.ts`, `solana/signerAccounts.ts`: every signature is preceded by a simulation of what the transaction does to the portfolio's balances.
- `solana/swap/guard.ts`: a trade is held to its own quote and checked against an independent price.
- `solana/relayed.ts`, `solana/relayer.ts`: what a relayer-paid transaction may contain and what it may cost. The relay route an app runs uses `relayed.ts` too.
- `solana/private-payments.ts`: private funding through MagicBlock, each built transaction checked before it is signed.
- `solana/mintPolicy.mjs`: what a stock's mint must look like. Plain JavaScript, so a catalog script can run it under Node with no build step.

**Belongs here:** request building, response parsing, retries, and the checks above.

**May import:** `domain/`, `application/` (for the interfaces it implements) and `platform.ts`.

**Must never import:** `presentation/`, `copy/`, `design/`, `testing/`. A client reports what happened; it does not decide what people are told.
