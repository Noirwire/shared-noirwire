/**
 * Everything usage analytics is allowed to say, as one closed list. Each
 * property is a string from a closed union or a number, so there is no
 * free-form field an address, a name or an amount could be put into.
 *
 * Trades carry no asset and no size, and no event names a stock: what
 * someone holds is part of the wallet, which is stored encrypted for that
 * reason.
 */
type YesNo = "yes" | "no";

export type UsageFields = {
  kind: "portfolio" | "pie";
  side: "buy" | "sell";
  mode: "invest" | "rebalance";
  /** A small count, 0 to 10. */
  orders: number;
  placed: number;
  stocks: number;
  found: number;
  step: "welcome" | "phrase" | "confirm" | "import" | "password";
  age: "new" | "1-7d" | "8-30d" | "31-90d" | "90d+";
  accounts: "0" | "1" | "2+";
  pies: "0" | "1" | "2+";
  trades: "0" | "1" | "2-5" | "6+";
  funded: YesNo;
  invested: YesNo;
  has_funded: YesNo;
  has_traded: YesNo;
  by: "manual" | "idle";
  dialog:
    | "buy"
    | "sell"
    | "fund"
    | "send"
    | "receive"
    | "invest"
    | "rebalance"
    | "new_account"
    | "edit_mix"
    | "account_settings"
    | "earn_deposit"
    | "earn_withdraw";
  reason:
    | "no_sol"
    | "no_funds"
    | "expired"
    | "price_moved"
    | "rate_limited"
    | "locked"
    | "network"
    | "other";
  route: "private" | "direct";
  action: "deposit" | "withdraw";
  category: "all" | "index" | "companies" | "watchlist";
  range: "1D" | "1W" | "1M";
  what: "funding" | "portfolio";
  kind_of: "error" | "rejection";
};

/** Each event and the fields it carries. */
type UsageEventFields = {
  onboarding_step: "step";
  wallet_created: never;
  wallet_imported: "found";
  wallet_unlocked:
    "age" | "accounts" | "pies" | "trades" | "funded" | "invested" | "has_funded" | "has_traded";
  unlock_failed: never;
  wallet_locked: "by";
  wallet_reset: never;
  password_changed: never;
  dialog_opened: "dialog";
  address_copied: "what";
  market_searched: never;
  market_search_empty: never;
  market_category: "category";
  chart_range: "range";
  watchlist_toggled: never;
  account_created: "kind";
  account_archived: never;
  account_restored: never;
  pie_mix_edited: "stocks";
  trade_quoted: "side";
  trade_quote_failed: "side" | "reason";
  trade_reviewed: "side";
  pie_orders_reviewed: "mode" | "side" | "orders";
  send_reviewed: never;
  app_error: "kind_of";
  trade_placed: "side";
  pie_orders_finished: "mode" | "side" | "orders" | "placed";
  funded_directly: never;
  private_funding_started: never;
  private_funding_arrived: never;
  private_funding_still_pending: never;
  sent: never;
  earn_deposit: never;
  earn_withdraw: never;
  deposit_detected: never;
  trade_failed: "side" | "reason";
  funding_failed: "route" | "reason";
  send_failed: "reason";
  earn_failed: "action" | "reason";
};

export type UsageEvent = keyof UsageEventFields;

export type UsageProps<E extends UsageEvent> = Pick<UsageFields, UsageEventFields[E]>;

/** The props argument: required when the event has fields, absent when it has none. */
export type UsageArgs<E extends UsageEvent> = [UsageEventFields[E]] extends [never]
  ? []
  : [props: UsageProps<E>];
