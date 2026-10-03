# Architecture

The layer table and the one-paragraph summary of each piece live in [README.md](../README.md#architecture). This is the detail: how the dependency rule is enforced, the platform seam an app wires in, the wallet store's guarantees, biometric unlock, the one-reservation-per-action lifecycle, the presentation model, where a moved-in module goes, and the files that decide whether money is safe.

## The dependency rule

```
   wallet ──► presentation ──► copy ──► domain
     │             │                      ▲
     │             └──► application ──────┤
     │                    ▲     │         │
     └──► infrastructure ─┘     ▼         │
                │            platform ────┘
                └──────────────► (and domain)

   design and domain import nothing of ours
   nothing imports wallet; nothing imports from an app, a framework or Node
```

| Layer             | May import                                                                            |
| ----------------- | ------------------------------------------------------------------------------------- |
| `domain/`         | nothing of ours                                                                       |
| `design/`         | nothing of ours                                                                       |
| `platform.ts`     | `domain/` (the usage event types)                                                     |
| `copy/`           | `domain/`                                                                             |
| `application/`    | `domain/`, `platform.ts`                                                              |
| `infrastructure/` | `domain/`, `application/`, `platform.ts`                                              |
| `presentation/`   | `domain/`, `application/`, `copy/`                                                    |
| `wallet/`         | `domain/`, `application/`, `infrastructure/`, `presentation/`, `copy/`, `platform.ts` |
| `testing/`        | `platform.ts`                                                                         |

A use case reaches the chain, the store and the price feeds only through the interfaces it declares (`src/application/ports.ts` and each use case's own); an app wires the clients in. Use cases answer with reason codes from closed unions; only `presentation/` chooses the words. `wallet/` is where the keys live and where the catalog is bound to the price feeds: it composes the other layers, and nothing imports it.

A small local ESLint rule, `eslint-rules/dependency-rule.mjs`, enforces the table. It resolves every relative import against the importing file and checks the layer of the file it lands on, so `../domain/../application/x.js` and `../../src/application/x.js` are caught like `../application/x.js`, and an import that leaves `src/` (into an app, a test or the repository root) is refused outright. It also refuses React, React Native, Next, Expo, Node built-ins, `@/` paths and the package's own name. `buffer` is the npm package every Solana library already imports, not Node's module, so it is allowed; the bare `Buffer` global is not, and bytes are read with `DataView` (`src/infrastructure/solana/bytes.ts`). `tests/dependencyRule.test.ts` lints violating and allowed fixtures and checks that each one fails or passes for the stated reason.

## The platform seam

What differs by platform is a small set of interfaces in `src/platform.ts`:

```ts
interface VaultRepository {
  read(key: string): Promise<{ ok: true; value: string | null } | { ok: false }>;
  update(
    key: string,
    change: (current: string | null) => { write: string | null } | { keep: true },
  ): Promise<
    | { persisted: true; value: string | null }
    | { persisted: false; reason: "kept"; value: string | null }
    | { persisted: false; reason: "failed" }
  >;
  subscribe(onChange: (key: string) => void): () => void;
}
interface Env {
  network: "mainnet-beta" | "devnet";
  referralAccount: string | null;
  feeBps: number;
}
interface Activity {
  subscribe(onActive: () => void): () => void;
}
type Track = <E extends UsageEvent>(event: E, ...props: UsageArgs<E>) => void;
interface Locks {
  withLock<T>(name: string, fn: () => Promise<T>): Promise<T>;
}
interface Platform {
  vault: VaultRepository;
  env: Env;
  activity: Activity;
  track: Track;
  locks: Locks;
}
```

- **`vault`** is asynchronous and fallible: every call reports failure rather than throwing. `update` is an atomic read-modify-write that runs under the platform lock for its key, so nothing from this tab, another tab or another process comes between its read and its write. `subscribe` hears of every persisted change, including ones made elsewhere. Whether a value is sealed is the app's business.
- **`track`** takes only events and values from the closed list in `src/domain/usageEvents.ts`. Every property is a string from a closed union or a number, so an address cannot be passed by accident: it does not type-check.
- **`locks`** serialises across tabs on the web; `inProcessLocks()` is enough on mobile.
- **`env`** is read when a value is asked for, never when a module loads, so the package can be imported before the platform is installed. `envFrom()` in `@noirwire/shared/infrastructure` builds one from settings kept as text (build-time variables) and refuses a fee with nowhere to go.
- **`activity`** reports input and a return to the app. The idle lock counts from it: either one inside the window restarts it, either one past it locks.

Where the clients send their requests (the web's same-origin relay routes, or an absolute URL with a client header on mobile) is adapter configuration, `HttpConfig` in `src/infrastructure/httpConfig.ts`, set once with `configureHttp`. It is not a port. Every request goes to a relay route under `baseUrl` (`/api/rpc`, `/api/jupiter`, `/api/private-payments`, `/api/relayer`, `/api/prices`, `/api/history`) and carries `headers()`. `rpcUrl` names an RPC provider directly, for a server or a test that has no relay in front of it and no visitor behind it.

Each app installs its implementations once, at boot:

```ts
import { assertRuntime, installPlatform, inProcessLocks } from "@noirwire/shared/platform";
import { configureHttp, envFrom } from "@noirwire/shared/infrastructure";

assertRuntime();
installPlatform({ vault, env: envFrom(settings), activity, track, locks: inProcessLocks() });
configureHttp({ baseUrl: "", headers: () => ({}) });
```

`getPlatform()` and every client throw a clear error if nothing was installed.

Live prices are polled only while the app is in view. Whether it is, is passed to `watchLivePrices(visibility)` by the screen that shows prices: the document's visibility on the web, the app state on mobile.

Cryptography and randomness are not ports. Both platforms provide WebCrypto on `globalThis.crypto`. `assertRuntime()` checks for `crypto.subtle`, `crypto.getRandomValues`, `TextEncoder` and `TextDecoder`, so a missing polyfill stops the app at boot.

## The wallet store

`src/wallet/store.ts` keeps the decrypted wallet in memory and hands it out synchronously (`getSnapshot`, `walletExists`, `isUnlocked`, `isSaveFailing`), which is what a renderer's external-store hook needs. Persistence goes through the asynchronous vault:

- **Changes show at once and are written behind.** `updateWallet` applies a change in memory, emits, and queues the write. Writes run one at a time in the order they were made, and one tab at a time under the platform lock `noirwire-wallet-write`.
- **A write lands only over the record it was built on.** Each write is one atomic `vault.update` that compares the stored record with the one the change was applied to. When another tab wrote in between, the change is applied again to the newer record, so an old picture of the wallet is never written over newer state.
- **A failed write is surfaced, not dropped.** The change stays pending, `isSaveFailing()` turns true, and the next successful write clears it.
- **An unsaved change is visible.** `isSaving()` is true from a change until its write lands, so a screen can say it is not stored yet.
- **A reset says the wallet is gone only once it is.** `resetWallet()` locks at once, then resolves to `{ ok: true }` after the vault has removed the record (with the pending actions inside it), or `{ ok: false, reason: "notRemoved" }` with the wallet still reported as stored.
- **Old plain text phrases are deleted and checked.** Their removal is awaited after a wallet is stored or unlocked, `isPlaintextCleanupFailing()` says when it failed, and each later start tries again while a current wallet is stored.
- **Other tabs are heard.** While anything subscribes, the store listens to the vault: a routine write elsewhere is taken in; a reset, a replacement or a password change elsewhere locks this tab, because its phrase no longer belongs to what is stored.
- **Nothing is readable while locked.** The vault holds one AES-256-GCM envelope (`src/wallet/keystore.ts`). Locked, the store knows only whether a wallet exists, and that only once the vault has answered: `walletExists()` is `undefined` until then.
- **Addresses are re-derived at unlock.** Every stored address must be the one the phrase derives at its index, or the record is refused.

`tests/unit/store.test.ts` holds it to each of these with `memoryVault`, several tabs over one vault.

## Biometric unlock

A platform can keep the vault key, never the password or the phrase, in a device keystore behind a biometric check:

```ts
// from @noirwire/shared/wallet
function vaultKeyBits(envelope: Envelope, password: string): Promise<Uint8Array>;
function vaultKeyFromBits(envelope: Envelope, bits: Uint8Array): Promise<VaultKey>;
function unlockWithKeyBits(bits: Uint8Array): Promise<UnlockResult>;
function changePassword(
  current: string,
  next: string,
  options?: { onRekey?: (bits: Uint8Array) => Promise<boolean> },
): Promise<string | null>;
```

- **`vaultKeyBits`** runs the same PBKDF2-SHA256 derivation as unlocking, with the same NFKC normalisation, and returns its 32 bytes. Turning biometric unlock on is the one moment they are asked for, with the password the person just typed. They open the wallet as the password does, so they go to the keystore and nowhere else.
- **`vaultKeyFromBits`** imports them as a non-extractable AES-GCM key: exactly the key unlocking derives.
- **`unlockWithKeyBits`** makes every check `unlock` makes (the record decrypts, every address is re-derived, a result that finishes after a lock, a reset or a replacement is discarded, old plain text phrases are cleaned up). Only the key's source differs. Bits that do not open the record answer `walletCopy.store.keyRefused`; a wallet still in the previous format needs the password once.
- **`onRekey`** keeps the keystore in step with a password change. Once the record is sealed under the new key, the callback receives that key's bytes, and the change stands only if it resolves to true. False or a throw writes the old record back as it was, the old password keeps working, and the change answers `walletCopy.store.rekeyRefused`. Should the old record not go back (the vault refused the write), the answer is `rekeyNotUndone` and the new password is the one that works. The bytes are zeroed once the callback settles.

`UnlockResult` is `string | null`: null when unlocked, else the reason in words, as `unlock` has always answered. `tests/unit/keyBits.test.ts` covers each path, including an envelope sealed by the web build.

## One decision, one payment

A money action reserves its portfolio before anything is signed: under a lock every tab shares, the wallet record is read afresh, and only if the portfolio has nothing reserved or unsettled is a reservation written into it. Two taps on Confirm, or Confirm in two tabs, cannot both get as far as a signature. The reservation is kept in the encrypted wallet record, so a reload, a lock and unlock or another tab all see it. The life of one is a pure reducer in `src/application/pending.ts`; `src/application/pendingActions.ts` runs it against the store and the chain:

```
none ──reserve──► reserved ──signed──► unknown ──submitted──► submitted
                    │                     │  ▲                    │
                    │                     │  └──outcomeUnknown────┤
                    │                     │                       │
                    └──released──► none   └──chain──► landed | expired ──► none
```

Every transaction is written into the reservation as it is signed, before it can leave the device, so a reservation always says whether anything could have been sent. Only chain evidence settles it (a signature status, the block height against the transaction's last valid one, whether its blockhash is still valid), never the device's clock. With nothing to settle it by, only the person can clear it.

## The presentation model

A view model is a pure function of state that returns display-ready values, never JSX. A component renders it and forwards events. A rule or a string that a screen needs is added here, never in an app. The full rules and a worked example, the network cost of a money review, are in [src/presentation/README.md](../src/presentation/README.md).

```ts
import { networkCostView } from "@noirwire/shared/presentation";

const view = networkCostView({
  cost: { kind: "relayer", fee: 0.004, feeRaw: 4_000n, opens: null, count: 1 },
  pending: { blocked: false },
  submitting: false,
});
// { label: "Network cost", value: "less than 0.01 USDC", tone: "neutral", explanation: [],
//   moveMoney: null, details: { summary: "Network cost: less than 0.01 USDC. What is this?", ... },
//   confirmDisabled: false }
```

## Moving a module in

1. Pick its layer from the table above. Split the file if it spans two.
2. Move the file and its tests with it. Do not leave a copy in the app.
3. Replace `@/` imports with relative ones ending in `.js`.
4. Replace every platform call (`localStorage`, `window`, `document`, `process.env`, `navigator.locks`) with `getPlatform()`, and every relative `fetch` with `relayUrl()` and `relayInit()` from `src/infrastructure/httpConfig.ts`.
5. Return reason codes from closed unions. Move every string a person reads to `src/copy/`, and every decision about what a screen shows, including whether Confirm is enabled, to `src/presentation/`.
6. Add any library it needs to `peerDependencies` and `devDependencies`, at the version both apps use.
7. Export it from the layer's `index.ts`. For a new layer entry, add the subpath to `exports` in `package.json`.
8. If it is security-critical, add it to the table below.
9. Run `npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`, then `npm pack` and install the tarball in both apps.
10. Delete the app's copy and import from `@noirwire/shared/...`. Tag a new version.

## Where to look

The files that decide whether money is safe.

| What                                                                                | Where                                                                                                                |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Wallet sealing at rest (AES-256-GCM, PBKDF2-SHA256)                                 | `src/wallet/keystore.ts`                                                                                             |
| The stored record, its validation and every write to it                             | `src/wallet/store.ts`, `src/wallet/types.ts`                                                                         |
| The vault key's raw bytes for a device keystore, and unlocking with them            | `src/wallet/keystore.ts`, `src/wallet/store.ts`                                                                      |
| Key derivation and the recovery phrase                                              | `src/infrastructure/solana/keys.ts`                                                                                  |
| Handing out a key only for the address on screen, only while unlocked               | `src/wallet/session.ts`                                                                                              |
| Pre-sign guard: balances simulated before any signature                             | `src/infrastructure/solana/presign-guard.ts`, `src/infrastructure/solana/signerAccounts.ts`                          |
| Swap guard: a trade held to its own quote, and to an independent price              | `src/infrastructure/solana/swap/guard.ts`, `src/infrastructure/solana/swap/execute.ts`                               |
| What a mint may look like before it is listed or bought                             | `src/infrastructure/solana/mintPolicy.mjs`                                                                           |
| Relayer template checks and fee caps                                                | `src/infrastructure/solana/relayed.ts`                                                                               |
| Relayer pricing, and the check before a relayer-paid transaction                    | `src/infrastructure/solana/relayer.ts`                                                                               |
| Private payments: what is built, checked and sent                                   | `src/infrastructure/solana/private-payments.ts`, `src/domain/privateTransfer.ts`                                     |
| Earn: the lending vault's price and the deposit and withdraw checks                 | `src/infrastructure/solana/earn/jupiterLend.ts`                                                                      |
| Settling a sent transaction from the chain                                          | `src/infrastructure/solana/settlement.ts`, `src/infrastructure/solana/pending.ts`                                    |
| One decision, one payment                                                           | `src/application/pending.ts`, `src/application/pendingActions.ts`                                                    |
| One pending store and one signing guard per app; the network checked before signing | `src/wallet/money.ts`, `src/infrastructure/solana/signerAccounts.ts`, `src/infrastructure/solana/networkIdentity.ts` |
| Atomic vault update contract                                                        | `src/platform.ts`                                                                                                    |
| Outcome of a money action                                                           | `src/application/result.ts`                                                                                          |
| Runtime check for WebCrypto                                                         | `src/platform.ts`                                                                                                    |
| What a review says about its cost, and whether it can be confirmed                  | `src/presentation/networkCost.ts`                                                                                    |
