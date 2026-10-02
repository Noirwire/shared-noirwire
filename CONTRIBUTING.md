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

`npm run format` fixes formatting.

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
| `platform.ts`     | nothing of ours                          |
| `copy/`           | `domain/`                                |
| `application/`    | `domain/`, `copy/`, `platform.ts`        |
| `infrastructure/` | `domain/`, `application/`, `platform.ts` |
| `presentation/`   | `domain/`, `application/`, `copy/`       |
| `testing/`        | `platform.ts`                            |

Nothing imports from an app, from React, React Native, Next or Expo, or from Node. `npm run lint` enforces this, and `tests/dependencyRule.test.ts` proves the lint rule fires. If you change the table, change `eslint.config.mjs` and that test with it.

## Code

- Small modules with one job each, named in the product's words: portfolio, funding wallet, tracker.
- No dead code and no commented-out code. Comment only where the reason is not obvious.
- Build what the change needs and nothing more. A new dependency needs a reason in the pull request, and a library both apps already carry is a `peerDependency`, so each app has one copy.
- Use relative imports with the `.js` extension. The package ships as ES modules.
- A string a person reads goes in `src/copy/`. What a screen shows goes in `src/presentation/`.

## Text people read

- Say "portfolio", "funding wallet" and "trackers".
- No em dashes. Three periods for an ellipsis.
- Say plainly what happened and what to do next.

## Security issues

Do not open an issue or a pull request for a vulnerability. See [SECURITY.md](SECURITY.md).
