# copy

Every string a person reads, in one place, so both apps say the same thing in the same words.

**Belongs here:** constants, and small functions that put already-formatted values into a sentence.

**Style:** say "portfolio", "funding wallet" and "trackers". Say plainly what happened and what to do next. No em dashes; three periods for an ellipsis. Never name the network's own currency where the cost is paid in USDC.

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

The web's wording is held byte for byte by `tests/unit/copyVariants.test.ts`, so moving a string into a template cannot change what the web says.
