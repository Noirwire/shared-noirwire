# application

One use case per money action. Each follows the same lifecycle: plan, review, guard, sign, submit, settle. Each answers with an `ActionResult` (`result.ts`): reason codes and data, never words.

`pending.ts` is the life of one action as a pure reducer, from its reservation before signing until the chain settles it. `pendingStore.ts` applies its events to the vault in one atomic update each, so an intent cannot be reserved twice. Only chain evidence settles an action, never the device's clock.

**Belongs here:** use cases, the result type, the pending-action reducer, and the interfaces a use case needs from the outside world.

**May import:** `domain/` and `platform.ts`.

**Must never import:** `copy/`, `infrastructure/`, `presentation/`, `design/`, `testing/`. Choosing words is presentation's job. A use case receives its clients through an interface it declares; it does not reach for one.
