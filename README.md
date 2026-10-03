# @noirwire/shared

The code that holds keys and checks transactions for NoirWire's apps.

NoirWire is a non-custodial Solana wallet. One recovery phrase derives a funding wallet and separate portfolios, and the keys never leave the device. The web app and the mobile app are the same product, so the parts that must not differ between them live here, once: the encrypted wallet and its keys, the checks every transaction passes before it is signed, the clients for the chain and the venues, the money actions, the words on the screen and the design tokens. Each app is a thin layer that draws what this package decides and supplies what only a platform can: storage, locks, input events and analytics.

We publish this source so that anyone can read what runs on their device. It is not on npm; the apps install it from this repository. See [LICENSE](LICENSE) for what you may do with it.

## What is in it

Framework-free TypeScript. No React, no React Native, no Next, no DOM, no Node APIs at runtime. It builds with plain `tsc` to ES modules and type declarations in `dist/`.

```
src/
  domain/          pure rules and types: the wallet, orders, pies, fees, formatting, the usage events
  application/     one use case per money action (actions/), their results and ports, pending actions,
                   the catalog, valuation, pies, markets, each action's draft
  infrastructure/  where requests go (httpConfig.ts), and the clients behind the use cases:
    solana/          keys, the RPC client, balances, transfers, settlement, the pre-sign guard,
                     the relayer client and its template checks, private payments, the stock catalog
    solana/swap/     the Jupiter venue, the swap guard, the trade orchestration
    solana/earn/     Jupiter Lend
    prices/          live prices, price history and stock multipliers
  presentation/    view models: what each money review shows and whether it can be confirmed
  copy/            every string a person reads, by screen
  design/          tokens, class tokens for the web, brand geometry, chart paths
  wallet/          the encrypted keystore, the stored record, the store and its session (keys stay here),
                   the catalog bound to the price feeds
  platform.ts      what differs between web and mobile
  testing/         in-memory ports for tests
```

Each folder has a `README.md` saying what belongs there.

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

### The wallet store

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

### Biometric unlock

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

Cryptography and randomness are not ports. Both platforms provide WebCrypto on `globalThis.crypto`. `assertRuntime()` checks for `crypto.subtle`, `crypto.getRandomValues`, `TextEncoder` and `TextDecoder`, so a missing polyfill stops the app at boot.

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

## Moved from the mobile app in 0.3.0

- **The phone's phrase quiz** (`src/application/phraseQuiz.ts`): three random positions asked in ascending order, four choices each, a wrong pick disables that choice and names the position, the third miss in an attempt restarts with new positions. `newQuizAttempt`, `pickQuizWord`, `resumeQuiz`, with the random source injectable for tests.
- **The import findings** (`src/presentation/importFindings.ts`): `importSourceView`, `importResultView`, `importFoundText`, `importSchemeFor` and `groupsOfFour`, what each set of addresses holds in words and never an address. The types they read, `ImportResolution` and `SchemeActivity`, now live in `src/domain/importResolution.ts`; `@noirwire/shared/infrastructure` still exports them.
- **The phone's onboarding words**, `mobileOnboardingCopy` in `@noirwire/shared/copy`. How a platform variant is written is in [src/copy/README.md](src/copy/README.md).

## The presentation model

A view model is a pure function of state that returns display-ready values, never JSX. A component renders it and forwards events. A rule or a string that a screen needs is added here, never in an app. The full rules and a worked example, the network cost of a money review, are in [src/presentation/README.md](src/presentation/README.md).

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

## Using it in an app

Import by subpath. There is no root entry.

| Subpath                           | Contents                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `@noirwire/shared/platform`       | The ports, `installPlatform`, `assertRuntime`                                    |
| `@noirwire/shared/domain`         | Rules and types: the wallet, orders, pies, fees, formatting, usage events        |
| `@noirwire/shared/application`    | The use cases, `ActionResult`, pending actions, drafts, the catalog's reads      |
| `@noirwire/shared/infrastructure` | `configureHttp`, `envFrom`, the chain client, the venues, the guards, the prices |
| `@noirwire/shared/presentation`   | View models                                                                      |
| `@noirwire/shared/copy`           | Strings                                                                          |
| `@noirwire/shared/design`         | Tokens, class tokens, brand geometry, chart paths                                |
| `@noirwire/shared/wallet`         | The wallet store, its session, wallet creation, the bound catalog                |
| `@noirwire/shared/testing`        | In-memory ports                                                                  |

Each index exports the public surface of its layer, not every helper. A file that is not exported is internal and may change in any release.

### Install

Pin a tag in the app's `package.json`:

```json
"@noirwire/shared": "git+ssh://git@github.com/Noirwire/shared-noirwire.git#v0.3.0"
```

or `npm install git+ssh://git@github.com/Noirwire/shared-noirwire.git#v0.3.0`. npm clones the tag, installs the dev dependencies, runs `prepare` (the build) and installs the result. An install with `--ignore-scripts` skips that build and leaves the package empty, and so does npm 11's install-script policy until the app allows this one package: run `npm install-scripts approve @noirwire/shared` once, which records it under `allowScripts` in the app's `package.json`. Moving to a newer version is changing the tag and installing again.

The app must also carry the peer dependencies at these exact versions, so it has one copy of each:

| Package                      | Version |
| ---------------------------- | ------- |
| `@solana/web3.js`            | 1.99.0  |
| `@solana/spl-token`          | 0.4.15  |
| `@scure/bip39`               | 1.6.0   |
| `ed25519-hd-key`             | 2.0.0   |
| `buffer`                     | 6.0.3   |
| `@zxcvbn-ts/core`            | 4.2.0   |
| `@zxcvbn-ts/language-common` | 4.1.3   |

### Local iteration

```sh
# in this repository
npm pack                     # builds, then writes noirwire-shared-<version>.tgz

# in the app
npm install ../shared-noirwire/noirwire-shared-<version>.tgz
```

Repeat both after each change. Do not commit the tarball path in the app's `package.json`.

Do not use `npm install ../shared-noirwire` or a `file:` path to the folder. npm makes that a symlink to a directory outside the app. Turbopack only resolves files under the app's root, so the import fails to resolve; Metro does not watch outside the project either; and a symlinked package resolves its own `node_modules`, which gives the app a second copy of every library the two share. A tarball installs as a real folder inside `node_modules` and behaves exactly like the git dependency.

### What each app needs

- **Next.js 16 (Turbopack):** nothing. The exports map resolves by default, in server and client components.
- **Expo SDK 57 (Metro 0.84):** nothing. Metro's `resolver.unstable_enablePackageExports` is `true` by default in this version, and Expo's default config adds the `react-native` or `browser` condition. The exports map uses only `types` and `default`, so it resolves on every platform. If an app has switched `unstable_enablePackageExports` off, it must switch it back on: there is no `main` field to fall back to.
- **TypeScript:** `moduleResolution` must be `Bundler`, `Node16` or `NodeNext`. The older `node` setting does not read exports maps. The declarations are emitted by TypeScript 5.9 and checked against 5.9 and 6.0.
- **Jest (mobile):** the package is ES modules, which Jest does not load untransformed, so it joins the packages the preset lets the transformer read. In `jest.config.js`, the existing line becomes:

  ```js
  packagesToTransform.replace("(?!(", "(?!(@noirwire/shared|phosphor-react-native|"),
  ```

- The package is ES modules only. It cannot be loaded with `require()` from a CommonJS TypeScript project.
- The stock catalog is a JSON module imported with `with { type: "json" }`. Turbopack and Babel 7.26 or later read that syntax by default.
- `package.json` names `dist/infrastructure/solana/buffer-polyfill.js` as the one file with a side effect: it puts the `buffer` package's `Buffer` on the global object before the Solana libraries need it, and a bundler must not drop it.

## Development

```sh
npm install
npm run typecheck          # the tests with Node types, then the package with no ambient Node types
npm run lint
npm run format:check
npm test                   # unit tests: pure and offline
npm run test:integration   # against a local solana-test-validator, which must be on the PATH
npm run test:contract      # read-only checks against mainnet services; needs the network
npm run build
```

Unit tests are Vitest and run with the in-memory ports (`tests/setup/platform.ts`). `tests/webTokens.test.ts` compares the design tokens with the web app's stylesheet when the web app is checked out next to this repository at `../app-noirwire`, and skips otherwise.

The integration suite starts a throwaway `solana-test-validator` (`tests/integration/global-setup.ts`) and points the RPC client at it. The contract suite reads mainnet: set `SOLANA_RPC_URL` to a dedicated mainnet provider (the public endpoint rate-limits it) and, optionally, `JUPITER_API_KEY`. It signs and sends nothing. The contract checks that go through an app's relay routes live in that app.

The package itself is type-checked with `lib: ["ES2022", "WebWorker"]` and `types: []`: the web-platform globals both runtimes provide (fetch, WebCrypto, `TextEncoder`, timers, `URL`) are declared, and `window`, `document`, `localStorage` and every Node global are compile errors. The few globals the WebWorker library also declares and a phone does not have (`navigator`, `self`, `location` and the like) are refused by lint.

## Moving a module in

1. Pick its layer from the table above. Split the file if it spans two.
2. Move the file and its tests with it. Do not leave a copy in the app.
3. Replace `@/` imports with relative ones ending in `.js`.
4. Replace every platform call (`localStorage`, `window`, `document`, `process.env`, `navigator.locks`) with `getPlatform()`, and every relative `fetch` with `relayUrl()` and `relayInit()` from `src/infrastructure/httpConfig.ts`.
5. Return reason codes from closed unions. Move every string a person reads to `src/copy/`, and every decision about what a screen shows, including whether Confirm is enabled, to `src/presentation/`.
6. Add any library it needs to `peerDependencies` and `devDependencies`, at the version both apps use.
7. Export it from the layer's `index.ts`. For a new layer entry, add the subpath to `exports` in `package.json`.
8. If it is security-critical, add it to the table below.
9. Run the five checks above, then `npm pack` and install the tarball in both apps.
10. Delete the app's copy and import from `@noirwire/shared/...`. Tag a new version.

## Versioning

Semver tags on this repository: `v0.1.0`, `v0.2.0`, `v0.3.0`. The apps pin an exact tag. While the version is below 1.0, a minor bump may break; a patch never does. A change to what is sealed, derived or signed is always called out in the tag's notes.

## Where to look

The files that decide whether money is safe.

| What                                                                     | Where                                                                                       |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Wallet sealing at rest (AES-256-GCM, PBKDF2-SHA256)                      | `src/wallet/keystore.ts`                                                                    |
| The stored record, its validation and every write to it                  | `src/wallet/store.ts`, `src/wallet/types.ts`                                                |
| The vault key's raw bytes for a device keystore, and unlocking with them | `src/wallet/keystore.ts`, `src/wallet/store.ts`                                             |
| Key derivation and the recovery phrase                                   | `src/infrastructure/solana/keys.ts`                                                         |
| Handing out a key only for the address on screen, only while unlocked    | `src/wallet/session.ts`                                                                     |
| Pre-sign guard: balances simulated before any signature                  | `src/infrastructure/solana/presign-guard.ts`, `src/infrastructure/solana/signerAccounts.ts` |
| Swap guard: a trade held to its own quote, and to an independent price   | `src/infrastructure/solana/swap/guard.ts`, `src/infrastructure/solana/swap/execute.ts`      |
| What a mint may look like before it is listed or bought                  | `src/infrastructure/solana/mintPolicy.mjs`                                                  |
| Relayer template checks and fee caps                                     | `src/infrastructure/solana/relayed.ts`                                                      |
| Relayer pricing, and the check before a relayer-paid transaction         | `src/infrastructure/solana/relayer.ts`                                                      |
| Private payments: what is built, checked and sent                        | `src/infrastructure/solana/private-payments.ts`, `src/domain/privateTransfer.ts`            |
| Earn: the lending vault's price and the deposit and withdraw checks      | `src/infrastructure/solana/earn/jupiterLend.ts`                                             |
| Settling a sent transaction from the chain                               | `src/infrastructure/solana/settlement.ts`, `src/infrastructure/solana/pending.ts`           |
| One decision, one payment                                                | `src/application/pending.ts`, `src/application/pendingActions.ts`                           |
| Atomic vault update contract                                             | `src/platform.ts`                                                                           |
| Outcome of a money action                                                | `src/application/result.ts`                                                                 |
| Runtime check for WebCrypto                                              | `src/platform.ts`                                                                           |
| What a review says about its cost, and whether it can be confirmed       | `src/presentation/networkCost.ts`                                                           |

## Security

Report a vulnerability privately: see [SECURITY.md](SECURITY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

Copyright (c) 2026 NoirWire. All rights reserved. Published for transparency; no licence is granted. See [LICENSE](LICENSE).
