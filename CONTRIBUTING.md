# Contributing

## Before you commit

Run all five. CI runs the same checks and a pull request does not merge until they pass.

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

`npm run format` fixes formatting. A change to the chain clients or the guards also runs `npm run test:integration` (a local `solana-test-validator`) and, where it touches a live service's shape, `npm run test:contract`.

## Commits

- Keep the subject under 50 characters.
- Start it with a conventional prefix: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `ci:` or `build:`.
- Write it in the imperative: `fix: refuse a second confirm`, not `fixed` or `fixes`.
- One change per commit. Explain why in the body when the reason is not obvious from the change.

## Tests

Every change comes with its tests. A new rule has a test for each branch; a fixed bug has a test that failed before the fix.

## The dependency rule

Each folder under `src/` may import only what its `README.md` allows:

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

Nothing imports from an app, from React, React Native, Next or Expo, or from Node. `npm run lint` enforces this through `eslint-rules/dependency-rule.mjs`, which checks where each import resolves to, and `tests/dependencyRule.test.ts` proves it. If you change the table, change that rule and that test with it.

## Code

- Small modules with one job each, named in the product's words: portfolio, funding wallet, tracker.
- No dead code and no commented-out code. Comment only where the reason is not obvious.
- Build what the change needs and nothing more. A new dependency needs a reason in the pull request, and a library both apps already carry is a `peerDependency`, so each app has one copy.
- Use relative imports with the `.js` extension. The package ships as ES modules.
- Use cases return reason codes, never words. A string a person reads goes in `src/copy/`; choosing it, and everything else a screen shows, goes in `src/presentation/`.
- Nothing that decides whether money is safe may read the device's clock.

## Text people read

- Say "portfolio", "funding wallet" and "trackers".
- No em dashes. Three periods for an ellipsis.
- Say plainly what happened and what to do next.

## Security issues

Do not open an issue or a pull request for a vulnerability. See [SECURITY.md](SECURITY.md).
