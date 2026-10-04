# domain

Pure rules and types: what a wallet, a portfolio, a holding, an order or a pie is, what a private transfer costs, which destinations are safe, and how the product formats money. Functions here take values and return values.

`importResolution.ts` is what a recovery phrase was found to hold on chain under each derivation scheme: the chain client fills it in, and the import screens' view models read it.

`usageEvents.ts` is the closed list of everything usage analytics may say, with the server's check of an event against it; the platform's `track` takes only what it allows.

`freshness.ts` is the one rule for how current a read is: each read keeps when it last succeeded and whether its latest attempt failed (`recordRead`), and it may be out of date the moment an attempt fails or once it is older than `STALE_AFTER_MS`, two refresh intervals.

`amount.ts` reads a typed amount one way on every keypad: a period or a comma is the decimal separator, and text that could be read two ways ("1,234", "1,234.50") is refused, not guessed.

`importResolution.ts` also holds the three numbers that keep a restore whole: how many unused addresses end an import's scan, the larger gap of the scan a person asks for, and how many never-used portfolios a wallet may have in a row, which is kept under the first.

**Belongs here:** types, validation, arithmetic, formatting rules (`format.ts`).

**May import:** nothing of ours. No other folder in this package, no platform seam, no library that talks to a network.
