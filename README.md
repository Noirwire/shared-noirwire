# @noirwire/shared

The code that holds keys and checks transactions for NoirWire's apps.

NoirWire is a non-custodial Solana wallet. One recovery phrase derives a funding wallet and separate portfolios, and the keys never leave the device. The web app and the mobile app are the same product, so the parts that must not differ between them live here, once: the rules, the money actions, the words on the screen and the design tokens. Each app is a thin layer that draws what this package decides.

We publish this source so that anyone can read what runs on their device. It is not on npm; the apps install it from this repository. See [LICENSE](LICENSE) for what you may do with it.

## What is in it

Framework-free TypeScript. No React, no React Native, no Next, no DOM, no Node APIs at runtime. It builds with plain `tsc` to ES modules and type declarations in `dist/`.

```
src/
  domain/          pure rules and types
  application/     one use case per money action, and the pending-action state machine
  infrastructure/  clients for the RPC, Jupiter, MagicBlock and the relayer
  presentation/    view models: what a screen shows
  copy/            every string a person reads
  design/          tokens and drawing maths
  platform.ts      what differs between web and mobile
  testing/         in-memory ports for tests
```

Each folder has a `README.md` saying what belongs there.

## The dependency rule

```
   presentation ─────► copy ─────► domain
        │                            ▲
        └──────► application ────────┤
                   │    ▲            │
                   ▼    │            │
             platform ──┼────────────┘
                   ▲    │
   infrastructure ─┴────┘   (and domain)

   design and domain import nothing of ours
   nothing imports from an app, a framework or Node
```

| Layer             | May import                               |
| ----------------- | ---------------------------------------- |
| `domain/`         | nothing of ours                          |
| `design/`         | nothing of ours                          |
| `platform.ts`     | `domain/` (the usage event types)        |
| `copy/`           | `domain/`                                |
| `application/`    | `domain/`, `platform.ts`                 |
| `infrastructure/` | `domain/`, `application/`, `platform.ts` |
| `presentation/`   | `domain/`, `application/`, `copy/`       |
| `testing/`        | `platform.ts`                            |

Use cases answer with reason codes from closed unions; only `presentation/` chooses the words.

A small local ESLint rule, `eslint-rules/dependency-rule.mjs`, enforces the table. It resolves every relative import against the importing file and checks the layer of the file it lands on, so `../domain/../application/x.js` and `../../src/application/x.js` are caught like `../application/x.js`, and an import that leaves `src/` (into an app, a test or the repository root) is refused outright. It also refuses React, React Native, Next, Expo, Node built-ins, `@/` paths and the package's own name. `tests/dependencyRule.test.ts` lints violating and allowed fixtures and checks that each one fails or passes for the stated reason.

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

Where an HTTP client sends its requests (the web's same-origin relay routes, or an absolute URL with a client header on mobile) is adapter configuration, `HttpConfig` in `src/infrastructure/`, passed to a client when an app builds it. It is not a port.

Each app installs its implementations once, at boot:

```ts
import { assertRuntime, installPlatform, inProcessLocks } from "@noirwire/shared/platform";

assertRuntime();
installPlatform({ vault, env, activity, track, locks: inProcessLocks() });
```

`getPlatform()` throws a clear error if nothing was installed.

Cryptography and randomness are not ports. Both platforms provide WebCrypto on `globalThis.crypto`. `assertRuntime()` checks for `crypto.subtle`, `crypto.getRandomValues`, `TextEncoder` and `TextDecoder`, so a missing polyfill stops the app at boot.

## One decision, one payment

A money action reserves its intent in the vault before anything is signed, in one atomic update, so two taps or two tabs cannot both get through. The life of an action is a pure reducer in `src/application/pending.ts`:

```
none ─reserve─► reserved ─submitted─► submitted ─chain─► landed | expired
                  │   │                   │
                  │   └─outcomeUnknown─► unknown ─chain─► landed | expired
                  │       (from submitted too)  │
                  └─releasedBeforeSend─► none   └─userCleared─► none
                    (nothing left the device)     (only with no block height)
```

Only chain evidence settles an action: a signature status, the chain's current block height against the transaction's last valid block height, and the balances the action would change. The device's clock never does. An intent cannot be reserved while it is reserved, submitted or unknown.

## The presentation model

A view model is a pure function of state that returns display-ready values, never JSX. A component renders it and forwards events. A rule or a string that a screen needs is added here, never in an app. The full rules and a worked example, the network cost row of a money review, are in [src/presentation/README.md](src/presentation/README.md).

```ts
import { networkCostView } from "@noirwire/shared/presentation";

const view = networkCostView({
  cost: { kind: "relayer", fee: 0.004, opens: null, count: 1 },
  pending: { status: "none" },
  submitting: false,
});
// { label: "Network cost", value: "less than 0.01 USDC", tone: "neutral",
//   explanation: [], confirmDisabled: false }
```

## Using it in an app

Import by subpath. There is no root entry.

| Subpath                           | Contents                                      |
| --------------------------------- | --------------------------------------------- |
| `@noirwire/shared/platform`       | The ports, `installPlatform`, `assertRuntime` |
| `@noirwire/shared/domain`         | Formatting rules and shared types             |
| `@noirwire/shared/application`    | `ActionResult`, the pending action and store  |
| `@noirwire/shared/presentation`   | View models                                   |
| `@noirwire/shared/copy`           | Strings                                       |
| `@noirwire/shared/design`         | Tokens, chart paths                           |
| `@noirwire/shared/infrastructure` | `HttpConfig`                                  |
| `@noirwire/shared/testing`        | In-memory ports                               |

### Install

Pin a tag:

```json
"@noirwire/shared": "git+ssh://git@github.com/Noirwire/shared-noirwire.git#v0.1.0"
```

npm clones the tag, installs the dev dependencies, runs `prepare` (the build) and installs the result. An install with `--ignore-scripts` skips that build and leaves the package empty.

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

Libraries both apps already carry (the Solana and crypto libraries) will be `peerDependencies`, so each app has one copy. There are none yet.

## Development

```sh
npm install
npm run typecheck      # the tests with Node types, then the package with no ambient types at all
npm run lint
npm run format:check
npm test
npm run build
```

Tests are Vitest, pure and offline. `tests/webTokens.test.ts` compares the design tokens with the web app's stylesheet when the web app is checked out next to this repository at `../app-noirwire`, and skips otherwise.

The package itself is type-checked with `lib: ["ES2022"]` and `types: []`, so a DOM or Node global in shared code is a compile error.

## Moving a module in

1. Pick its layer from the table above. Split the file if it spans two.
2. Move the file and its tests with it. Do not leave a copy in the app.
3. Replace `@/` imports with relative ones ending in `.js`.
4. Replace every platform call (`localStorage`, `window`, `document`, `process.env`, `navigator.locks`) with `getPlatform()`, and every relative `fetch` with a client that takes an `HttpConfig`.
5. Return reason codes from closed unions. Move every string a person reads to `src/copy/`, and every decision about what a screen shows, including whether Confirm is enabled, to `src/presentation/`.
6. Add any library it needs to `peerDependencies` and `devDependencies`, at the version both apps use.
7. Export it from the layer's `index.ts`. For a new layer entry, add the subpath to `exports` in `package.json`.
8. If it is security-critical, add it to the table below.
9. Run the five checks above, then `npm pack` and install the tarball in both apps.
10. Delete the app's copy and import from `@noirwire/shared/...`. Tag a new version.

## Versioning

Semver tags on this repository: `v0.1.0`, `v0.2.0`. The apps pin an exact tag. While the version is below 1.0, a minor bump may break; a patch never does. A change to what is sealed, derived or signed is always called out in the tag's notes.

## Where to look

The files that decide whether money is safe.

| What                              | Where                                                           |
| --------------------------------- | --------------------------------------------------------------- |
| Wallet sealing at rest            | moves here from the web app                                     |
| Key derivation                    | moves here from the web app                                     |
| Pre-sign guards                   | moves here from the web app                                     |
| One decision, one payment         | `src/application/pending.ts`, `src/application/pendingStore.ts` |
| Atomic vault update contract      | `src/platform.ts`                                               |
| Outcome of a money action         | `src/application/result.ts`                                     |
| Runtime check for WebCrypto       | `src/platform.ts`                                               |
| What a review says about its cost | `src/presentation/networkCost.ts`                               |

## Security

Report a vulnerability privately: see [SECURITY.md](SECURITY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

Copyright (c) 2026 NoirWire. All rights reserved. Published for transparency; no licence is granted. See [LICENSE](LICENSE).
