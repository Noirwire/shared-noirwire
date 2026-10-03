<p align="center">
  <img src=".github/assets/noirwire.svg" alt="" width="64" height="64">
</p>

<h1 align="center">@noirwire/shared</h1>
<p align="center">The code that holds keys and checks transactions for NoirWire's apps.</p>

<p align="center">
  <a href="https://github.com/Noirwire/shared-noirwire/actions/workflows/ci.yml"><img src="https://github.com/Noirwire/shared-noirwire/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <img src="https://img.shields.io/badge/version-0.4.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/license-proprietary-black" alt="License">
</p>

NoirWire is a non-custodial Solana wallet. One recovery phrase derives a funding wallet and separate portfolios, and the keys never leave the device. This repository is the part of it both apps run on, once:

- Keys are sealed on the device; the vault behind this package only ever sees ciphertext.
- The web app and the mobile app are the same product, so the wallet, its checks, the money actions and the words on screen live here once, not twice.
- Every money action reserves its portfolio before anything is signed, so a double tap, or two tabs, cannot pay for the same decision twice.
- A small dependency rule, enforced by lint, keeps the layers from leaking into each other.
- Published openly so anyone can read what actually runs on their device.

We publish this source so that anyone can read what runs on their device. It is not on npm; the apps install it from this repository. See [LICENSE](LICENSE) for what you may do with it.

## Architecture

Framework-free TypeScript: no React, no React Native, no Next, no DOM, no Node APIs at runtime. It builds with plain `tsc` to ES modules and type declarations in `dist/`.

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

| Layer             | May import                               |
| ----------------- | ---------------------------------------- |
| `domain/`         | nothing of ours                          |
| `design/`         | nothing of ours                          |
| `platform.ts`     | `domain/`                                |
| `copy/`           | `domain/`                                |
| `application/`    | `domain/`, `platform.ts`                 |
| `infrastructure/` | `domain/`, `application/`, `platform.ts` |
| `presentation/`   | `domain/`, `application/`, `copy/`       |
| `wallet/`         | every layer above but `design/`          |
| `testing/`        | `platform.ts`                            |

A local ESLint rule enforces this table on every import and a fixture suite proves it. The full diagram, what each layer may never do, and how a module moves in from an app are in [docs/architecture.md](docs/architecture.md).

### How the repositories fit together

| Repository                                                       | What it is                                                                         |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `shared-noirwire` (this repository)                              | The framework-free wallet core: keys, checks, use cases, view models, copy, tokens |
| [mobile-noirwire](https://github.com/Noirwire/mobile-noirwire)   | The Expo mobile app                                                                |
| [relayer-noirwire](https://github.com/Noirwire/relayer-noirwire) | The transaction relayer, a fork of `solana-foundation/kora`                        |
| app-noirwire                                                     | The Next.js web app (private)                                                      |
| landinpage-noirwire                                              | The marketing site (private)                                                       |

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

An app installs this package's platform ports once, at boot, before anything else touches it:

```ts
import { assertRuntime, installPlatform, inProcessLocks } from "@noirwire/shared/platform";
import { configureHttp, envFrom } from "@noirwire/shared/infrastructure";
import { installMoney } from "@noirwire/shared/wallet";

assertRuntime();
installPlatform({ vault, env: envFrom(settings), activity, track, locks: inProcessLocks() });
configureHttp({ baseUrl: "", headers: () => ({}) });
installMoney(inProcessLocks());
```

- **`installPlatform`** wires in what differs by platform: the encrypted-storage vault, the environment (network, relayer fee), input activity for the idle lock, usage tracking, and the lock implementation. `getPlatform()` and every client throw a clear error if nothing was installed. See [docs/architecture.md](docs/architecture.md#the-platform-seam) for the full port shapes.
- **`installMoney`** makes the one pending-action store and installs the one signing guard for the process. Signing refuses when no guard is installed, when no reservation holds the signer, and when the connection's network does not match the app's, checked right before every signature. A second call throws.

### Install

Pin a tag in the app's `package.json`:

```json
"@noirwire/shared": "git+ssh://git@github.com/Noirwire/shared-noirwire.git#v0.4.0"
```

or `npm install git+ssh://git@github.com/Noirwire/shared-noirwire.git#v0.4.0`. npm clones the tag, installs the dev dependencies, runs `prepare` (the build) and installs the result. An install with `--ignore-scripts` skips that build and leaves the package empty, and so does npm 11's install-script policy until the app allows this one package: run `npm install-scripts approve @noirwire/shared` once, which records it under `allowScripts` in the app's `package.json`. Moving to a newer version is changing the tag and installing again.

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

What each app's bundler and test runner need beyond the exports map, and how to iterate on a change before it is tagged, are in [docs/consuming.md](docs/consuming.md).

## Quick start

```sh
git clone https://github.com/Noirwire/shared-noirwire.git
cd shared-noirwire
npm install
npm run build
npm test
```

## Development

```sh
npm run lint          # the dependency rule and the rest of the ESLint config
npm run typecheck      # the tests with Node types, then the package with no ambient Node types
npm run format:check
npm test               # unit tests
npm run test:integration
npm run test:contract  # live mainnet, read-only; not part of CI
npm run build
```

`npm run format` fixes formatting. The package itself is type-checked with `lib: ["ES2022", "WebWorker"]` and `types: []`: the web-platform globals both runtimes provide (fetch, WebCrypto, `TextEncoder`, timers, `URL`) are declared, and `window`, `document`, `localStorage` and every Node global are compile errors.

| Suite       | Command                    | Covers                                                                                                                                        | Runs in CI                                    |
| ----------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Unit        | `npm test`                 | Pure logic and view models, against in-memory ports (`tests/setup/platform.ts`), offline                                                      | Every push and pull request                   |
| Integration | `npm run test:integration` | Real on-chain behaviour against a throwaway `solana-test-validator` (never devnet or mainnet)                                                 | Every push and pull request                   |
| Contract    | `npm run test:contract`    | Read-only checks that the live services this package reads (Solana RPC, Jupiter) still match what the code expects; nothing is signed or sent | Manual dispatch only, never on a pull request |

`tests/webTokens.test.ts` compares the design tokens with the web app's stylesheet when the web app is checked out next to this repository at `../app-noirwire`, and skips otherwise. The integration suite needs `solana-test-validator` on the `PATH`; the contract suite needs `SOLANA_RPC_URL` set to a dedicated mainnet provider (the public endpoint rate-limits it) and, optionally, `JUPITER_API_KEY`. The checks that go through an app's relay routes live in that app, not here.

Before committing, run everything CI runs:

```sh
npm run lint && npm run typecheck && npm run format:check && npm test && npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for commit style, tests, and what belongs in this package versus an app.

## Releasing

This package has no production deployment of its own: it reaches an app by git tag, pinned in that app's `package.json` (see [Install](#install)). Semver tags: `v0.1.0` through `v0.4.0` so far. While the version is below 1.0, a minor bump may break; a patch never does. Every change is recorded in [CHANGELOG.md](CHANGELOG.md).

Pushing a tag matching `v*` runs the full check suite (lint, types, format, unit tests, integration tests, build), confirms `package.json`'s version matches the tag, packs the tarball and checks it contains `dist/` and no test files, then publishes a GitHub Release with that tarball attached and its notes taken from the matching `CHANGELOG.md` section. To cut a release: bump `version` in `package.json`, add its section to `CHANGELOG.md`, commit, then push a `vX.Y.Z` tag matching the version.

## Security

Keys are sealed at rest with AES-256-GCM behind a PBKDF2-SHA256 derivation and never leave the device unencrypted; every transaction is simulated against real balances before it is signed, and one decision can reserve at most one payment (see [docs/architecture.md](docs/architecture.md#one-decision-one-payment)). This package has not had a third-party audit. Report a vulnerability privately: see [SECURITY.md](SECURITY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

Copyright (c) 2026 NoirWire. All rights reserved. Published for transparency; no licence is granted. See [LICENSE](LICENSE).

## Related repositories

[mobile-noirwire](https://github.com/Noirwire/mobile-noirwire), [relayer-noirwire](https://github.com/Noirwire/relayer-noirwire). The web app (app-noirwire) and the marketing site (landinpage-noirwire) are private. More at [noirwire.com](https://noirwire.com).
