# domain

Pure rules and types: what a wallet, a portfolio, a holding, an order or a pie is, what a private transfer costs, which destinations are safe, and how the product formats money. Functions here take values and return values.

`importResolution.ts` is what a recovery phrase was found to hold on chain under each derivation scheme: the chain client fills it in, and the import screens' view models read it.

`usageEvents.ts` is the closed list of everything usage analytics may say, with the server's check of an event against it; the platform's `track` takes only what it allows.

**Belongs here:** types, validation, arithmetic, formatting rules (`format.ts`).

**May import:** nothing of ours. No other folder in this package, no platform seam, no library that talks to a network.
