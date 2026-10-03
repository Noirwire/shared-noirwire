# Changelog

All notable changes to this package are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The apps pin an exact tag; see [README.md](README.md#releasing) for how a tag becomes a release.

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
