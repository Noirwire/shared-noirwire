# copy

Every string a person reads, in one place, so both apps say the same thing in the same words.

**Belongs here:** constants, and small functions that put already-formatted values into a sentence.

**Style:** say "portfolio", "main wallet" and "trackers". Say plainly what happened and what to do next. No em dashes; three periods for an ellipsis. Never name the network's own currency where the cost is paid in USDC.

**One name for each thing**, on both platforms:

| Meaning                                             | Say                                                                                                  | Never say                                                                   |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Bringing money in from outside                      | "Add money" (a button), "Add digital dollars" (the explainer's title)                                | "Add USDC", "Fund", "Deposit"                                               |
| The money                                           | "USDC", introduced once per explainer as a digital dollar: 1 USDC = $1. Amounts are shown in dollars | "cash" for the asset. "Cash" is only the row label for uninvested money     |
| The person's own public wallet, where money arrives | "Main wallet" ("your main wallet" inside a sentence)                                                 | "funding wallet", "funding address". An address is what is copied           |
| A separate place for investing                      | "Portfolio" (a pie is a portfolio with a mix)                                                        | "account"                                                                   |
| Moving money from the main wallet into a portfolio  | "Move to portfolio" (a button), "Move privately" (the confirm), "private move" (the noun)            | "private route", "Fund privately", "Move money here", "Add money privately" |
| What follows a share price                          | "Tracker"                                                                                            | "stock" or "share" for what a person holds                                  |
| A price shown before an order                       | "Approximate price", with "The final price is shown before you buy."                                 | "Indicative"                                                                |
| The fee line                                        | "Network cost"                                                                                       | gas, or the network's own currency                                          |
| Bringing a wallet back from its recovery phrase     | "Restore"                                                                                            | "Import"                                                                    |
| Putting USDC into Earn, and taking it out           | "Add to Earn", "Withdraw"                                                                            | "Deposit"                                                                   |
| A price that is missing                             | "Price unavailable right now."                                                                       | "At review", "No live price"                                                |
| What anyone can see                                 | "public", "in public", "publicly"                                                                    | "on chain", "onchain"                                                       |
| Where an address comes from                         | "comes from"                                                                                         | "derived from", "derives"                                                   |
| What locks the wallet                               | "password"                                                                                           | "passphrase"                                                                |
| The network, said only off the main one             | "test network", "main network"                                                                       | the clusters' own names                                                     |

No service for buying USDC is named or pointed to. A number in a sentence (a fee, a minimum, a length) is passed in by the view model from the constant the code enforces, never typed into the string. `tests/unit/copyVariants.test.ts` refuses a replaced name or a retired word in any copy object; the Privacy and Risks pages keep their own, longer wording and are outside that check.

**Behind "Read the risks":** what kind of certificate a tracker is, what its issuer can do to it, where it is not offered, and who the USDC in Earn is lent through. None of that is said in the main path: Earn is titled "Earn", and a tracker's lead already says what a tracker is. The same test scans the main path for those words and leaves out only the keys that sit behind the disclosure.

**Costs:** a cost line states the fee, or states that there is none. It never says the fee is shown somewhere else.

**Counts:** a counted noun goes through `plural(count, noun)`, so nothing reads "1 assets".

**Failures and waiting:** say what happened in the person's terms, what it means for their money ("Nothing was sent", "Nothing was charged", "Nothing was saved") and what to do next. Never how the app asked: no request, service, timeout or status. "Network cost" is the name of a fee, "Solana" is the chain a person must know they are on, and "offline" is said when the device truly has no connection; a privacy note may name who sees what. `tests/unit/copyVariants.test.ts` refuses the blaming words and checks that each failure says what it means for the money.

**May import:** types from `domain/`.

**Must never import:** anything else. Formatting numbers is `domain/format.ts`'s job; choosing which string applies is `presentation/`'s. `application/` never imports this folder.

## Platform variants

The web and the phone say most things the same way. Where they differ, the shared object keeps the web's wording, and the phone's differences sit beside it in a variant named for the platform (`mobileOnboardingCopy` beside `onboardingCopy`). A variant holds only what the phone says differently; the phone reads everything else from the shared object.

When a string differs **only in platform words** ("this browser" and "this phone", "in this browser" and "on this phone", "this device" and "this phone"), it is not written out twice. It becomes a small template in the copy file that takes the word, and each platform's object fills it in:

```ts
const onlyWayBack = (platformNoun: string) =>
  `These words are the only way back into your money if this ${platformNoun} is lost. ...`;

onboardingCopy.phrase.intro; // onlyWayBack("device")
mobileOnboardingCopy.phrase.intro; // onlyWayBack("phone")
```

The template takes the exact words, preposition included, because the web does not use one noun everywhere: it says "in this browser" in one sentence and "this device" in another. Templates stay inside the copy files; an app reads finished strings, never a template. A string that differs in more than its platform words (a different rule, a different screen) is written out whole in the variant.

Rules are tested; prose is not. The web's wording is no longer pinned byte for byte: `tests/unit/copyVariants.test.ts` checks that a phone variant is the web's string with only the platform's words changed, that no retired name or word comes back, that nothing leads with a limitation, that a failure says what it means for the money and never blames a request, and that the Privacy and Risks pages still state each risk. A sentence can be reworded without touching a test, as long as it keeps to those rules.
