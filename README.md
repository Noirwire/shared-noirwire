<p align="center">
  <img src=".github/assets/noirwire.svg" alt="" width="64" height="64">
</p>

<h1 align="center">@noirwire/shared</h1>
<p align="center">The code that holds keys and checks transactions for NoirWire's apps.</p>

<p align="center">
  <a href="https://github.com/Noirwire/shared-noirwire/actions/workflows/ci.yml"><img src="https://github.com/Noirwire/shared-noirwire/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <img src="https://img.shields.io/badge/version-0.5.1-blue" alt="Version">
  <img src="https://img.shields.io/badge/license-proprietary-black" alt="License">
</p>

NoirWire is a non-custodial Solana wallet. One recovery phrase derives a funding wallet and separate portfolios, and the keys never leave the device. This repository is the part of it both apps run on, once:

- Keys are sealed on the device; the vault behind this package only ever sees ciphertext.
- The web app and the mobile app are the same product, so the wallet, its checks, the money actions and the words on screen live here once, not twice.
- Every money action reserves its portfolio before anything is signed, so a double tap, or two tabs, cannot pay for the same decision twice.
- Waiting looks and reads the same on both: a quiet signal after a short delay, a calm line when it runs long, and never a word about requests or services. Reads are asked for again on a busy moment; nothing that moves money ever is.
- Every request goes to one server, NoirWire's own, with an anonymous session that is a quota bucket and not an identity: it is not derived from the wallet, and it is replaced every day and on a wallet reset.
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
  infrastructure/  where requests go (api.ts), the session they carry (apiSession.ts), and the
                   clients behind the use cases:
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
  testing/         in-memory ports for tests, and signing for a test's stand-in client
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
| `testing/`        | `platform.ts`, `infrastructure/`         |

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
| `@noirwire/shared/infrastructure` | `envFrom`, `apiUrl`, `authorizedFetch`, the chain client, the venues, the guards |
| `@noirwire/shared/presentation`   | View models                                                                      |
| `@noirwire/shared/copy`           | Strings                                                                          |
| `@noirwire/shared/design`         | Tokens, the phone's layout tokens, class tokens, brand geometry, chart paths     |
| `@noirwire/shared/wallet`         | The wallet store, its session, wallet creation, the bound catalog                |
| `@noirwire/shared/testing`        | In-memory ports, a fake session, a fake server, signing for a stand-in client    |

Each index exports the public surface of its layer, not every helper. A file that is not exported is internal and may change in any release.

### What an app must install

An app installs this package's platform ports once, at boot, before anything else touches it:

```ts
import { assertRuntime, installPlatform, inProcessLocks } from "@noirwire/shared/platform";
import { envFrom } from "@noirwire/shared/infrastructure";
import { installMoney } from "@noirwire/shared/wallet";

assertRuntime();
installPlatform({
  vault,
  env: envFrom({ network, referralAccount, feeBps, apiBaseUrl, platform, development }),
  activity,
  track,
  locks: inProcessLocks(),
  sessionStore,
});
installMoney(inProcessLocks());
```

- **`installPlatform`** wires in what differs by platform: the encrypted-storage vault, the environment, input activity for the idle lock, usage tracking, the lock implementation and the session store. `getPlatform()` and every client throw a clear error if nothing was installed. See [docs/architecture.md](docs/architecture.md#the-platform-seam) for the full port shapes.
- **The environment** is built by `envFrom` from settings kept as text, and refuses a bad one at boot:

  | Setting                     | What it is                                                                                                                                                                                                                                                                  |
  | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `apiBaseUrl`                | Where NoirWire's server is. Required. An origin with no path: `https://api.noirwire.com`, or `http://` to `localhost`, `127.0.0.1` or `10.0.2.2` when `development` is true. On the web it may instead be a path on the page's own origin, such as `/api` (see `platform`). |
  | `platform`                  | `"web"` or `"mobile"`. Only `"web"` runs in a browser, so only there is a path accepted as `apiBaseUrl`: the web app's host forwards `/api/*` to the server, and the page connects to nothing but itself.                                                                   |
  | `development`               | True in a development build. Without it, plain http is refused everywhere.                                                                                                                                                                                                  |
  | `network`                   | `"mainnet"` or `"devnet"`; devnet when unset.                                                                                                                                                                                                                               |
  | `referralAccount`, `feeBps` | The trade fee and where it goes: both or neither.                                                                                                                                                                                                                           |
  | `rpcUrl`                    | An RPC provider asked directly, with no session. Only for code with no visitor behind it: a server, or a test against a local validator. An app leaves it out.                                                                                                              |

- **`sessionStore`** is three calls over one small JSON value in plain app storage (`localStorage` on the web, the app's key-value storage on the phone): `get(): Promise<string | null>`, `set(value): Promise<void>`, `remove(): Promise<void>`. It is not the vault and the value is never put in the encrypted wallet record: requests are made before a wallet is unlocked, and before one exists. It holds the app's anonymous session with NoirWire's server, which every request carries. That session is a quota bucket, not an identity: it is not derived from the wallet, it is replaced by a new one every day, and a wallet reset drops it. See [docs/architecture.md](docs/architecture.md#the-session-with-noirwires-server).
- **`installMoney`** makes the one pending-action store and installs the one signing guard for the process. Signing refuses when no guard is installed, when no reservation holds the signer, and when the connection's network does not match the app's, checked right before every signature. A second call throws.

### Install

Pin the tarball attached to a release in the app's `package.json`:

```json
"@noirwire/shared": "https://github.com/Noirwire/shared-noirwire/releases/download/v0.5.1/noirwire-shared-0.5.1.tgz"
```

or `npm install https://github.com/Noirwire/shared-noirwire/releases/download/v0.5.1/noirwire-shared-0.5.1.tgz`. The tarball already contains the built `dist/`, so npm just unpacks and installs it; nothing here is cloned or built on the app's machine. Moving to a newer version is changing the URL's tag and filename to the new version and installing again. See [Releasing](#releasing) for how a tag becomes that tarball.

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
npm run test:api       # the clients against the server's OpenAPI file (NOIRWIRE_OPENAPI)
npm run test:api:live  # the read paths against a running server (NOIRWIRE_API_URL)
npm run build
```

`npm run format` fixes formatting. The package itself is type-checked with `lib: ["ES2022", "WebWorker"]` and `types: []`: the web-platform globals both runtimes provide (fetch, WebCrypto, `TextEncoder`, timers, `URL`) are declared, and `window`, `document`, `localStorage` and every Node global are compile errors.

| Suite       | Command                    | Covers                                                                                                                                                                                               | Runs in CI                                                 |
| ----------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Unit        | `npm test`                 | Pure logic and view models, against in-memory ports (`tests/setup/platform.ts`), offline                                                                                                             | Every push and pull request                                |
| Integration | `npm run test:integration` | Real on-chain behaviour against a throwaway `solana-test-validator` (never devnet or mainnet)                                                                                                        | Every push and pull request                                |
| API         | `npm run test:api`         | Every request the clients make and every answer the server documents, against the server's `docs/openapi.json`, named by `NOIRWIRE_OPENAPI`. Offline. Skipped, saying so, when the variable is unset | With the unit suite; checks only where the file is present |
| API, live   | `npm run test:api:live`    | The read paths (a session, prices, a chart, one RPC read, the relayer's keys) against a running server named by `NOIRWIRE_API_URL`                                                                   | Manual, never on a pull request                            |
| Contract    | `npm run test:contract`    | Read-only checks that the live services this package reads (Solana RPC, Jupiter) still match what the code expects; nothing is signed or sent                                                        | Manual dispatch only, never on a pull request              |

`tests/webTokens.test.ts` compares the design tokens with the web app's stylesheet when the web app is checked out next to this repository at `../app-noirwire`, and skips otherwise. The integration suite needs `solana-test-validator` on the `PATH`; the contract suite needs `SOLANA_RPC_URL` set to a dedicated mainnet provider (the public endpoint rate-limits it) and, optionally, `JUPITER_API_KEY`. The checks that go through NoirWire's server live with the server, not here.

Before committing, run everything CI runs:

```sh
npm run lint && npm run typecheck && npm run format:check && npm test && npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for commit style, tests, and what belongs in this package versus an app.

## Releasing

This package has no production deployment of its own: it reaches an app by git tag, pinned in that app's `package.json` (see [Install](#install)). Semver tags: `v0.1.0` through `v0.5.1` so far. While the version is below 1.0, a minor bump may break; a patch never does. Every change is recorded in [CHANGELOG.md](CHANGELOG.md).

Pushing a tag matching `v*` runs the full check suite (lint, types, format, unit tests, integration tests, build), confirms `package.json`'s version matches the tag, packs the tarball and checks it contains `dist/` and no test files, then publishes a GitHub Release with that tarball attached and its notes taken from the matching `CHANGELOG.md` section. To cut a release: bump `version` in `package.json`, add its section to `CHANGELOG.md`, commit, then push a `vX.Y.Z` tag matching the version.

## Security

Keys are sealed at rest with AES-256-GCM behind a PBKDF2-SHA256 derivation and never leave the device unencrypted; every transaction is simulated against real balances before it is signed, and one decision can reserve at most one payment (see [docs/architecture.md](docs/architecture.md#one-decision-one-payment)). This package has not had a third-party audit. Report a vulnerability privately: see [SECURITY.md](SECURITY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

Copyright (c) 2026 NoirWire. All rights reserved. Published for transparency; no licence is granted. See [LICENSE](LICENSE).

## Related repositories

[mobile-noirwire](https://github.com/Noirwire/mobile-noirwire), [relayer-noirwire](https://github.com/Noirwire/relayer-noirwire). The web app (app-noirwire) and the marketing site (landinpage-noirwire) are private. More at [noirwire.com](https://noirwire.com).
