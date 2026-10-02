# infrastructure

Clients for everything outside the device: the Solana RPC, Jupiter, MagicBlock and the relayer. Each implements an interface that `application/` declares, and is built with an `HttpConfig` (`httpConfig.ts`): the base URL and headers each app passes in. That is configuration, not a platform port.

**Belongs here:** request building, response parsing, retries.

**May import:** `domain/`, `application/` (for the interfaces it implements) and `platform.ts`.

**Must never import:** `presentation/`, `copy/`, `design/`, `testing/`. A client reports what happened; it does not decide what people are told.
