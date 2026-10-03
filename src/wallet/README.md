# wallet

Where the keys live, and where the catalog is bound to the price feeds.

- `keystore.ts` seals the whole wallet record with AES-256-GCM under a PBKDF2-SHA256 key, WebCrypto only. Nothing in the stored envelope is readable without the password.
- `types.ts` is the stored record: its field names, which stay as wallets already stored have them, and its vault keys.
- `store.ts` holds the decrypted wallet in memory, synchronously, for a renderer, and persists it through the platform's vault, one atomic write at a time. It locks on idle, on reset and when another tab changes the wallet under it, and re-derives every address at unlock.
- `session.ts` hands out a signing key only for the address on screen, and only while the unlock it was taken under lasts.
- `create.ts` makes a new or imported wallet; `passwordStrength.ts` holds a password to the bar.
- `market.ts` and `amounts.ts` bind the catalog and its reads to the live prices and stock multipliers.

**May import:** `domain/`, `application/`, `infrastructure/`, `presentation/`, `copy/`, `platform.ts`.

**Nothing imports this folder** inside the package. An app imports it as `@noirwire/shared/wallet`.
