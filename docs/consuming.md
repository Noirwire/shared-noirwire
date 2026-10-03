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
