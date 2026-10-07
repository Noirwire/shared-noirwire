/**
 * Everything usage analytics is allowed to say, as one closed list. The
 * browser builds events from it and the server route refuses anything that
 * is not on it, so a bug - or a script that should not be on the page - has
 * no free-form field to put an address, a name or an amount into.
 *
 * Trades carry no asset and no size, before or after signing. Every trade is
 * public on chain, where what was traded and how much can be read exactly;
 * repeating it here would only add a way to tie a visitor to a transaction.
 * No event names a stock at all: what someone watches or holds is part of
 * the wallet, and the wallet is stored encrypted for that reason.
 *
 * What a visitor has done so far is read from a snapshot sent at unlock -
 * how old the wallet is, whether it is funded, whether it holds investments -
 * so who converted can be answered without any event marking the moment a
 * transaction landed.
 */

const oneOf =
  <T extends string>(...allowed: readonly T[]) =>
  (value: unknown): value is T =>
    typeof value === "string" && (allowed as readonly string[]).includes(value);

const smallCount = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10;

const AGE_BANDS = ["new", "1-7d", "8-30d", "31-90d", "90d+"] as const;
const COUNT_BANDS = ["0", "1", "2+"] as const;
const TRADE_BANDS = ["0", "1", "2-5", "6+"] as const;

/**
 * Where a visit can be said to have come from. Anything else is "other": a
 * referrer or a campaign tag is text someone else chose, and a link made for
 * one person would otherwise mark that person.
 */
const SOURCES = [
  "noirwire",
  "x",
  "reddit",
  "telegram",
  "discord",
  "github",
  "youtube",
  "google",
  "producthunt",
  "newsletter",
  "friend",
  "other",
] as const;
const MEDIUMS = ["social", "email", "referral", "paid", "organic", "other"] as const;
/** A new campaign is counted under its own name once that name is added here. */
const CAMPAIGNS = ["launch", "founding100", "waitlist", "pies", "earn", "other"] as const;
const SOURCE_BY_HOST: [RegExp, (typeof SOURCES)[number]][] = [
  [/(^|\.)noirwire\.com$/, "noirwire"],
  [/(^|\.)(x\.com|twitter\.com|t\.co)$/, "x"],
  [/(^|\.)reddit\.com$/, "reddit"],
  [/(^|\.)(t\.me|telegram\.org)$/, "telegram"],
  [/(^|\.)(discord\.com|discord\.gg)$/, "discord"],
  [/(^|\.)github\.com$/, "github"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"],
  [/(^|\.)google\.[a-z.]+$/, "google"],
  [/(^|\.)producthunt\.com$/, "producthunt"],
];

const FAILURE_REASONS = [
  "no_sol",
  "no_funds",
  "expired",
  "price_moved",
  "rate_limited",
  "locked",
  "network",
  "other",
] as const;

const DIALOGS = [
  "buy",
  "sell",
  "fund",
  "send",
  "receive",
  "invest",
  "rebalance",
  "new_account",
  "edit_mix",
  "account_settings",
  "earn_deposit",
  "earn_withdraw",
] as const;
export type DialogName = (typeof DIALOGS)[number];

const FIELDS = {
  kind: oneOf("portfolio", "pie"),
  side: oneOf("buy", "sell"),
  mode: oneOf("invest", "rebalance"),
  orders: smallCount,
  placed: smallCount,
  stocks: smallCount,
  step: oneOf("welcome", "phrase", "confirm", "import", "password"),
  found: smallCount,
  age: oneOf(...AGE_BANDS),
  accounts: oneOf(...COUNT_BANDS),
  pies: oneOf(...COUNT_BANDS),
  trades: oneOf(...TRADE_BANDS),
  funded: oneOf("yes", "no"),
  invested: oneOf("yes", "no"),
  has_funded: oneOf("yes", "no"),
  has_traded: oneOf("yes", "no"),
  by: oneOf("manual", "idle"),
  dialog: oneOf(...DIALOGS),
  reason: oneOf(...FAILURE_REASONS),
  route: oneOf("private", "direct"),
  action: oneOf("deposit", "withdraw"),
  category: oneOf("all", "index", "companies", "watchlist"),
  range: oneOf("1D", "1W", "1M"),
  what: oneOf("funding", "portfolio"),
  kind_of: oneOf("error", "rejection"),
  stage: oneOf("read", "unreadable", "too_large", "write", "conflict", "save"),
} satisfies Record<string, (value: unknown) => boolean>;

type Field = keyof typeof FIELDS;

/** What a visitor does before anything is signed. Counted per visitor. */
const BEFORE_SIGNING = {
  // Getting a wallet.
  onboarding_step: ["step"],
  wallet_created: [],
  wallet_imported: ["found"],
  // Coming back, and the state the wallet is in when it does.
  wallet_unlocked: [
    "age",
    "accounts",
    "pies",
    "trades",
    "funded",
    "invested",
    "has_funded",
    "has_traded",
  ],
  unlock_failed: [],
  wallet_locked: ["by"],
  wallet_reset: [],
  password_changed: [],
  // What was reached for.
  dialog_opened: ["dialog"],
  address_copied: ["what"],
  market_searched: [],
  market_search_empty: [],
  market_category: ["category"],
  chart_range: ["range"],
  watchlist_toggled: [],
  // Organising.
  account_created: ["kind"],
  account_archived: [],
  account_restored: [],
  pie_mix_edited: ["stocks"],
  // Up to the point of signing.
  trade_quoted: ["side"],
  trade_quote_failed: ["side", "reason"],
  trade_reviewed: ["side"],
  pie_orders_reviewed: ["mode", "side", "orders"],
  send_reviewed: [],
  app_error: ["kind_of"],
} as const satisfies Record<string, readonly Field[]>;

/**
 * What coincides with a transaction on chain. These are counted in total
 * only: reported late, at a random moment, and with nothing saying which
 * visitor they came from, so a count cannot be lined up with a transaction.
 */
const ON_CHAIN = {
  trade_placed: ["side"],
  pie_orders_finished: ["mode", "side", "orders", "placed"],
  funded_directly: [],
  private_funding_started: [],
  private_funding_arrived: [],
  private_funding_still_pending: [],
  sent: [],
  earn_deposit: [],
  earn_withdraw: [],
  deposit_detected: [],
  // A failure after something was submitted may still have landed, so it is
  // counted the same way as a success.
  trade_failed: ["side", "reason"],
  funding_failed: ["route", "reason"],
  send_failed: ["reason"],
  earn_failed: ["action", "reason"],
  // The labels' mirror is written by a transaction too, so a sync is counted
  // as one: whether it changed anything, and where one that failed stopped.
  profile_synced: [],
  profile_sync_failed: ["stage"],
} as const satisfies Record<string, readonly Field[]>;

const EVENTS = { ...BEFORE_SIGNING, ...ON_CHAIN };

export type EventName = keyof typeof EVENTS;
export type EventData = Partial<Record<Field, string | number>>;

/** Each field's values, as the list above allows them: a string from its closed union, or a small count. */
export type UsageFields = {
  [K in Field]: (typeof FIELDS)[K] extends (value: unknown) => value is infer T ? T : number;
};

/** An event a platform's `track` may be asked to count. */
export type UsageEvent = EventName;

/** The fields `event` carries. */
export type UsageProps<E extends UsageEvent> = Pick<UsageFields, (typeof EVENTS)[E][number]>;

/** The props argument: required when the event has fields, absent when it has none. */
export type UsageArgs<E extends UsageEvent> = [(typeof EVENTS)[E][number]] extends [never]
  ? []
  : [props: UsageProps<E>];

export function isOnChain(name: EventName) {
  return Object.hasOwn(ON_CHAIN, name);
}

/** Neither a portfolio's id nor the stock being viewed is ever part of a reported screen. */
const SCREEN = /^\/(portfolio|markets(\/:symbol)?|portfolios\/:id|earn|activity|settings)?$/;
const DISPLAY = /^\d{3,5}x\d{3,5}$/;
/**
 * The path as it is reported: without the portfolio's id or the stock's
 * symbol, so visits are counted per screen and never per holding or interest.
 */
export function reportedPath(pathname: string) {
  return pathname
    .replace(/^\/portfolios\/[^/]+/, "/portfolios/:id")
    .replace(/^\/markets\/[^/]+/, "/markets/:symbol");
}

/** How old a wallet is, as a band. Retention is read from this, not from a lasting visitor id. */
export function ageBand(createdAt: number, now: number): (typeof AGE_BANDS)[number] {
  const days = (now - createdAt) / 86_400_000;
  if (days < 1) return "new";
  if (days <= 7) return "1-7d";
  if (days <= 30) return "8-30d";
  if (days <= 90) return "31-90d";
  return "90d+";
}

/** An error message as one of a few fixed reasons. The message itself is never sent. */
export function failureReason(message: string): (typeof FAILURE_REASONS)[number] {
  if (/locked/i.test(message)) return "locked";
  if (/expired/i.test(message)) return "expired";
  if (/\bSOL\b/.test(message)) return "no_sol";
  if (/less than quoted|more than quoted|exceeds your available/i.test(message))
    return "price_moved";
  if (/429|rate limit/i.test(message)) return "rate_limited";
  if (/insufficient|more than this|more than your|not enough/i.test(message)) return "no_funds";
  if (/fetch|network|timed? ?out/i.test(message)) return "network";
  return "other";
}

/** How many of something, as a band. An exact count of trades or accounts would help single out a wallet. */
export function countBand(count: number): (typeof COUNT_BANDS)[number] {
  return count === 0 ? "0" : count === 1 ? "1" : "2+";
}

export function tradeBand(count: number): (typeof TRADE_BANDS)[number] {
  return count === 0 ? "0" : count === 1 ? "1" : count <= 5 ? "2-5" : "6+";
}

/**
 * Where a first visit came from, reduced to names from the approved lists: a
 * source, a medium and a campaign.
 */
type Arrival = {
  source?: (typeof SOURCES)[number];
  medium?: (typeof MEDIUMS)[number];
  campaign?: (typeof CAMPAIGNS)[number];
};

const listed = <T extends string>(list: readonly T[], value: string | null): T | undefined =>
  value === null
    ? undefined
    : (list.find((entry) => entry === value.toLowerCase()) ?? ("other" as T));

export function arrivalFrom(referrer: string, search: string, ownHost: string): Arrival {
  const params = new URLSearchParams(search);
  const arrival: Arrival = {};
  let host = "";
  try {
    host = referrer ? new URL(referrer).hostname.toLowerCase() : "";
  } catch {
    /* a referrer that is not a URL says nothing */
  }
  const tagged = listed(SOURCES, params.get("utm_source"));
  if (tagged) arrival.source = tagged;
  else if (host && host !== ownHost) {
    arrival.source = SOURCE_BY_HOST.find(([pattern]) => pattern.test(host))?.[1] ?? "other";
  }
  const medium = listed(MEDIUMS, params.get("utm_medium"));
  if (medium) arrival.medium = medium;
  const campaign = listed(CAMPAIGNS, params.get("utm_campaign"));
  if (campaign) arrival.campaign = campaign;
  return arrival;
}

export type CleanEvent = {
  path: string;
  display?: string;
  arrival?: Arrival;
  name?: EventName;
  data?: EventData;
};

function cleanArrival(input: unknown): Arrival | null {
  if (typeof input !== "object" || input === null) return null;
  const { source, medium, campaign } = input as Record<string, unknown>;
  const kept: Arrival = {};
  if (oneOf(...SOURCES)(source)) kept.source = source as Arrival["source"];
  if (oneOf(...MEDIUMS)(medium)) kept.medium = medium as Arrival["medium"];
  if (oneOf(...CAMPAIGNS)(campaign)) kept.campaign = campaign as Arrival["campaign"];
  return Object.keys(kept).length ? kept : null;
}

function isEventName(value: unknown): value is EventName {
  return typeof value === "string" && Object.hasOwn(EVENTS, value);
}

/**
 * What the server will forward, rebuilt field by field from what it was
 * sent, or null if any part is off the list. Nothing is passed through.
 */
export function cleanEvent(input: unknown): CleanEvent | null {
  if (typeof input !== "object" || input === null) return null;
  const { path, display, arrival, name, data, ...rest } = input as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return null;
  if (typeof path !== "string" || !SCREEN.test(path)) return null;
  const clean: CleanEvent = { path };
  if (typeof display === "string" && DISPLAY.test(display)) clean.display = display;
  if (name === undefined) {
    if (data !== undefined) return null;
    const from = cleanArrival(arrival);
    return from ? { ...clean, arrival: from } : clean;
  }
  if (arrival !== undefined) return null;
  if (!isEventName(name)) return null;

  const fields: readonly Field[] = EVENTS[name];
  const given = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  if (Object.keys(given).some((key) => !fields.includes(key as Field))) return null;
  const kept: EventData = {};
  for (const field of fields) {
    const value = given[field];
    if (!FIELDS[field](value)) return null;
    kept[field] = value as string | number;
  }
  return { ...clean, name, ...(fields.length ? { data: kept } : {}) };
}
