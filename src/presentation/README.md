# presentation

View models. The web app and the mobile app are one product, so what a screen says and when a button is disabled is decided here, once, and each app only draws it.

## The rules

1. A view model is a pure function of state. Same input, same output, no clock, no storage, no network.
2. It returns display-ready values: text already formatted, a tone, flags. Never JSX, never a class name, never a colour.
3. A component renders the view model and forwards events. It does not branch on the state the view model was built from.
4. A rule or a string that a screen needs is added here and in `copy/`, never in an app. Use cases return reason codes; the words for them are chosen here (`refusal.ts`).
5. Every branch of a view model has a unit test.

## The worked example

The network cost row of a money review:

- `copy/networkCost.ts` holds every string.
- `presentation/networkCost.ts` exports `networkCostView(state)`. Its input is the cost (a discriminated union of the ways a cost can be met, or null while it is worked out), the intent's pending action and whether the action is being submitted. Its output is `{ label, value, tone, explanation, confirmDisabled }`. Whether Confirm can be pressed is decided here and nowhere else.
- `presentation/networkCost.test.ts` covers each kind.

A renderer on either platform is then a few lines:

```ts
const view = networkCostView({ cost, pending, submitting });
// draw view.label and view.value, colour by view.tone,
// list view.explanation, disable Confirm when view.confirmDisabled
```

Copy this shape for the next screen: strings in `copy/`, one pure function here, a test per branch.

**May import:** `domain/`, `application/`, `copy/`.

**Must never import:** `infrastructure/`, `platform.ts`, `design/`, `testing/`. A view model names a tone; the app maps the tone to a token.
