# Consuming this package

The install steps, the exports map and the peer dependency versions are in [README.md](../README.md#install). This is what each app's toolchain needs beyond that, and how to iterate on a change locally before it is tagged.

## What each app needs

- **Next.js 16 (Turbopack):** nothing. The exports map resolves by default, in server and client components.
- **Expo SDK 57 (Metro 0.84):** nothing. Metro's `resolver.unstable_enablePackageExports` is `true` by default in this version, and Expo's default config adds the `react-native` or `browser` condition. The exports map uses only `types` and `default`, so it resolves on every platform. If an app has switched `unstable_enablePackageExports` off, it must switch it back on: there is no `main` field to fall back to.
- **TypeScript:** `moduleResolution` must be `Bundler`, `Node16` or `NodeNext`. The older `node` setting does not read exports maps. The declarations are emitted by TypeScript 5.9 and checked against 5.9 and 6.0.
- **Jest (mobile):** the package is ES modules, which Jest does not load untransformed, so it joins the packages the preset lets the transformer read. In `jest.config.js`, the existing line becomes:

  ```js
  packagesToTransform.replace("(?!(", "(?!(@noirwire/shared|phosphor-react-native|");
  ```

- The package is ES modules only. It cannot be loaded with `require()` from a CommonJS TypeScript project.
- The stock catalog is a JSON module imported with `with { type: "json" }`. Turbopack and Babel 7.26 or later read that syntax by default.
- `package.json` names `dist/infrastructure/solana/buffer-polyfill.js` as the one file with a side effect: it puts the `buffer` package's `Buffer` on the global object before the Solana libraries need it, and a bundler must not drop it.

## The server and the session

Every request goes to NoirWire's server, at `apiBaseUrl` in the environment, and carries an anonymous session the package keeps by itself. An app supplies two things, both in [README.md](../README.md#what-an-app-must-install): the settings `envFrom` reads, and a `sessionStore`.

- **Web:** `apiBaseUrl` is `/api` with `platform: "web"`, and the host rewrites `/api/:path*` to the server, so the page's `connect-src` stays `'self'`. An absolute `https://` origin works too, if the content security policy allows it. The session store is one `localStorage` key:

  ```ts
  const KEY = "noirwire.session";
  const sessionStore = {
    get: async () => localStorage.getItem(KEY),
    set: async (value: string) => localStorage.setItem(KEY, value),
    remove: async () => localStorage.removeItem(KEY),
  };
  ```

  `locks` must be the cross-tab implementation the wallet already uses: two tabs renewing one session at once would otherwise spend the same refresh token twice.

- **Mobile:** `apiBaseUrl` is the server's origin, `https://api.noirwire.com`; a development build may name `http://localhost:8787` or, from an Android emulator, `http://10.0.2.2:8787`, with `development: true`. A path is refused. The session store is the app's plain key-value storage, not the device keystore: the value is no secret worth a biometric prompt, and it is read before the wallet is unlocked.

The store must not be the vault, and the value must not go into the wallet record. The session is a quota bucket, not an identity: it is not derived from the wallet, it is replaced every day, and `resetWallet()` drops it. An app does nothing for any of that.

An app's own requests to the server, such as counting a usage event, go through the same two functions, so they carry the session and are addressed the same way:

```ts
import { apiUrl, authorizedFetch } from "@noirwire/shared/infrastructure";

await authorizedFetch(apiUrl("events"), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(event),
  asksAgain: true, // counting an event moves nothing, so it may be sent again after a 401
});
```

A request that cannot be made as the app (the server turned the session down twice, or no session could be had) throws a `ChainError` with the code `notAvailableNow`. `chainErrorMessage` and `failureMessage` word it for a person; a screen never says more than that.

## An app's tests

`installTestPlatform()` from `@noirwire/shared/testing` installs every port in memory and a fake session, so a test starts with nothing that reaches the network. `fakeApi(routes)` answers the server's paths. Both are described in [src/testing/README.md](../src/testing/README.md). A test that installed `memoryPlatform()` and called `configureHttp` before now calls `installTestPlatform(overrides)` instead.

## What an app's vault must pass on

The store announces a lock to the other tabs by writing a counter under `noirwire.wallet.lock` (`LOCK_SIGNAL_KEY`). An app's `VaultRepository.subscribe` must report changes to that key as it does the wallet's own, or a lock in one tab will not reach the others.

## Faking a chain client in an app's tests

A test that stands in for a chain client signs through `signAsClient(signer, stillUnlocked)` from `@noirwire/shared/testing`, never through a file under `dist/`. It goes through the installed signing guard exactly as the real clients do, so the fake is held to the same rules. That entry loads `@solana/web3.js`, which both apps already carry.

## Local iteration

```sh
# in this repository
npm pack                     # builds, then writes noirwire-shared-<version>.tgz

# in the app
npm install ../shared-noirwire/noirwire-shared-<version>.tgz
```

Repeat both after each change. Do not commit the tarball path in the app's `package.json`.

Do not use `npm install ../shared-noirwire` or a `file:` path to the folder. npm makes that a symlink to a directory outside the app. Turbopack only resolves files under the app's root, so the import fails to resolve; Metro does not watch outside the project either; and a symlinked package resolves its own `node_modules`, which gives the app a second copy of every library the two share. A tarball, local or released, installs as a real folder inside `node_modules` and behaves exactly like any other dependency.
