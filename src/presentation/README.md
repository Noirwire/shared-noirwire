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

A wait does not run for ever. `WAIT_LIMIT_MS` says how long each kind may run before the screen stops waiting, says so with `waitingCopy.overdue` (the phone's differences are in `mobileWaitingCopy.overdue`) and offers a way out: 20 s for content, 30 s for a check or a review, 120 s for an action. The work may still finish unseen, which is why an action's line says to check Activity before doing it again. Each platform owns the timer here too.

An import has its own, `importWaitingView(elapsedMs, platform)`: its title and lead, the three steps (the list moves to the last one after `IMPORT_LAST_STEP_AFTER_MS`, 6 s, so a long lookup still shows progress) and its own slow line. `importFailedText(platform)` is what it says when it could not finish.

The words are in `copy/waiting.ts` and follow one rule: a person waits for their balance or their order, never for a request. Nothing shown while waiting, and nothing said after a failure, names a request, a service or a timeout. A failure says what happened in the person's terms, what it means for their money ("Nothing was sent", "Nothing was charged", "Nothing was saved") and what to do next. `failureMessage` holds to that even for a failure that arrives with its own account: one that only says how a request failed ("fetch failed", "returned 502") is replaced by the plain words for what the action was doing.

Before a read is reported as failed it has already been asked for again a few times, quietly (`readWithRetries` in `application/retries.ts`), so the waiting signal simply stays up a little longer on a busy moment.

## One view model per screen

The web and the phone draw the same screens from the same view models. Where the two truly differ, in wording ("this browser" and "this phone") or in a rule the phone adds (nothing is confirmed offline), the view model takes a `platform: "web" | "mobile"` input and chooses; it never returns layout. The view models the web already used before the phone joined take it as an optional field that defaults to the web's words, so the web's screens read exactly as they did.

A view model that reads prices, the catalog or valuations takes `ScreenReads` as its first argument (`createScreenReads` in `application/`). An app passes the one bound to its price feeds, `screenReads` from `@noirwire/shared/wallet`; a test passes one over fixed prices (`tests/unit/support/screens.ts`).

## The first screens

What a first-time user meets is decided here too, so both apps open the same way:

| View model                                   | Screen                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `welcomeView(platform)`                      | Welcome: the headline, two lines, three actions (only "Create a wallet" is filled) and the trust line. The web's example beside the column is `example`; the phone has none                                                                                                                                             |
| `homeView(...)`                              | Home. While the wallet is empty: one button, "Add money", `explanation` under it, no `secondary`, and `showArc` false                                                                                                                                                                                                   |
| `addMoneyView(wallet, { tradeFeeBps })`      | The add-money sheet: three steps, the person's own funding wallet address inside the second (already shown, and `captureAllowed`), "Network: Solana", and `costs`: "What does it cost?" opened in place, closed at first, so the sheet and its address stay on screen                                                   |
| `costsView({ tradeFeeBps })`                 | Costs, in Settings and inside the add-money sheet. Its numbers are read from the fee constants and the app's own trading fee; with no fee set it says "no NoirWire fee"                                                                                                                                                 |
| `aboutView()`                                | About: the help contact and the website, each with an `action` (a `mailto:` or an `https:` URL) to open on a tap, and `beta`, the line saying NoirWire is in testing                                                                                                                                                    |
| `betaView()`                                 | That NoirWire is in testing: `tag` ("Beta") for a small label beside the NoirWire mark in the header and on Welcome, `line` for Settings' About page. It is about the product, so it is shown on every network, the main one included                                                                                   |
| `discardPromptView()`                        | Asked before leaving a sheet with something typed into it: a title, a body saying what is lost, and the two buttons                                                                                                                                                                                                     |
| `unreachableView({ hasWallet, locked })`     | NoirWire could not be reached as the app opened: `checkNetwork` (in `application/`) answered `unreachable`, which it does within `NETWORK_CHECK_LIMIT_MS` (8 s) however long the read hangs. With a stored, locked wallet `unlockOffered` is true: unlocking reads only the device, so the unlock screen is still shown |
| `earnScreenView(...)`                        | Earn, titled "Earn". Off the main network `notHere` is the one line shown, and the rate, the actions, the total and the rows are left out. Who the USDC is lent through is in `risks.lines`, behind "Read the risks"                                                                                                    |
| `trackerView(...)`                           | A tracker's page. What kind of certificate it is, what its issuer can do and where it is not offered are in `risks`, behind "Read the risks"; a missing price is `commonCopy.priceUnavailable` and nothing else                                                                                                         |
| `unlockProblemView(problem, platform)`       | A failed unlock. The typed password is never cleared; after a wrong one it is kept and selected                                                                                                                                                                                                                         |
| `newPasswordView(platform)`                  | Choosing a password: the rule, with its minimum length, before anything is typed                                                                                                                                                                                                                                        |
| `noMoneyView(reads, wallet, id, balances)`   | Buying with nothing to invest, said at the first tap, with the way on: "Add money", or "Move to portfolio" when USDC is waiting. Null while balances have never been read                                                                                                                                               |
| `chartReadout(points, x, { range, readAt })` | The price and date under a finger held on a chart. `chartHighLow(points)` is the range's high and low. `chartHint(pointer)` is the line under the chart: "touch" says to press and hold, "mouse" to hover. A phone always passes "touch"; the web passes what the device reports                                        |

An import says what it is doing under its button (`importWaitingView(...).note`), says why Continue is held while it looks further (`lookFurtherView(...).continuePaused`), and skips the choice of addresses when nothing was found (`importSourceView(...).skipped`).

## How current a screen is

`homeView`, `marketsView` and `trackerView` answer `stale` (the quiet "may be out of date" notice, or null) and `loading` by one rule, `freshnessOf` in `domain/freshness.ts`:

| The read                                             | The screen               |
| ---------------------------------------------------- | ------------------------ |
| its latest attempt failed                            | `stale`, at once         |
| never came back, and nothing has failed              | `loading`, and no notice |
| last came back more than `STALE_AFTER_MS` (60 s) ago | `stale`                  |
| otherwise                                            | neither                  |

Each read is a `ReadFreshness`: when it last succeeded, and whether its latest attempt failed. Prices keep their own (`livePricesFreshness()` in `@noirwire/shared/infrastructure`). For a read an app makes itself (balances, a chart), the app keeps one and moves it on with `recordRead(previous, ok, now)`, where `ok` is the result its refresh already answers with. A chart is read once for a range, so it does not age: only its own failure makes it stale.

```ts
const freshness = { now: Date.now(), prices: livePricesFreshness(), balances };
const view = homeView(screenReads, wallet, updatedAt, earnTotal, archivedHeld, freshness);
// draw view.stale as the quiet notice when it is not null; draw the waiting state while view.loading
```

## Balances that have never loaded

An unknown balance is never shown as a zero. Until the app's balance read has come back once (`hasLoaded(read)`: its `succeededAt` is not null), every figure worked out from balances is null in the view model, and its type says so: a `Figure` is `string | null`, and a component draws nothing for null. `balancesView(read)` is the one rule:

| The balance read                 | `known` | The screen                                                                                               |
| -------------------------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| never came back, and it failed   | false   | figures null, and `unavailable`: one line and its `retry`. No stale notice: nothing is on screen to age  |
| never came back, still under way | false   | figures null, and `loading`                                                                              |
| came back at least once          | true    | figures shown. If the latest refresh failed, `stale` says they may be out of date, over the last figures |

A zero that was really read is shown as "$0.00".

The same read gates what can be done. An action that needs a known balance (send, move to portfolio, buy, sell, invest in a pie, add to or withdraw from Earn) is disabled until balances load, and where the screen gives a reason it is the same line as `unavailable.text`. Nothing is concluded from what was not read: a wallet is not called empty, a portfolio is not "Nothing here yet", a tracker is not "not owned", and "no money" is not said.

| View model                                             | Takes                                            | Null until loaded                                                                    |
| ------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `homeView`                                             | `freshness.balances`                             | `total.value`, `cash.value`, each row's `value` and `line`; `investments` is empty   |
| `portfolioRowView`                                     | a fourth argument, `balances`                    | `value`, `line`                                                                      |
| `portfolioView`                                        | a fifth argument, `balances` (before `inEarn`)   | `value`, `cashLine`, `holdings`, `empty`, `primary`; a pie's `mix.slices[].trailing` |
| `trackerView`                                          | `freshness.balances`                             | `holding.quantity`, `.value`, `.none`; `holding.rows` is empty                       |
| `sendFormView`, `tradeFormView`, `pieInvestView`       | `balances` in the state                          | `amountLine`, `available` (`available.value` on a send)                              |
| `portfolioChoices`, `noMoneyView`                      | a last argument, `balances`                      | each `caption`; `noMoneyView` answers null                                           |
| `earnScreenView`, `earnPortfolioView`, `earnSheetView` | `balances` in the state                          | each row's `cash`; the sheet's `available`                                           |
| `fundingAmountView`, `choosePortfolioView`             | `readFailed` beside `fundingBalance`; `balances` | `available.value`, and the lead names no amount; each row's `cash`                   |
| `fundingWalletView`                                    | `freshness.balances`, as `homeView` does         | `total.value`; `assets` is empty; Move to portfolio and Send are disabled            |

## The main wallet

The main wallet is the person's own public wallet: money arrives there, and it is a wallet in its own right. In code it is still `funding` everywhere (`wallet.funding`, `FUNDING`, `fundingWalletView`); only the words changed.

`fundingWalletView(reads, wallet, updatedAt, freshness)` is its page on both platforms: one balance in dollars over its USDC and SOL lines (SOL only when it holds some), the four actions (`move`, `send`, `receive`, `addMoney`, each with a `target`, `disabled` and a `reason`), and `activity`: money that arrived, moves into portfolios and its own sends, newest first, in the Activity screen's row shape. It is for money, so a tracker that sits at its address is not listed, counted or offered in Send. `homeView(...).fundingWallet` is its row on Home, leading to the page.

A send takes its source by id: a portfolio's, or `FUNDING` for the main wallet. `sendSourceView(reads, wallet, sourceId, platform)` answers what the sheet needs of either (title, name, own address, what it can send), and its `funding` goes to `sendFormView`. A send from the main wallet to one of the person's own portfolios is never reviewed: the form says to use Move to portfolio, which keeps the two apart in public. `sendReviewView` takes `fromFunding` so the cost names who pays it.

## Route parameters

Both apps build and read links with the helpers in `routes.ts`, so a link means the same on either platform:

| Parameter                | Where                                                                                     | Helpers                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `portfolio=<id>`         | every sheet that acts for a portfolio: fund, receive, send, trade, pie order, pie builder | `portfolioParams`, `tradeParams`, `pieOrderParams`, `readPortfolioParam` |
| `portfolio=funding`      | a sheet acting for the funding wallet: its receive sheet, and a send of its own           | `FUNDING_PARAM`, `fundingReceiveParams`, `readsFunding`                  |
| `reveal=1`               | the funding wallet's receive sheet, opening with the address shown                        | `fundingReceiveParams`, `readReceiveTarget`                              |
| `view=public`            | a portfolio's own screen, opened at its public view                                       | `publicViewParams`, `readPublicView`                                     |
| `side`, `symbol`, `mode` | the trade sheet and the pie order sheet                                                   | `tradeParams`, `readSide`, `pieOrderParams`, `readPieMode`               |

A route is logged, restored and shared in ways an app does not control, so a parameter is only ever an id, a tracker symbol or one of these words. Every reader refuses a value shaped like an address (`isAddressFreeParam`).

**May import:** `domain/`, `application/`, `copy/`.

**Must never import:** `infrastructure/`, `platform.ts`, `design/`, `testing/`. A view model names a tone; the app maps the tone to a token.
