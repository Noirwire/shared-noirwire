import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { usdcMintKey } from "./config.js";
import generatedStocks from "./stocks.generated.json" with { type: "json" };

/**
 * One SPL token this app knows how to hold, read and move. Adding a token is
 * a data entry here - nothing else in the app names a token by symbol at the
 * module level.
 *
 * `programId` is not cosmetic. USDC is classic SPL Token; every tokenized
 * stock is Token-2022, because the extensions the issuer relies on only exist
 * there. The two programs derive different associated-token-account addresses
 * for the same owner and mint, so getting it wrong does not error - it reads
 * an address that holds nothing and reports a balance of zero.
 */
export type TokenDefinition = {
  symbol: string;
  name: string;
  mint: PublicKey;
  decimals: number;
  programId: PublicKey;
  /** Amounts offered as one-tap presets in the funding flow. Cash tokens only. */
  presets?: number[];
};

/**
 * The tokens an account can be **funded** in, which is the wallet's cash leg.
 *
 * USDC is Circle's canonical mint, not a self-issued stand-in. The
 * private-payment route only moves mints its own service recognises, so a
 * mint we minted ourselves cannot travel it - and swapping the default for a
 * look-alike would make the privacy flow untestable for the one asset the
 * product is actually funded in. The mint follows the installed network, and
 * is read each time it is asked for, so this list can load before the app
 * installs its platform.
 */
export const SUPPORTED_TOKENS: TokenDefinition[] = [
  {
    symbol: "USDC",
    name: "USD Coin",
    get mint() {
      return usdcMintKey();
    },
    decimals: 6,
    programId: TOKEN_PROGRAM_ID,
    presets: [10, 25, 50, 100],
  },
];

/**
 * A tokenized stock the app knows. `retired` means it once passed the listing
 * gates and no longer does: it can still be held, valued, sold and sent,
 * because someone may own it, but it is not offered to buy.
 */
export type StockDefinition = TokenDefinition & {
  issuer: string;
  kind: "company" | "fund";
  /** Whether a logo for it is stored under public/asset-logos/stocks. */
  logo: boolean;
  retired?: boolean;
};

/**
 * Every tokenized stock the app can hold, all of them Backed's xStocks.
 *
 * Generated, not typed by hand: scripts/generate-catalog.mjs builds
 * stocks.generated.json from the issuer's own list and keeps a token only when
 * Jupiter's index agrees on the mint, the mint account carries nothing the
 * app's checks do not account for, and a real order for it can be quoted both
 * ways. The file is committed data; nothing fetches the list at runtime.
 *
 * These are mainnet mints and have no devnet counterpart, which is not a
 * configuration gap. The router that prices them aggregates real liquidity
 * pools and none of those exist on devnet, so there is nothing to point a
 * devnet address at. On devnet these read as a zero balance and the trade
 * surface says trading is unavailable.
 *
 * What the holder is buying is a tracker certificate, not a share: no voting
 * rights, and the issuer holds a permanent delegate and a freeze authority on
 * every one of these mints, so it can move or burn a balance without the
 * holder's signature. That is disclosed in the trade flow, not buried here.
 *
 * Amounts held, quoted and signed are raw token units over the mint's
 * decimals. Each mint also carries a display multiplier, which the issuer
 * raises to reinvest a dividend or apply a split, and the issuer's rule is
 * that the balance shown is the raw amount times it. The app applies it only
 * where an amount is shown or typed (see `shownUnits` in src/application/catalog.ts).
 */
const STOCKS: StockDefinition[] = generatedStocks.map((entry) => ({
  symbol: entry.symbol,
  name: entry.name,
  mint: new PublicKey(entry.mint),
  decimals: entry.decimals,
  programId: TOKEN_2022_PROGRAM_ID,
  issuer: entry.issuer,
  kind: entry.kind === "fund" ? "fund" : "company",
  logo: entry.logo,
  retired: "retired" in entry && entry.retired === true,
}));

/** The stocks offered to buy, deepest market first. */
export const TRADABLE_STOCKS = STOCKS.filter((stock) => !stock.retired);

const STOCK_BY_SYMBOL = new Map(STOCKS.map((stock) => [stock.symbol, stock]));

/** Every token the app can read an on-chain balance for: the cash leg plus every stock. */
const TOKEN_BY_SYMBOL = new Map<string, TokenDefinition>([
  ...SUPPORTED_TOKENS.map((token) => [token.symbol, token] as const),
  ...STOCK_BY_SYMBOL,
]);

export function tokenBySymbol(symbol: string): TokenDefinition | undefined {
  return TOKEN_BY_SYMBOL.get(symbol);
}

/** A stock that can be held, listed or retired. Buying checks `retired` on top. */
export function stockBySymbol(symbol: string): StockDefinition | undefined {
  return STOCK_BY_SYMBOL.get(symbol);
}

/** Listed and retired alike: a held stock keeps its price and its history. */
export const ALL_STOCKS: readonly StockDefinition[] = STOCKS;

/** The cash token a trade is denominated in. Buying spends it, selling returns it. */
export const QUOTE_TOKEN = SUPPORTED_TOKENS[0];
