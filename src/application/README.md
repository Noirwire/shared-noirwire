# application

One use case per money action. Each follows the same lifecycle: plan, review, guard, sign, submit, settle. Each answers with an `ActionResult` (`result.ts`).

`pending.ts` is the state machine for an action that was sent and has not settled. While one is unsettled, the same intent cannot be confirmed again.

**Belongs here:** use cases, the result type, the pending-action reducer, and the interfaces a use case needs from the outside world.

**May import:** `domain/`, `copy/` and `platform.ts`.

**Must never import:** `infrastructure/`, `presentation/`, `design/`, `testing/`. A use case receives its clients through an interface it declares; it does not reach for one.
