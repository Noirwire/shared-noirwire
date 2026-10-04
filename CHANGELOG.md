# Changelog

All notable changes to this package are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The apps pin an exact tag; see [README.md](README.md#releasing) for how a tag becomes a release.

## [0.5.0] - 2026-10-04

Every request now goes to one server, NoirWire's own, and carries an anonymous session. Both apps must change how they boot.

### Breaking

For both apps:

- `Platform` has a new required port, `sessionStore`: `get`, `set` and `remove` of one small JSON value in plain app storage. Not the vault, and never inside the wallet record.
- `Env` has a new required value, `apiBaseUrl`, and `envFrom` refuses settings without it. `EnvSettings` gains `apiBaseUrl`, `platform`, `development` and `rpcUrl`.
- `configureHttp`, `HttpConfig` and its `headers()` are gone. There is nothing to call in their place: where requests go is `env.apiBaseUrl`, and the one header every request carries is added by the package. A server or a test that named an RPC provider with `configureHttp({ rpcUrl })` now sets `rpcUrl` in the environment.
- `RPC_RELAY_PATH`, `JUPITER_RELAY_PATH` and `PRIVATE_PAYMENT_RELAY_PATH` are gone. An address is built with `apiUrl(route, rest)`.
- The paths changed, so the web app's own relay routes are no longer called by this package:

  | Was                                | Is                                       |
  | ---------------------------------- | ---------------------------------------- |
  | `POST /api/rpc`                    | `POST /v1/rpc`                           |
  | `/api/jupiter/*`                   | `/v1/jupiter/*`                          |
  | `POST /api/private-payments/*`     | `POST /v1/private-payments/*`            |
  | `GET` and `POST /api/relayer`      | `GET` and `POST /v1/relayer`             |
  | `GET /api/prices`                  | `GET /v1/prices`                         |
  | `GET /api/history/:symbol/:range`  | `GET /v1/history/:symbol/:range`         |
  | `POST /api/event` (each app's own) | `POST /v1/events`, as `apiUrl("events")` |

- Every one of those requests carries `Authorization: Bearer <token>`. An app's own requests to the server go through `authorizedFetch` to carry it too.
- A new failure code, `notAvailableNow`, in `ChainErrorCode`: a `switch` over the codes that lists them all needs the new case. `chainErrorMessage` already words it.
- `memoryPlatform()` now includes a `sessionStore`, and `testEnv()` an `apiBaseUrl` (`https://api.noirwire.test`). A test that pinned a relative path such as `/api/jupiter/swap/v2/order` now sees `https://api.noirwire.test/v1/jupiter/swap/v2/order`. A test setup calls `installTestPlatform()` in place of `installPlatform(memoryPlatform())` and `configureHttp(...)`, or its first request tries to start a real session.
- `WAIT_LIMIT_MS` replaces each app's own table, and where the two differed the longer stands: a check may now run 30 s on the phone (was 20 s) and an action 120 s on the web (was 90 s).

For the web app:

- Set `apiBaseUrl` to `/api` with `platform: "web"`, and have the host forward `/api/:path*` to the server; or name the server's origin and allow it in `connect-src`.
- Install a `sessionStore` over `localStorage`, and keep the cross-tab `locks`: a session's renewal runs under the lock `noirwire-session`.
- Delete `src/components/wallet/passwordCheck.ts`'s copy of the rule and call `assessPasswordWith(checker, password)` with the bundled checker. Delete `src/components/localCopy.ts` and `WAIT_LIMIT_MS` in `src/components/waiting/limits.ts`; their words and numbers are here now (see Added).
- The server-side platform passes `rpcUrl` to `envFrom`, where it passed it to `configureHttp`.

For the mobile app:

- Set `apiBaseUrl` to the server's origin (`https://api.noirwire.com`), in place of the relay URL. Plain http is accepted only for `localhost`, `127.0.0.1` and `10.0.2.2`, and only with `development: true`. A path is refused on the phone.
- Delete the `X-NoirWire-Client` header and the HTTP configuration that carried it (`src/platform/httpConfig.ts`): nothing reads `headers()` any more.
- Install a `sessionStore` over the app's plain key-value storage.
- Delete `src/features/phoneCopy.ts` and `WAITING_LIMIT_MS` in `src/ui/useWaiting.ts`; their words and numbers are here now.

### Added

- `apiUrl(route, rest?)` in `@noirwire/shared/infrastructure`: the one function that builds a request's address, from `env.apiBaseUrl` and the server's paths (`session`, `rpc`, `jupiter`, `privatePayments`, `relayer`, `prices`, `history`, `events`, `health`). `apiBaseUrl` is an origin, or on the web a path on the page's own origin.
- The anonymous session. `createSessionKeeper` in `@noirwire/shared/application` starts one (`POST /v1/session`, no token, no body), keeps it through `sessionStore`, renews it a minute before its token runs out (`POST /v1/session/refresh`) and whenever the server turns it down, shares one start or renewal among callers that arrive together and, under the platform lock, among tabs, starts a new one when a renewal is refused or the server answers `session_expired`, and replaces one older than `SESSION_MAX_AGE_MS` (24 hours; `env.sessionMaxAgeMs` sets another). Storage is the truth for every tab: what a tab holds is checked against it before each use, and a drop takes the same lock as a renewal, so a session dropped in one tab is not brought back or used on by another. A session request is given `SESSION_REQUEST_TIMEOUT_MS` (10 s), and after a failure nothing more is asked for a growing, jittered pause (`SESSION_RETRY`, a minute at most), during which callers are told at once. The session is a quota bucket, not an identity: it is not derived from the wallet, it rotates daily, and a wallet reset drops it.
- `authorizedFetch(input, init)` in `@noirwire/shared/infrastructure`: `fetch` with the session's token. After a 401 a read or an unsigned build is made once more with a renewed session; a request that hands over a signed transaction, or asks the relayer to sign one, never is. `dropSession()`, `keepSessionWith()` and `sessionRoutes` beside it.
- `errorsCopy.chain.notAvailableNow`, said the same on both platforms: "We can't do this right now. Nothing was sent, and your money has not moved. Try again." It is what a person reads when no session could be had, so a request was never made, or when a read was turned down twice for its session.
- `ApiError`, `API_ERRORS`, `ApiErrorCode` and `apiErrorIn` in `@noirwire/shared/domain`, and `apiErrorOf(response)` in `@noirwire/shared/infrastructure`: every error the server writes itself, `{ code, error }`, read by its code and never by its sentence. `isTransient` asks one again by its code. A provider's own error passes through as it came.
- `npm run test:api`: every client held to the server's OpenAPI file, named by `NOIRWIRE_OPENAPI`; it is part of `npm test` and skipped there, saying so, when the variable is unset. `npm run test:api:live`: the read paths against a running server named by `NOIRWIRE_API_URL`.
- In `@noirwire/shared/testing`: `installTestPlatform(overrides?)`, `fakeSession()`, `memorySessionStore()`, `fakeApi(routes)` to answer the server by path, and `TEST_API_URL`.
- `assessPasswordWith(checker, password)` in `@noirwire/shared/wallet`, with `PasswordChecker` and `PasswordAssessment`: the password rule as a synchronous function over a checker the app already holds, so a screen that bundles the checker runs the same rule with nothing loaded on demand. `assessPassword` is built on it.
- `WAIT_LIMIT_MS` in `@noirwire/shared/presentation`: how long each kind of wait may run before a screen ends it (content 20 s, check 30 s, review 30 s, action 120 s).
- The words both apps kept for themselves: `waitingCopy.overdue`, `waitingCopy.actionHeld`, `waitingCopy.gettingReady` and `mobileWaitingCopy.overdue`; `onboardingCopy.import.notNow` and `onboardingCopy.phrase.discarded`, `.newPhrase`, `.acknowledgeNew`; `portfolioCopy.balances` and `portfolioCopy.archived`; `marketsCopy.pricesUnavailable`; `appCopy.offline`; `earnCopy.unread` and `earnCopy.notHere`; `commonCopy.tryAgain`; `mobileWalletCopy.newPassword.checkFailed`; `mobilePortfolioCopy.create.forExample` and `.nameNeeded`.

### Fixed

- A relayer-paid send or Earn move that landed is no longer reported as "did not go through, safe to try again" when the app is closed after the broadcast. The signed transaction the relayer returns (now `{ transaction, signature }`, signing only) is checked, its id is written into the reservation, and only then is it sent. A reservation with no recorded id is never released on its blockhash alone: the signer's recent transactions are searched for it first (`signer` and `ownSignature` on the pending action; `unfindable` when the chain cannot be searched, which only the person can then clear).
- Cash no longer reads as it did before an action whose network cost it paid: the cost is taken off locally the moment a tracker send lands, and off an Earn move whose balances could not be read back.
- "Max" on an Earn withdrawal takes the whole position back by its shares (the Lend program's `redeem`), where it asked for a USDC amount that could be a few units more than the chain would give and failed. Nothing is left behind. Any withdrawal that asks for what the position is worth or more is that redemption.
- No raw chain or program text reaches a person. A failed simulation is worded in one place (`simulationRefusal`), and `failureMessage` replaces any account that carries JSON, an instruction error or a program log with the plain words for what the action was doing (`saysRawChainError`).
- A fee payer that cannot pay the network reads as the relayer not being usable ("The network cost could not be covered in USDC right now. Nothing was sent."), not as `"InsufficientFundsForFee"`.
- A tracker sent from a portfolio with no cash says the portfolio needs cash for the network cost. It is decided before the relayer is asked, whose failed simulation used to read as "not available".
- The funding form states its fees to the same decimal as its review: 0.025 and 25.225, not 0.03 and 25.23.

### Changed

- `reviewSend` reads the recipient from the network and answers `recipient` beside the cost (`SendReview`): null for a wallet, why it cannot receive, or `"unreadable"`. `sendRecipientRefusal(review)` words it. `SendChain` needs `checkRecipient`. No screen can review a send to an address nobody checked.
- Activity entries carry `networkCost`. A row and the detail show it, and a return from Earn reads as what arrived: 10.00 withdrawn at a cost of 0.02 is "+$9.98", with `amount`, `arrived` and `networkCost` on the detail. `ActivityRowView.networkCost` and `ActivityDetailView.arrived` and `.networkCost` are new.
- A wallet imported from its phrase is marked `imported`, and `activityListView` answers `importedNote` on it: activity from before the import, made on another device, is not shown.
- What is in Earn counts in a value on both platforms: `homeView`'s total includes it, and `portfolioView` takes the portfolio's Earn as a fifth argument and answers `inEarn`. An app that added Earn to a total itself must stop.
- `earnReviewView` takes `failure` with the action and amount it was about, and answers `error` only on a review of that same action and amount.
- `resetWallet()` drops the session once the wallet is removed, and a tab that hears of a reset made elsewhere drops the one it holds.
- An import hands the thread back between owners, before each key is derived and before each owner's accounts are worked out, so a slow phone keeps drawing and a tap on Cancel is heard promptly.
- A signed submit that was dispatched is never reported as "nothing was sent". Any answer short of a clear success, the server's own 401 included, is an unknown outcome: the reservation is kept and the chain settles it. Only a submit that never left the device, for want of a session, fails as `notAvailableNow`. A private transfer handed over with no signature to settle by is unknown too, where a refusal used to be taken at its word.
- The relayer's client goes by the server's codes: `unavailable` means the replica never had the request, `insufficient_payment` that the fee is asked for again, and anything it cannot vouch for is unknown.
- Live prices and a chart read the server's answers as they are now: `{ prices }` aged by the `Age` header, `{ points }`, and an error body for everything else.

## [0.4.1] - 2026-10-03

### Added

- The waiting standard. `waitingView(elapsedMs, kind, steps?)` in `@noirwire/shared/presentation` says what to show as time passes: nothing before `WAITING_DELAY_MS` (300 ms), then a quiet signal, then a calm "still working" line after `STILL_WORKING_AFTER_MS` (4 s for content, a check or a review; 8 s for an action), and which step of multi-step work is current. A pure function of elapsed time: each platform owns its clock. `importWaitingView` and `importFailedText` do the same for an import, with `IMPORT_LAST_STEP_AFTER_MS` (6 s).
- `waitingCopy`, and the import's progress words (`onboardingCopy.import.progress`, with the phone's lead and failure in `mobileOnboardingCopy.import.progress`).
- Quiet retries for reads: `withRetries`, `readWithRetries`, `READ_RETRY`, `isTransient` in `@noirwire/shared/application`. Three tries, 400 ms and then 800 ms apart, on a request that never got through, ran out of time or came back 429 or 5xx. Wrapped: the balance refresh, live prices, price history, tracker multipliers, the lending rate and position, import lookups, `checkRecipient`, and preparing a review (a trade's price, a send's cost, whether a holding is open, the relayer's price and keys). Nothing that signs or submits is retried, and a refusal never is.
- `mobileSettingsCopy` and `mobileWalletCopy`: the phone's Settings, Unlock and Reset words, as variants. `unlockProblemText` and `isWrongPassword` in `@noirwire/shared/presentation`.
- `walletCopy.reset.notRemoved`, `walletCopy.crossTab.notice` and `walletCopy.crossTab.refused`, which the web app kept for itself.
- `decimalAmount` in `@noirwire/shared/domain`: a period or a comma as the decimal separator, and null for text that could be read two ways.
- `signAsClient` and `unsignedTransaction` in `@noirwire/shared/testing`, for a test's stand-in chain client to sign through the real signing guard. The testing layer may now import `infrastructure/` for that.
- The phone's layout tokens in `@noirwire/shared/design`: `mobileRadius`, `layout`, `size`, `MIN_TARGET`, `opacity`, `overlayColor`, `fonts`, `motion`, and `space[8]`.
- `failureAccount` in `@noirwire/shared/presentation`: a failure in its own account, which is what it is counted under.

- `lookFurtherForPortfolios(mnemonic, scheme, activity)` in `@noirwire/shared/infrastructure`, and `lookFurtherView` with `onboardingCopy.import.lookFurther` ("Missing a portfolio? Look further"): a second scan a person can ask for from an import's result. It carries on from where the first stopped (`SchemeActivity.scannedThrough`) and gives up only after `EXTENDED_DISCOVERY_GAP` (100) unused addresses in a row.
- `canCreatePortfolio` and `unusedPortfoliosInARow` in `@noirwire/shared/application`, and the constants `DISCOVERY_GAP` (20), `EXTENDED_DISCOVERY_GAP` and `MAX_UNUSED_PORTFOLIOS_IN_A_ROW` (10) in `@noirwire/shared/domain`.
- `createPacer` in `@noirwire/shared/application`, a rate pacer with an injectable clock, and `paceImportWith` and `IMPORT_REQUESTS_PER_SECOND` (8) in `@noirwire/shared/infrastructure`. `withRetries` takes `jitter` and `random`.
- `MAX_ACTIVITY_ENTRIES` (500) in `@noirwire/shared/domain`, `olderNotKept` on the Activity list view, and its words for both platforms.

- `focusRing` and the `focus` token in `@noirwire/shared/design`; `findStock` and `phraseWords` in `@noirwire/shared/infrastructure`; `canonicalSymbol` on the catalog; `tooPrecise` and `smallestAmount` in `@noirwire/shared/domain`; `portfolioNameTaken` in `@noirwire/shared/application`; `privacySectionHelp` in `@noirwire/shared/presentation`; `LOCK_SIGNAL_KEY` in `@noirwire/shared/wallet`.

### Changed

- `lock()` locks the wallet everywhere it is open: it announces the lock through the vault, under `noirwire.wallet.lock` (a counter, nothing about the wallet), and every other tab or running copy locks on hearing it. A reset does the same when the record would not be removed. An idle lock stays with the tab that went idle.
- `changePassword` refuses the password it already has: "That is already your password."
- Every button variant, the icon button, the input and the chip carry a keyboard focus ring in a colour named outright (`focusRing`).
- Every counted noun goes through `plural`: "1 asset", "1 result", "Order placed".
- `sendCopy.invalidAmount` and `mobileSendCopy.invalidAmount`: "Enter a finite amount greater than zero." and "Enter an amount greater than zero." are now "Enter an amount, like 12.50."
- An amount typed with more decimals than its asset has, which includes one below its smallest unit, is refused in a send, when moving money in, in Earn and in a trade: "That amount has too many decimals. The smallest amount is 0.000001 USDC."
- `parseRecoveryPhrase` reads a phrase as people paste one (numbered lists, commas, line breaks, tabs, capitals) and says exactly what is wrong: how many words there were, which word is not a recovery phrase word and where it stands, or that the words do not form a phrase. It answers `problem` beside `error`.
- `stockBySymbol` and the catalog's `asset` find a tracker whatever the capitals: `nvdax` is NVDAx.
- `createPortfolio` refuses a name another portfolio already has, archived ones included, with `duplicateName`.
- `fundingAmountView` takes `touched` and shows no error under an amount field nobody has typed in.
- `createPortfolio` refuses with `unusedPortfolios` ("You have several portfolios that were never used. Use one of those first. An archived one can be restored.") once the wallet ends in ten portfolios in a row that never held or did anything, archived ones included.
- An import asks about each candidate address in one request instead of two, paces all its requests to eight a second across both sets of addresses, and adds jitter to its pauses after a refusal.
- The wallet's record keeps its 500 most recent activity entries. The oldest are dropped as new ones are written.

Failure and waiting messages say what happened, what it means for the money and what to do next, and no longer say how the app asked. This changes what the web says too.

| String                                                            | Was                                                                                                                    | Is                                                                                                                                      |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `onboardingCopy.import.networkFailed`                             | Could not reach the network to check balances. Try again.                                                              | We couldn't finish importing your wallet. Nothing was saved in this browser. Try again.                                                 |
| `onboardingCopy.import.checking`                                  | Checking balances and recovering portfolios onchain...                                                                 | Finding your portfolios...                                                                                                              |
| `onboardingCopy.password.encryptFailed`                           | Could not encrypt the wallet. Try again.                                                                               | We couldn't encrypt your wallet, so nothing was saved. Try again.                                                                       |
| `mobileOnboardingCopy.import.networkFailed`                       | Could not reach the network to check this phrase. Try again.                                                           | We couldn't finish importing your wallet. Nothing was saved on this phone. Try again.                                                   |
| `mobileOnboardingCopy.import.offline`                             | You're offline. Importing needs the network to find what this phrase holds.                                            | You're offline. Nothing was saved on this phone. Go back online to import your wallet.                                                  |
| `appCopy.networkGate.wrongNetwork(n)`                             | This app is built for n, but its network connection serves a different chain. Nothing can be sent until that is fixed. | NoirWire is not connected to n as it should be. Your money has not moved, and nothing can be sent until this is fixed. Try again later. |
| `appCopy.networkGate.unreachable`                                 | The network could not be reached, so balances cannot be shown safely.                                                  | We can't show your balances right now. Your money has not moved. Try again.                                                             |
| `mobileAppCopy.network.checking`                                  | Checking the network...                                                                                                | Getting things ready...                                                                                                                 |
| `errorsCopy.chain.noQuote`                                        | Jupiter has no price for this order right now.                                                                         | There is no price for this order right now. Nothing was traded. Try again in a moment.                                                  |
| `errorsCopy.chain.wrongNetwork`                                   | The network connection serves a different chain than this app is built for. Nothing was signed or sent.                | NoirWire is not connected to Solana as it should be, so this was stopped. Nothing was signed or sent. Try again later.                  |
| `errorsCopy.funding.failed`                                       | Funding failed.                                                                                                        | We couldn't move this money. Nothing was moved. Try again.                                                                              |
| `errorsCopy.funding.privateNotStarted`                            | The private transfer could not be started.                                                                             | The private transfer could not be started. Nothing left your funding wallet. Try again.                                                 |
| `errorsCopy.send.notCompleted`                                    | Transfer could not be completed. Check the balance and recipient.                                                      | This send can't be made. Nothing was sent. Check the amount and the recipient's address.                                                |
| `errorsCopy.send.failed`                                          | Transfer failed.                                                                                                       | We couldn't complete this send. Nothing was sent. Try again.                                                                            |
| `errorsCopy.trade.noPrice`                                        | Could not get a price for this trade.                                                                                  | We couldn't get a price for this trade. Nothing was traded. Try again.                                                                  |
| `errorsCopy.earn.failed`                                          | The transaction did not complete.                                                                                      | This did not go through. Nothing was moved. Try again.                                                                                  |
| `sendCopy.sending`                                                | Sending onchain...                                                                                                     | Sending...                                                                                                                              |
| `fundingCopy.unknown`                                             | ...was sent, and the answer never came back. It may still arrive...                                                    | ...was sent, but we could not confirm that it arrived. It may still arrive...                                                           |
| `tradeCopy.costCheckFailed`                                       | Could not check the network cost of this order. Get a new price.                                                       | We couldn't work out the network cost of this order. Nothing was charged. Get a new price.                                              |
| `pieCopy.order.costCheckFailed`                                   | Could not check the network cost of these orders. Try again.                                                           | We couldn't work out the network cost of these orders. Nothing was charged. Try again.                                                  |
| `mobilePortfolioCopy.home.refreshFailed`, `.detail.refreshFailed` | Could not refresh. Pull down to try again.                                                                             | We couldn't update your balances. What you see may be out of date. Pull down to try again.                                              |
| `mobileFundingCopy.page.readFailed`                               | Could not refresh. Pull down to try again.                                                                             | We couldn't update your balance. What you see may be out of date. Pull down to try again.                                               |

- `failureMessage` no longer passes on a failure's own account when that only says how a request failed ("fetch failed", "429 Too Many Requests", "Jupiter returned 502."): the person is told the plain words for what the action was doing. Analytics still band the failure by its own account (`failureAccount`).
- `typedAmount`, and with it the send, funding and Earn drafts, reads an amount through `decimalAmount`: "12,5" is 12.5 on both apps, and "1e3", "0x10" and grouped digits are no longer amounts.

Kept as they are, because they are honest and needed: "Network cost" and "Relay fee" as fee lines, "Solana" where the chain matters, "offline", and the privacy notes that name who can see what (NoirWire's server, the network provider, Jupiter, MagicBlock).

### Fixed

- An import's pace was taken before a request had one of its three slots, so requests that queued behind slow answers all started together when those came back. The turn is now taken inside the slot, right before the request is sent.
- Locking the wallet in one tab left it unlocked and usable in the others.
- Changing the password to the same password reported "Password changed".

- A funded portfolio could be lost to a restore. An import stops looking after 20 unused addresses in a row, and creation allowed any number of empty portfolios: twenty empty ones and then a funded one put the funded one out of reach. Creation is now held to a limit safely under the scan's gap, a test holds the two constants to that, and a further scan can be asked for.
- An import could fail on a provider that allows about ten requests a second: both sets of addresses started together and sent a burst, and pauses that lined up used up the retries. Requests now share one pace, and a failed attempt carries on from the last completed step when it is tried again instead of starting over.
- The activity list grew without limit inside the encrypted record, so every write and unlock grew with it, and web storage could in time refuse a write.

- An action that landed can no longer be reported as failed. `send` and `fundDirectly` answered `failed` when the balance read after a landed transaction threw, which invited paying again. Now, once the chain or the venue has confirmed, the answer is `confirmed`: the read after it is asked again quietly, and if it still cannot be had the answer carries `settlement: "balancesEstimated"` (`balancesUnread(result)` in `@noirwire/shared/application`), which a screen shows as done, "Balances will update shortly." The same holds for Earn deposits and withdrawals, a trade whose account was just opened, opening a pie's holdings, and a private transfer the service accepted. An unknown outcome stays unknown, and a reservation that cannot be ended never changes what an action answers. `sendResultView`, `earnResultView` and `fundingOutcomeView` take `balancesUnread`. With that guaranteed, a failure before anything was sent says so: "Nothing was sent", "Nothing was moved".

- A password change left `indeterminate` no longer holds every later change until the app restarts: it is forgotten when the wallet is reset, and settled when the record read back is another one.

## [0.4.0] - 2026-10-03

### Added

- Every phone screen's view model, ported into `presentation/`: Home, a portfolio, Activity, receiving, markets and a tracker's page, the trade sheet, the pie builder and orders, moving money in, sending, and Earn.
- Typed route-parameter helpers (`portfolioParams`, `fundingReceiveParams`, `publicViewParams`, `readReceiveTarget`, and the rest).
- The phone's words as copy variants beside the web's, for every screen that needed one.
- `installMoney(locks)` in `@noirwire/shared/wallet`: the one pending-action store and signing guard an app installs once. Signing refuses when no guard is installed, when no reservation holds the signer, and when the connection's network does not match the app's, checked right before every signature. `processLocks()` in `@noirwire/shared/application` is one lock registry for the whole process.
- The recipient check exported from `@noirwire/shared/infrastructure` (`unsendable`, `checkRecipient`, `recipientFromCode`) and `hasForeignCharacters` from `@noirwire/shared/domain`.
- Pie mix rules in `@noirwire/shared/domain`: `mixFrom`, `changeMix`, `wholePercent`, `investFloor`, `rebalanceSells`.

### Fixed

- The network check before a signature is bounded to 10 seconds: a read that never answers refuses the action with nothing signed.
- Pie copy says trackers; `activityAmount` prints USDC with two decimals and a tracker with its four; `sinceDate` writes "Sep" on every runtime; the balance refresh answers whether every read came back.
- Earn moves are recorded as `earnDeposit` and `earnWithdraw` activity; a send keeps its recipient in its own encrypted activity entry; a password change whose write cannot be confirmed answers `indeterminate` instead of a false success or failure.

## [0.3.0] - 2026-10-03

### Added

- Biometric unlock: `vaultKeyBits`, `vaultKeyFromBits`, `unlockWithKeyBits`, and `changePassword` with an `onRekey` callback that keeps a device keystore in step with a password change, without ever handing it the password or the phrase.
- The phone's phrase quiz (`src/application/phraseQuiz.ts`): random positions asked in order, a wrong pick disables that choice, three misses restart the attempt.
- Import findings view models (`importSourceView`, `importResultView`, `importFoundText`, `importSchemeFor`, `groupsOfFour`) and the `ImportResolution` and `SchemeActivity` domain types behind them.
- The phone's onboarding words, `mobileOnboardingCopy`.

## [0.2.0] - 2026-10-03

### Added

- The wallet core moved into the package: sealing, key derivation, signing guards, transaction builders, the relayer's template and pricing checks, private payments, pending actions, the use cases, their view models and copy.
- The platform seams the apps wire in at boot: the vault, locks, activity and environment ports, and the HTTP client configuration.
- Integration and contract test suites alongside the unit suite.

### Fixed

- Wallet reset, saving, and the plaintext-phrase cleanup are each held to their own tests, across several tabs sharing one vault.

## [0.1.0] - 2026-10-03

### Added

- Initial package: platform ports and in-memory test doubles, design tokens, and chart maths.
- The first use-case results, the pending-action reducer, and the earliest view models.
- The layer dependency rule, enforced by a local ESLint rule and proven by its own fixture suite.
- The async vault port and typed usage-event tracking, so a tracked property cannot be an address by accident.
- Reservation-first pending actions: one lock-guarded reservation per portfolio before anything is signed.
- README, SECURITY.md, and CONTRIBUTING.md.
- CI: type check, lint, format check, unit tests, build, and pack.
