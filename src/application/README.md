# application

One use case per money action, in `actions/`. Each has the same steps in its body: plan, review, guard, reserve, sign, submit, settle. Each answers with an `ActionResult` (`result.ts`): reason codes and data, never words.

`pending.ts` is the life of one action as a pure reducer, from its reservation before signing until the chain settles it. `pendingActions.ts` keeps it in the encrypted wallet record through the store, reserving under a lock every tab shares, so a portfolio cannot have two actions under way. Only chain evidence settles an action, never the device's clock.

The rest is what the screens read: the catalog and valuation (`catalog.ts`, `portfolio.ts`, `pie.ts`, `markets.ts`), how a network cost is met (`networkCost.ts`) and each action's draft.

**Belongs here:** use cases, the result type, the pending-action reducer, and the interfaces a use case needs from the outside world (`ports.ts`).

**May import:** `domain/` and `platform.ts`.

**Must never import:** `copy/`, `infrastructure/`, `presentation/`, `design/`, `testing/`. Choosing words is presentation's job. A use case receives its clients through an interface it declares; it does not reach for one.
