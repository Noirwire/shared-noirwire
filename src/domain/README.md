# domain

Pure rules and types: what a wallet, a portfolio, a holding, an order or a pie is, what a private transfer costs, which destinations are safe, and how the product formats money. Functions here take values and return values.

`importResolution.ts` is what a recovery phrase was found to hold on chain under each derivation scheme: the chain client fills it in, and the import screens' view models read it.

`usageEvents.ts` is the closed list of everything usage analytics may say, with the server's check of an event against it; the platform's `track` takes only what it allows.

`freshness.ts` is the one rule for how current a read is: each read keeps when it last succeeded and whether its latest attempt failed (`recordRead`), and it may be out of date the moment an attempt fails or once it is older than `STALE_AFTER_MS`, two refresh intervals.

`amount.ts` reads a typed amount one way on every keypad: a period or a comma is the decimal separator, and text that could be read two ways ("1,234", "1,234.50") is refused, not guessed.

`importResolution.ts` also holds the three numbers that keep a restore whole: how many unused addresses end an import's scan, the larger gap of the scan a person asks for, and how many never-used portfolios a wallet may have in a row, which is kept under the first.

`profile.ts` is the wallet's own labels (portfolio names, marks, pies, archived state, the watchlist) as the record that mirrors them off the device: its envelope, and the merge of the device's labels with the mirror, field by field, by revision and never by a clock. The device wins a field it changed; a field or a key this version does not know passes through untouched.

`walletBridge/` is what the trading terminal and this wallet say to each other across a window boundary: `protocol.ts` holds the message types and their strict parsers (exact keys, capped strings, canonical base64, no dependency), `request.ts` what a request to sign turned out to be once read, and `signIn.ts` the one challenge text the wallet signs for the trading network, with the clock handed in.

`orderbook/` is the order book's own rules, named "orderbook" because "trade" here is the swap. A market is plain data (`OrderbookMarket`: lot, tick, the two minimums in the program's units, margins, fee, the oldest mark it accepts), read by an app and handed in. Every amount is a decimal string read into a fixed-point bigint (`decimal.ts`), never a floating-point number. `validation.ts` checks an order as the program does, minimum notional included; `cost.ts` works margin, what remains, the most an order can take and the liquidation estimate from one margin at the chosen leverage, never below the initial margin at the mark, with fees rounded up to a quote atom as the program charges them, and an open position goes through the same liquidation function; `units.ts` converts to lots and quote atoms per lot; `ownFills.ts` finds a trader's fills on the public tape from receipts, with the program's receipt function passed in; `format.ts` writes its numbers from their digits. Whether a mark can still be ordered against is `markFreshness` in `freshness.ts`, against the market's own limit.

`rewards.ts` is what rewards are made of: how a member stands, the text a member signs for each request, and the short line of trades waiting to be claimed that the wallet's record keeps.

**Belongs here:** types, validation, arithmetic, formatting rules (`format.ts`).

**May import:** nothing of ours. No other folder in this package, no platform seam, no library that talks to a network.
