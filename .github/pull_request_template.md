## What changed

<!-- One or two sentences. -->

## Why

<!-- The reason, if it is not obvious from the change. -->

## Checklist

- [ ] `npm run lint && npm run typecheck && npm run format:check && npm test && npm run build` all pass locally
- [ ] Tests added or updated for the change
- [ ] `npm run test:integration` run, if this touches a chain client or a guard
- [ ] No new dependency, or its reason is explained above
- [ ] No layer in `src/` imports something its `README.md` does not allow
