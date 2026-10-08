# wallet

Where the keys live, and where the catalog is bound to the price feeds.

- `keystore.ts` seals the whole wallet record with AES-256-GCM under a PBKDF2-SHA256 key, WebCrypto only. Nothing in the stored envelope is readable without the password. It also hands out the key's raw bytes (`vaultKeyBits`) for a device keystore, and turns them back into the same non-extractable key (`vaultKeyFromBits`).
- `types.ts` is the stored record: its field names, which stay as wallets already stored have them, and its vault keys.
- `store.ts` holds the decrypted wallet in memory, synchronously, for a renderer, and persists it through the platform's vault, one atomic write at a time. It locks on idle, on reset and when another tab changes the wallet under it, and re-derives every address at unlock, whether the key came from the password or from a device keystore (`unlockWithKeyBits`).
- `session.ts` hands out a signing key only for the address on screen, and only while the unlock it was taken under lasts.
- `create.ts` makes a new or imported wallet; `passwordStrength.ts` holds a password to the bar.
- `market.ts` and `amounts.ts` bind the catalog and its reads to the live prices and stock multipliers; `screenReads` is the bundle the view models take.
- `money.ts` wires every money action once per app (`installMoney`): the one pending-action store, the one signing guard (the network's genesis hash checked before each signature, each signed transaction written into its reservation before it may be sent), the use cases' dependencies, the balance refresh and the chain clients.
- `profile.ts` is `syncProfile()`, which an app calls after an unlock and after a label changes: the wallet's labels and their encrypted mirror are brought into agreement in the background. It never rejects. `profileSyncStatus()` says how it stands, for the one row in Settings that shows it, and is nothing again after every lock.
- `rewards.ts` is rewards for the app: `rewardsConfig()` says whether the server runs them, `joinRewards(inviteCode?)` joins, `rewardsState()` reads how the member stands, and `claimQueuedTrades()` claims what waits. Joining is kept in the wallet's record and goes with it on a reset. `installMoney` has every landed trade claim itself, unwaited. A wallet that has not joined sends nothing but what the first two are called for.
- `store.ts`'s `changePassword` answers `changed`, `unchanged` or `indeterminate`. A write that reports failure is read back to learn which password opens the record; when it cannot be read, the answer is `indeterminate` and the next change waits until a read-back settles it.

**May import:** `domain/`, `application/`, `infrastructure/`, `presentation/`, `copy/`, `platform.ts`.

**Nothing imports this folder** inside the package. An app imports it as `@noirwire/shared/wallet`.
