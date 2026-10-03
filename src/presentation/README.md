# presentation

View models. The web app and the mobile app are one product, so what a screen says and when a button is disabled is decided here, once, and each app only draws it.

## The rules

1. A view model is a pure function of state. Same input, same output, no clock, no storage, no network.
2. It returns display-ready values: text already formatted, a tone, flags. Never JSX, never a class name, never a colour.
3. A component renders the view model and forwards events. It does not branch on the state the view model was built from.
4. A rule or a string that a screen needs is added here and in `copy/`, never in an app. Use cases return reason codes; the words for them are chosen here (`actionResult.ts`).
5. Every branch of a view model has a unit test.

## The worked example

The network cost of a money review:

- `copy/networkCost.ts` holds every string.
- `presentation/networkCost.ts` exports `networkCostView(state)`. Its input is the cost (a discriminated union of the ways a cost can be met, or null while it is worked out), whether the portfolio's last action still holds confirming back, whether the action is being submitted and whether it is an Earn withdrawal. Its output is `{ label, value, tone, explanation, moveMoney, details, confirmDisabled }`. Whether Confirm can be pressed is decided here and nowhere else.
- `tests/unit/presentation/networkCost.test.ts` covers each kind.

A renderer on either platform is then a few lines:

```ts
const view = networkCostView({ cost, pending: { blocked }, submitting });
// draw view.label and view.value, colour by view.tone, list view.explanation,
// put the link to move money between view.moveMoney.before and .after,
// show view.details behind a disclosure, disable Confirm when view.confirmDisabled
```

Copy this shape for the next screen: strings in `copy/`, one pure function here, a test per branch.

## Waiting

Whenever something takes time, both apps show the same thing at the same moment, decided by `waitingView(elapsedMs, kind, steps?)` in `waiting.ts`. It is a pure function of the time that has passed: there is no timer inside it. Each platform owns its clock, calls it as time passes and draws what it answers.

| Elapsed                             | What is shown                                                            |
| ----------------------------------- | ------------------------------------------------------------------------ |
| under `WAITING_DELAY_MS` (300 ms)   | nothing, so a wait that ends at once never flickers                      |
| from 300 ms                         | a quiet signal: `signal` and its `label`                                 |
| from `STILL_WORKING_AFTER_MS[kind]` | the same, plus the calm `stillWorking` line                              |
| any time, for work with steps       | `steps`, with the one under way marked `current` and those before `done` |

| Kind      | For                                                          | Signal        | Label                      | Still working after |
| --------- | ------------------------------------------------------------ | ------------- | -------------------------- | ------------------- |
| `content` | balances, prices, a list, a chart loading                    | `placeholder` | "Loading" (announced)      | 4 s                 |
| `check`   | something typed being checked: a recipient, a phrase         | `indicator`   | "Checking..."              | 4 s                 |
| `review`  | a review being prepared: its price and its cost              | `indicator`   | "Preparing your review..." | 4 s                 |
| `action`  | a confirmed action being carried out: a send, funding, a pie | `indicator`   | "Working on it..."         | 8 s                 |

A `placeholder` is a quiet shape where the content will be; an `indicator` is a small moving mark beside the label. How each is drawn is the platform's; when, and with which words, is not.

```ts
const view = waitingView(now - startedAt, "review");
// view.signal "none": draw nothing. Otherwise draw the signal with view.label,
// and view.stillWorking under it once it is not null.

const order = waitingView(now - startedAt, "action", { titles: stepTitles, current: 1 });
// order.steps is the progress list: done, current, waiting.
```

An import has its own, `importWaitingView(elapsedMs, platform)`: its title and lead, the three steps (the list moves to the last one after `IMPORT_LAST_STEP_AFTER_MS`, 6 s, so a long lookup still shows progress) and its own slow line. `importFailedText(platform)` is what it says when it could not finish.

The words are in `copy/waiting.ts` and follow one rule: a person waits for their balance or their order, never for a request. Nothing shown while waiting, and nothing said after a failure, names a request, a service or a timeout. A failure says what happened in the person's terms, what it means for their money ("Nothing was sent", "Nothing was charged", "Nothing was saved") and what to do next. `failureMessage` holds to that even for a failure that arrives with its own account: one that only says how a request failed ("fetch failed", "returned 502") is replaced by the plain words for what the action was doing.

Before a read is reported as failed it has already been asked for again a few times, quietly (`readWithRetries` in `application/retries.ts`), so the waiting signal simply stays up a little longer on a busy moment.

## One view model per screen

The web and the phone draw the same screens from the same view models. Where the two truly differ, in wording ("this browser" and "this phone") or in a rule the phone adds (nothing is confirmed offline), the view model takes a `platform: "web" | "mobile"` input and chooses; it never returns layout. The view models the web already used before the phone joined take it as an optional field that defaults to the web's words, so the web's screens read exactly as they did.

A view model that reads prices, the catalog or valuations takes `ScreenReads` as its first argument (`createScreenReads` in `application/`). An app passes the one bound to its price feeds, `screenReads` from `@noirwire/shared/wallet`; a test passes one over fixed prices (`tests/unit/support/screens.ts`).

## Route parameters

Both apps build and read links with the helpers in `routes.ts`, so a link means the same on either platform:

| Parameter                | Where                                                                                     | Helpers                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `portfolio=<id>`         | every sheet that acts for a portfolio: fund, receive, send, trade, pie order, pie builder | `portfolioParams`, `tradeParams`, `pieOrderParams`, `readPortfolioParam` |
| `portfolio=funding`      | a sheet acting for the funding wallet                                                     | `FUNDING_PARAM`, `fundingReceiveParams`, `readsFunding`                  |
| `reveal=1`               | the funding wallet's receive sheet, opening with the address shown                        | `fundingReceiveParams`, `readReceiveTarget`                              |
| `view=public`            | a portfolio's own screen, opened at its public view                                       | `publicViewParams`, `readPublicView`                                     |
| `side`, `symbol`, `mode` | the trade sheet and the pie order sheet                                                   | `tradeParams`, `readSide`, `pieOrderParams`, `readPieMode`               |

A route is logged, restored and shared in ways an app does not control, so a parameter is only ever an id, a tracker symbol or one of these words. Every reader refuses a value shaped like an address (`isAddressFreeParam`).

**May import:** `domain/`, `application/`, `copy/`.

**Must never import:** `infrastructure/`, `platform.ts`, `design/`, `testing/`. A view model names a tone; the app maps the tone to a token.
