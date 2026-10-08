# Architecture

The layer table and the one-paragraph summary of each piece live in [README.md](../README.md#architecture). This is the detail: how the dependency rule is enforced, the platform seam an app wires in, the session every request carries, the wallet store's guarantees, biometric unlock, the one-reservation-per-action lifecycle, the presentation model, how waiting and retried reads work, where a moved-in module goes, and the files that decide whether money is safe.

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

| Layer             | May import                                                                             |
| ----------------- | -------------------------------------------------------------------------------------- |
| `domain/`         | nothing of ours                                                                        |
| `design/`         | nothing of ours                                                                        |
| `platform.ts`     | `domain/` (the usage event types)                                                      |
| `copy/`           | `domain/`                                                                              |
| `application/`    | `domain/`, `platform.ts`                                                               |
| `infrastructure/` | `domain/`, `application/`, `platform.ts`                                               |
| `presentation/`   | `domain/`, `application/`, `copy/`                                                     |
| `wallet/`         | `domain/`, `application/`, `infrastructure/`, `presentation/`, `copy/`, `platform.ts`  |
| `testing/`        | `platform.ts`, `infrastructure/` (the signing entry point and the session, for a test) |

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
  apiBaseUrl: string;
  sessionMaxAgeMs?: number;
  rpcUrl?: string;
}
interface SessionStore {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  remove(): Promise<void>;
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
  sessionStore: SessionStore;
}
```

- **`vault`** is asynchronous and fallible: every call reports failure rather than throwing. `update` is an atomic read-modify-write that runs under the platform lock for its key, so nothing from this tab, another tab or another process comes between its read and its write. `subscribe` hears of every persisted change, including ones made elsewhere. Whether a value is sealed is the app's business.
- **`track`** takes only events and values from the closed list in `src/domain/usageEvents.ts`. Every property is a string from a closed union or a number, so an address cannot be passed by accident: it does not type-check.
- **`locks`** serialises across tabs on the web; `inProcessLocks()` is enough on mobile.
- **`env`** is read when a value is asked for, never when a module loads, so the package can be imported before the platform is installed. `envFrom()` in `@noirwire/shared/infrastructure` builds one from settings kept as text (build-time variables) and refuses a fee with nowhere to go, and a server address it would not send to.
- **`sessionStore`** keeps one small JSON value in plain app storage: the anonymous session below. A call that throws is taken as nothing stored, and the session is then held in memory only.
- **`activity`** reports input and a return to the app. The idle lock counts from it: either one inside the window restarts it, either one past it locks.

Each app installs its implementations once, at boot:

```ts
import { assertRuntime, installPlatform, inProcessLocks } from "@noirwire/shared/platform";
import { envFrom } from "@noirwire/shared/infrastructure";

assertRuntime();
installPlatform({
  vault,
  env: envFrom(settings),
  activity,
  track,
  locks: inProcessLocks(),
  sessionStore,
});
```

`getPlatform()` and every client throw a clear error if nothing was installed.

Live prices are polled only while the app is in view. Whether it is, is passed to `watchLivePrices(visibility)` by the screen that shows prices: the document's visibility on the web, the app state on mobile.

Cryptography and randomness are not ports. Both platforms provide WebCrypto on `globalThis.crypto`. `assertRuntime()` checks for `crypto.subtle`, `crypto.getRandomValues`, `TextEncoder` and `TextDecoder`, so a missing polyfill stops the app at boot.

## One server

Every request this package makes goes to NoirWire's own server, at the one place the environment names as `apiBaseUrl`. The chain's provider, the swap venue and the private-payment service are behind it, so each sees the server's address and never a visitor's next to the addresses it is asked about.

`apiUrl(route, rest)` in `src/infrastructure/api.ts` is the only place an address is put together:

| Route             | Address                      | Asked with                                     |
| ----------------- | ---------------------------- | ---------------------------------------------- |
| `session`         | `/v1/session`                | `POST`, and `POST /refresh`. Takes no session. |
| `rpc`             | `/v1/rpc`                    | `POST`                                         |
| `jupiter`         | `/v1/jupiter/*`              | `GET`, `POST`                                  |
| `privatePayments` | `/v1/private-payments/*`     | `POST`                                         |
| `profile`         | `/v1/profile/*`              | `GET /config`, `POST` for the rest             |
| `rewards`         | `/v1/rewards/*`              | `GET /config`, `POST` for the rest             |
| `relayer`         | `/v1/relayer`                | `GET`, `POST`                                  |
| `prices`          | `/v1/prices`                 | `GET`                                          |
| `history`         | `/v1/history/:symbol/:range` | `GET`                                          |
| `events`          | `/v1/events`                 | `POST`                                         |
| `health`          | `/health`                    | `GET`. Takes no session.                       |

`apiBaseUrl` is an origin with no path on the phone (`https://api.noirwire.com`). On the web it may be a path on the page's own origin (`/api`): the web app's host forwards `/api/*` to the server, so the page's content security policy can stay at `connect-src 'self'`. `envFrom` holds either to its rules at boot: https, or http to `localhost`, `127.0.0.1` or `10.0.2.2` in a development build only; nothing after the host; and a path only when `platform` is `"web"`, starting with one slash and carrying no query. `rpcUrl` names an RPC provider directly, with no session, for a server or a test that has no visitor behind it.

## The session with NoirWire's server

Every `/v1` request carries `Authorization: Bearer <token>`, the token of an anonymous session the server issued.

**What it is, and is not.** The session is a quota bucket, not an identity. It lets the server count one running copy of the app's requests apart from another's, so one copy cannot use up what is meant for everyone. It has no email and no account behind it. It is not derived from the wallet: it is asked for with no body at all, before a wallet exists, and it is the same whether a wallet is unlocked or not. No address, key, phrase or password goes into it or can be worked out from it. It is kept in the `sessionStore`, in plain storage, and never in the encrypted wallet record.

**The one thing that rides on it by choice.** A wallet that joined rewards sends its rewards requests (a rewards key, and for a claim the portfolio that traded) under the same session as everything else, so for that wallet the server could tell that those requests and the day's other requests came from one copy of the app. The server is built to keep no such link. A wallet that never joined sends none of it.

**It rotates.** A session older than `SESSION_MAX_AGE_MS` (24 hours, the server's own default; `env.sessionMaxAgeMs` sets another) is replaced by a new one, not renewed, and the server retires an old one on its side too. What could be counted under one session never spans more than a day. **A wallet reset drops it at once**, in the tab that reset and in every other tab that hears of it, and the next request starts a new one: a session that outlived a reset would let the server tie the wallet imported afterwards to the one that was deleted, which is the link a reset is expected to cut.

**How it is kept** (`createSessionKeeper` in `src/application/apiSession.ts`, bound to the server's routes in `src/infrastructure/apiSession.ts`):

- Started with `POST /v1/session` (no token, no body), which answers `{ accessToken, refreshToken, expiresAt }`, `expiresAt` in Unix seconds. Renewed with `POST /v1/session/refresh` and `{ refreshToken }`.
- Renewed `RENEW_BEFORE_EXPIRY_MS` (one minute) before its token runs out, when a request is about to be made. There is no timer: an app left idle asks for nothing.
- Callers that arrive together share one start or one renewal. It runs under the platform lock `noirwire-session`, so a second tab finds what the first one stored instead of spending the same refresh token twice.
- Storage is the truth for every tab. What a tab holds in memory is checked against the store before each use: a session another tab renewed is taken up, and one another tab dropped is not used again. A store that cannot be read, or will not keep what it is given, leaves the tab with its own copy and nothing else.
- A drop takes the same lock. A renewal under way in any tab finishes first, what it stored is then removed, and the tab that renewed finds storage empty at its next request.
- A renewal the server refuses (`session_invalid`, `session_expired`) is followed by a new session. So is a 401 on any route that carries the code `session_expired`.
- A renewal that gets no answer while the token is still good changes nothing: the token goes on being used.
- Each session request is given `SESSION_REQUEST_TIMEOUT_MS` (10 seconds) and then abandoned, so a stalled one cannot hold every caller. After a failure nothing more is asked for a while (`SESSION_RETRY`: one second, doubling to a minute at most, each stretched by up to half at random), and every caller in that time is told at once that this cannot be done right now.

**`authorizedFetch(input, init)`** is `fetch` with the token added. A 401 from the server only ever means its session was not accepted:

| Request                                                                                                                       | After a 401                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| A read: any `GET`, an RPC call other than `sendTransaction`, the relayer's keys and price, anything through `readFetch`       | The session is renewed, or started again, and the request is made once more. Turned down again: `notAvailableNow`       |
| An unsigned build: a swap order, an Earn deposit or withdrawal to review, a private transfer to check                         | The same                                                                                                                |
| A signed submit: `sendTransaction` over RPC, a swap's `execute`, a private transfer's `send`, the relayer's `signTransaction` | Never made a second time. The 401 is handed back, and the outcome is **unknown** until the chain settles it (see below) |

**A submit that was dispatched is never called "nothing was sent".** Once a signed transaction has left the device, any answer short of a clear success, the server's own 401 included, leaves its outcome unknown: the reservation is kept, the transaction is settled from its recorded signature against the chain, and it is released only on evidence that it cannot land. A proxy or a handler on the way could have passed the transaction on before it answered, and saying "nothing was sent" would invite paying twice. The person reads the unknown-outcome words: "This was sent but could not be confirmed. It may still land; check the portfolio's balance before retrying." The one exception is a request that provably never left the device: no session could be had, so it was never made. Only that fails a submit as `notAvailableNow` ("We can't do this right now. Nothing was sent, and your money has not moved. Try again."). The relayer's route has refusals of its own that say by their code that nothing was signed (`refused`, `insufficient_payment`, `unavailable` and the like); those keep their meaning, and anything else from it is unknown.

## The server's errors

Every error the server writes itself has one body, `{ "code", "error" }`. The app acts on `code` alone (`API_ERRORS` in `src/domain/apiError.ts`, the same list as the server's); the sentence is never read and never shown. A provider's own error (a JSON-RPC error, a quote Jupiter cannot fill) passes through the server as the provider wrote it and has no such `code`, which is how the two are told apart (`apiErrorIn`).

| Code                                                                                                                                                                                      | What the clients make of it                                                                                                        | What a person reads                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `unauthorized`                                                                                                                                                                            | The session is renewed and a read is made once more                                                                                | Nothing, when that works; else `notAvailableNow`                              |
| `session_expired`, `session_invalid`                                                                                                                                                      | A new session is started and a read is made once more                                                                              | The same                                                                      |
| `rate_limited`, `request_timeout`, `internal_error`, `upstream_failed`, `upstream_not_reached`, `upstream_timeout`, `response_timeout`, `unavailable`, `relayer_unavailable`, `no_answer` | An `ApiError` that may be asked again: a read is retried quietly (`isTransient`), then fails                                       | The plain words for what the screen or the action was doing, with "Try again" |
| `invalid_request`, `method_not_allowed`, `not_found`, `request_too_large`, `origin_not_allowed`, `upstream_refused`                                                                       | An `ApiError` that is not asked again. `not_found` on a chart is simply no chart                                                   | The same plain words; a chart is hidden                                       |
| `refused`, `insufficient_payment` (the relayer's route)                                                                                                                                   | Nothing was signed: the fee is asked for once more after `insufficient_payment`, and otherwise the network cost is met another way | "The network cost could not be covered in USDC right now. Nothing was sent."  |
| any of them, as the answer to a signed submit                                                                                                                                             | Unknown outcome, settled against the chain                                                                                         | The unknown-outcome words                                                     |

`tests/api/openapi.test.ts` holds every client to the server's OpenAPI file: each request must be one the file documents (method, path, session, no query, body), and each documented answer must end as the result above. It runs when `NOIRWIRE_OPENAPI` names the file (`npm run test:api`) and is skipped, saying so, otherwise. `npm run test:api:live` runs the read paths against a running server named by `NOIRWIRE_API_URL`. `tests/unit/apiSession.test.ts` and `tests/unit/apiClients.test.ts` hold the session and the submit rule without either.

## The wallet store

`src/wallet/store.ts` keeps the decrypted wallet in memory and hands it out synchronously (`getSnapshot`, `walletExists`, `isUnlocked`, `isSaveFailing`), which is what a renderer's external-store hook needs. Persistence goes through the asynchronous vault:

- **Changes show at once and are written behind.** `updateWallet` applies a change in memory, emits, and queues the write. Writes run one at a time in the order they were made, and one tab at a time under the platform lock `noirwire-wallet-write`.
- **A write lands only over the record it was built on.** Each write is one atomic `vault.update` that compares the stored record with the one the change was applied to. When another tab wrote in between, the change is applied again to the newer record, so an old picture of the wallet is never written over newer state.
- **A failed write is surfaced, not dropped.** The change stays pending, `isSaveFailing()` turns true, and the next successful write clears it.
- **An unsaved change is visible.** `isSaving()` is true from a change until its write lands, so a screen can say it is not stored yet.
- **A reset says the wallet is gone only once it is.** `resetWallet()` locks at once, then resolves to `{ ok: true }` after the vault has removed the record (with the pending actions inside it), or `{ ok: false, reason: "notRemoved" }` with the wallet still reported as stored. A reset that removed the wallet drops the session with the server too.
- **Old plain text phrases are deleted and checked.** Their removal is awaited after a wallet is stored or unlocked, `isPlaintextCleanupFailing()` says when it failed, and each later start tries again while a current wallet is stored.
- **A lock is wallet-wide.** `lock()` locks here and announces it under `LOCK_SIGNAL_KEY`, a counter in the vault that says nothing about the wallet; every other tab or running copy that hears it locks too. A reset announces the same when the record would not go, and removes the signal with everything else when it did. A tab that only went idle locks alone.
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

**A relayer-paid transaction is written down twice.** Its id is the fee payer's signature, which does not exist when the portfolio signs, so the first record holds the blockhash, the signer and the signer's own signature, and no id. The relayer only signs: it broadcasts nothing. When the signed transaction comes back it is checked to be the same message with the portfolio's signature intact, its id is written into the reservation (`recordForSending`), and only then is it sent through `/v1/rpc`. An app closed a moment after the broadcast therefore finds the id on reopening and settles the action as sent, with its Activity entry. An app closed before the id was written sent nothing, and "did not go through" is then true.

**A transaction with no recorded id is never released on its blockhash alone** (`settle` in `src/infrastructure/solana/pending.ts`). Once its time has run out, the signer's most recent transactions are searched for the one that carries the signer's recorded signature, or, for a record made before that was kept, the recorded blockhash. Found: it landed, or failed, and that is the outcome. Everything recent read and it is not there: it never landed, and the reservation is released. The chain could not be asked just now: it stays pending. It cannot be looked up at all: it is marked for the person to release once they have checked the balance. The search asks the RPC for `getSignaturesForAddress`, which the server has to allow.

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

## Importing a phrase

An import reads, for each of the two derivation conventions, what the funding address and the addresses after it show on chain (`src/infrastructure/solana/import.ts`). Creating a portfolio writes nothing on chain, so the scan cannot tell an unused portfolio from one that was never made, and it stops after `DISCOVERY_GAP` (20) unused addresses in a row.

- **Creation stays within that reach.** `createPortfolio` refuses once the wallet ends in `MAX_UNUSED_PORTFOLIOS_IN_A_ROW` (10) portfolios that never held or did anything, by the wallet's own record and archived ones included. Whatever is created and funded next is then at most eleven addresses past the last used one. `tests/unit/discoveryReach.test.ts` holds the limit under the gap, and runs an import over the furthest case.
- **A person can ask for more.** `lookFurtherForPortfolios` carries on from `scannedThrough`, where the first scan stopped, with a gap of `EXTENDED_DISCOVERY_GAP` (100). `lookFurtherView` is the control both apps show on the import's result.
- **Requests are paced.** Every lookup of both conventions takes its turn from one pacer (`createPacer`, `IMPORT_REQUESTS_PER_SECOND`, 8), inside its slot and right before it is sent; at most three are in flight, and one that is refused is tried again after a pause with jitter. `paceImportWith` sets another pace, or none for a local validator. Each request names one address's accounts and nobody else's.
- **A failed attempt is not lost.** The scan is kept in memory, by funding address, after every completed step of ten addresses. Calling `resolveImportedWallet` again with the same phrase carries on from there, and it is forgotten once the import has its answer.

The wallet's record keeps its `MAX_ACTIVITY_ENTRIES` (500) most recent activity entries; `logged` drops the oldest as it writes. A pending action is kept on its portfolio, not in that list, so it is never dropped, and the Activity view says when older entries are no longer kept on the device.

## Landed means done

Once the chain or the venue has confirmed an action, its answer is a success, whatever the reads after it do. Reporting a payment that went through as failed invites paying it again. Every use case in `application/actions/` therefore ends its submit step before it settles: a failure before a confirmed outcome is `failed` (nothing was sent), an outcome nobody could learn is `unknown` and stays reserved, and after a confirmed outcome the only thing left to vary is `settlement`: `balancesRead`, or `balancesEstimated` when the new balances could not be read back even after being asked for again. `balancesUnread(result)` tells a screen to say it was done and that balances will update shortly. `tests/unit/landed.test.ts` holds each action to this, and to never submitting twice.

## Waiting, and reads that are asked again

Both apps wait the same way. `waitingView(elapsedMs, kind)` in `presentation/` says what to show as time passes (nothing before 300 ms, then a quiet signal, then a calm "still working" line after 4 seconds, or 8 for an action under way), and which step of multi-step work is current. It holds no timer: each platform passes the time elapsed. The thresholds, the kinds and the wording rule are in [src/presentation/README.md](../src/presentation/README.md#waiting).

A read that fails on a busy moment is asked for again before anyone is told. `readWithRetries` in `src/application/retries.ts` tries three times, 400 ms and then 800 ms apart, on a failure of the asking only: a request that never got through or ran out of time, or a 429 or 5xx answer.

| Asked again                                                                                                                                  | Where                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| The balance refresh: one balance, a portfolio's balances, the funding wallet's                                                               | `src/application/actions/refreshBalances.ts`                                     |
| Live prices, a chart's history, the trackers' multipliers                                                                                    | `src/infrastructure/prices/live.ts`, `history.ts`, `multipliers.ts`              |
| The lending rate and a portfolio's Earn position                                                                                             | `src/wallet/money.ts`                                                            |
| Import: each lookup of what a phrase holds (four tries, 1, 2 and 4 seconds apart)                                                            | `src/infrastructure/solana/import.ts`                                            |
| A recipient checked while the address is typed                                                                                               | `checkRecipient` in `src/infrastructure/solana/address.ts`                       |
| Preparing a review: a trade's price, what a send costs, whether a holding is open, the relayer's price and keys, the portfolio's own balance | `quoteTrade`, `reviewSend`, `reviewOrdersCost`, `planNetworkCost`, `relayerPins` |

A read the server turns down for its session (a 401) is made once more with a renewed one; that is `authorizedFetch`'s doing, described above, and it does not count against these tries.

Never asked again: anything that signs or submits (`send`, `fundDirectly`, `fundPrivately`, `placeTrade`, `earn`, opening a holding, every relayer-paid transaction), the price taken again inside `placeTrade`, the recipient check inside a send, the network's identity before a signature, and settling a sent transaction. A second attempt at one of those could do the same thing twice. A refusal is never asked again either: a `ChainError`, "no price", a 4xx or a guard's own account is an answer. `tests/unit/retries.test.ts` holds each path to this with fake timers.

## Moving a module in

1. Pick its layer from the table above. Split the file if it spans two.
2. Move the file and its tests with it. Do not leave a copy in the app.
3. Replace `@/` imports with relative ones ending in `.js`.
4. Replace every platform call (`localStorage`, `window`, `document`, `process.env`, `navigator.locks`) with `getPlatform()`, and every `fetch` to the server with `authorizedFetch(apiUrl(route, rest), init)` from `src/infrastructure/`: through `readFetch` for a read, with `asksAgain: true` for an unsigned build, and bare for anything that hands over a signature.
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
| Which reads are asked again, and that nothing which moves money is                  | `src/application/retries.ts`                                                                                         |
| Which requests are made again after the server turns a session down                 | `src/infrastructure/apiSession.ts`, `src/infrastructure/solana/client.ts`                                            |
| Where every request goes, and what an app may set that to                           | `src/infrastructure/api.ts`, `envFrom` in `src/infrastructure/solana/config.ts`                                      |
