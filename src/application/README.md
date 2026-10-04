# application

One use case per money action, in `actions/`. Once an action has landed, nothing after it may answer `failed`: a balance that cannot be read back is `settlement: "balancesEstimated"` on a success. Each has the same steps in its body: plan, review, guard, reserve, sign, submit, settle. Each answers with an `ActionResult` (`result.ts`): reason codes and data, never words.

`pending.ts` is the life of one action as a pure reducer, from its reservation before signing until the chain settles it. `pendingActions.ts` keeps it in the encrypted wallet record through the store, reserving under a lock every tab shares, so a portfolio cannot have two actions under way. Only chain evidence settles an action, never the device's clock.

The rest is what the screens read: the catalog and valuation (`catalog.ts`, `portfolio.ts`, `pie.ts`, `markets.ts`), how a network cost is met (`networkCost.ts`) and each action's draft. `screenReads.ts` bundles the catalog and the reads built on it for the view models. `processLocks.ts` is the one registry of live reservations for an app that runs as one process: a reservation it holds, the one being made included, is alive to every caller, and any other was left by an earlier run. `phraseQuiz.ts` holds the phone's recovery phrase quiz: the positions it asks, the choices it offers and when a run of misses starts it again.

`retries.ts` is the quiet retry for reads: `withRetries(attempt, { tries, pauseMs, retryable })` and `readWithRetries`, which tries three times, 400 ms and then 800 ms apart, and only on a failure of the asking itself (a request that never got through, ran out of time, or came back 429 or 5xx). The balance refresh, a trade's price, the cost of a review and the clients' own reads go through it. Nothing that signs, submits or could move money does, and a refusal is never asked again: it is an answer.

`apiSession.ts` keeps the app's anonymous session with NoirWire's server: started when there is none, renewed a minute before its token runs out, replaced once it is a day old, and shared by callers that arrive together, under the platform lock so two tabs make one between them. It is a quota bucket, not an identity, and nothing in it comes from the wallet. Where sessions come from is an interface it declares (`SessionGateway`); `infrastructure/` supplies the server's routes.

`pacer.ts` spaces requests so that no more than a set number start in a second, with a clock that can be passed in.

**Belongs here:** use cases, the result type, the pending-action reducer, and the interfaces a use case needs from the outside world (`ports.ts`).

**May import:** `domain/` and `platform.ts`.

**Must never import:** `copy/`, `infrastructure/`, `presentation/`, `design/`, `testing/`. Choosing words is presentation's job. A use case receives its clients through an interface it declares; it does not reach for one.
