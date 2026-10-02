# infrastructure

Clients for everything outside the device: the Solana RPC, Jupiter, MagicBlock and the relayer. Each implements an interface that `application/` declares, and reaches the network only through the relay the platform seam provides.

**Belongs here:** request building, response parsing, retries.

**May import:** `domain/`, `application/` (for the interfaces it implements) and `platform.ts`.

**Must never import:** `presentation/`, `copy/`, `design/`, `testing/`. A client reports what happened; it does not decide what people are told.
