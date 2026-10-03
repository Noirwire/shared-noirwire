# Changelog

All notable changes to this package are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The apps pin an exact tag; see [README.md](README.md#releasing) for how a tag becomes a release.

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

### Changed

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
