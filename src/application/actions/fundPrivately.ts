import { SETTLEMENT_DELAY_MS } from "../../domain/privateTransfer.js";
import type { Session, Signer, StillUnlocked } from "../ports.js";
import { FUNDING } from "../pendingActions.js";
import { refused, refusedFor, type Unsuccessful } from "../result.js";
import {
  activePortfolio,
  logged,
  mapPortfolio,
  othersOf,
  positive,
  setRealHolding,
  withFundingBalance,
} from "../walletRecord.js";
import {
  counted,
  ended,
  failedOf,
  openSession,
  unknownOf,
  type ActionDeps,
  type Refresh,
} from "./common.js";

/** How often the recipient's balance is re-read while a private transfer settles. Each read is a paid request. */
const ARRIVAL_POLL_MS = 3_000;
/** Less than the smallest unit of any token moved this way: what two amounts added as decimals may be off by. */
const ARRIVAL_TOLERANCE = 1e-7;

/**
 * How long to watch for a queued private transfer before calling it pending.
 * Generously past the settlement window the transfer was scheduled in, so a
 * slow crank reads as slow rather than as failed.
 */
const SETTLEMENT_TIMEOUT_MS = SETTLEMENT_DELAY_MS.max + 45_000;

/** A registered SPL token, as the private route moves it. Native SOL cannot travel it. */
export type PrivateToken<K extends Signer> = {
  symbol: string;
  balance(address: string): Promise<number>;
  /**
   * Hands the transfer to the private-payment service, signed by `sender`.
   * Resolves once the service accepted it: the money arrives later, out of
   * its queue. No address in `keepOut` may be named in what is signed.
   */
  sendPrivately(input: {
    sender: K;
    to: string;
    amount: number;
    keepOut: string[];
    stillUnlocked: StillUnlocked;
  }): Promise<{ signature: string; feeTokens: number }>;
  /** Asks the queue to settle what it holds for this token. */
  nudgeSettlement(): Promise<void>;
};

export type FundPrivatelyDeps<K extends Signer> = ActionDeps<K> & {
  privateToken(symbol: string): PrivateToken<K> | undefined;
  refresh: Pick<Refresh, "funding" | "portfolioAsset">;
};

/** An accepted private transfer: what it cost, and the balance its arrival is watched from. */
export type PrivateFundResult =
  Unsuccessful | { kind: "submitted"; signature: string; feeTokens: number; balanceBefore: number };

/** One of this wallet's own places a private move runs between: a portfolio by its id, or `FUNDING`. */
type Place<K extends Signer> = {
  address: string;
  /** Null for the funding wallet, which the screen names itself. */
  label: string | null;
  signer: K | null;
};

function placeOf<K extends Signer>(session: Session<K>, id: string): Place<K> | undefined {
  if (id === FUNDING) {
    return {
      address: session.wallet.funding.address,
      label: null,
      signer: session.fundingSigner(),
    };
  }
  const portfolio = activePortfolio(session.wallet, id);
  return (
    portfolio && {
      address: portfolio.address,
      label: portfolio.label,
      signer: session.portfolioSigner(portfolio),
    }
  );
}

/**
 * Moves a token between two of this wallet's own places, `from` and `to`,
 * each a portfolio's id or `FUNDING`, without a direct, public transfer
 * between them ever being written to the chain.
 *
 * The transfer settles out of MagicBlock's queue rather than going straight
 * across, so the two addresses are not joined by a transaction anyone can
 * look up; and it therefore does not arrive when this resolves. The answer
 * is `submitted`, and the caller watches the balance (`awaitPrivateArrival`),
 * because reporting "funds arrived" off the back of an accepted enqueue
 * would claim an arrival nobody has seen.
 */
export async function fundPrivately<K extends Signer>(
  deps: FundPrivatelyDeps<K>,
  input: { from: string; to: string; amount: number; symbol: string },
): Promise<PrivateFundResult> {
  const { from, to, amount, symbol } = input;

  // Plan.
  const session = openSession(deps.session);
  if ("kind" in session) return session;
  const source = placeOf(session, from);
  const target = placeOf(session, to);
  if (!source || !target || from === to || !positive(amount)) {
    return refused("activePortfolioAmount");
  }
  const token = deps.privateToken(symbol);
  if (!token) return refusedFor("notPrivate", symbol);

  // Guard: the recipient is the key the phrase derives, never the stored
  // string: money must only ever go to an account this wallet can sign for.
  const sender = source.signer;
  if (!sender || !target.signer) return refused(session.refusal());
  const recipient = target.signer.publicKey.toBase58();

  // Reserve against the place that pays before it signs. An accepted transfer
  // keeps it until the transaction that enqueued it is seen on chain: money
  // arriving later is the queue's doing, not proof of that. A portfolio's
  // own list shows the money leaving once that transaction has landed; the
  // funding wallet's list reads it off the arrival instead.
  const reservation = await deps.pending.reserve(
    from,
    source.address,
    deps.words.privateTransfer(token.symbol, amount, target.label),
    from === FUNDING
      ? undefined
      : {
          kind: "send",
          symbol: token.symbol,
          amount,
          usd: amount * deps.prices.price(token.symbol),
          counterparty: recipient,
        },
  );
  if (!reservation) return refused("actionPending");
  const refreshSource = () =>
    (from === FUNDING
      ? deps.refresh.funding(source.address, token.symbol)
      : deps.refresh.portfolioAsset(from, source.address, token.symbol)
    ).catch(() => undefined);
  let outcome: unknown;
  let accepted: { signature: string; feeTokens: number; balanceBefore: number };

  try {
    const balanceBefore = await token.balance(recipient);

    // Sign and submit.
    const sent = await token.sendPrivately({
      sender,
      to: recipient,
      amount,
      // No other place of this wallet, archived portfolios included, may be
      // named in the transaction the sender signs.
      keepOut: othersOf(session.wallet, source),
      stillUnlocked: session.live,
    });
    accepted = { ...sent, balanceBefore };
  } catch (error) {
    outcome = error;
    const unknown = unknownOf(error);
    if (unknown) {
      void refreshSource();
      return unknown;
    }
    return counted(
      deps,
      "funding_failed",
      { route: "private" },
      failedOf("privateNotStarted", error),
    );
  } finally {
    if (outcome !== undefined) await ended(reservation, outcome);
  }

  // The service accepted the transfer. From here nothing may report it as
  // not started: the reservation is kept under its signature until the chain
  // shows it, and a record that cannot be written leaves it reserved.
  await reservation.submitted(accepted.signature).catch(() => undefined);
  void refreshSource();
  deps.track("private_funding_started");
  return { kind: "submitted", ...accepted };
}

/**
 * Settles a queued private transfer by watching it land: polls the
 * recipient's real on-chain balance until all of `amount` is there. The
 * service delivers a transfer in several parts, seconds apart, so the first
 * rise in the balance is only the first part: calling that the arrival
 * would report a third of the money as the whole of it.
 *
 * Returns the new balance once everything has arrived. When the settlement
 * window ends with only some of it there, returns the balance as it stands,
 * and what did arrive is what is recorded. Null when nothing arrived in the
 * window, which is a "still pending", not a failure, and the screen says so.
 */
export async function awaitPrivateArrival<K extends Signer>(
  deps: Pick<FundPrivatelyDeps<K>, "store" | "prices" | "track" | "privateToken">,
  input: { from: string; to: string; symbol: string; balanceBefore: number; amount: number },
): Promise<number | null> {
  const { from, to, balanceBefore } = input;
  const { prices } = deps;
  const current = deps.store.snapshot();
  const address =
    to === FUNDING
      ? current?.funding.address
      : current?.portfolios.find((entry) => entry.id === to)?.address;
  const token = deps.privateToken(input.symbol);
  if (!address || !token) return null;

  const watchedFrom = Date.now();
  const deadline = watchedFrom + SETTLEMENT_TIMEOUT_MS;
  const complete = balanceBefore + input.amount - ARRIVAL_TOLERANCE;
  let balance = balanceBefore;
  let nudged = false;

  while (Date.now() < deadline && balance < complete) {
    await new Promise((resolve) => setTimeout(resolve, ARRIVAL_POLL_MS));
    balance = await token.balance(address).catch(() => balance);

    // One crank nudge partway through, rather than hammering the queue.
    if (!nudged && balance < complete && Date.now() > deadline - SETTLEMENT_TIMEOUT_MS / 2) {
      nudged = true;
      void token.nudgeSettlement();
    }
  }

  if (!(balance > balanceBefore)) {
    deps.track("private_funding_still_pending");
    return null;
  }
  const entry = (portfolioId: string, kind: "fund" | "deposit", arrived: number) => ({
    portfolioId,
    kind,
    symbol: token.symbol,
    amount: arrived,
    usd: arrived * prices.price(token.symbol),
  });
  deps.store.update((wallet) => {
    if (to !== FUNDING) {
      // Only money from the funding wallet is a `fund`: its own list shows that as money out.
      return logged(
        mapPortfolio(wallet, to, (held) => setRealHolding(prices, held, token.symbol, balance)),
        entry(to, from === FUNDING ? "fund" : "deposit", balance - balanceBefore),
        prices,
      );
    }
    // A balance refresh may have written some of the parts into Activity as
    // they landed. What it stored says nothing of that, since it stores
    // without writing while an action is pending: only its entries do.
    const written = wallet.activity
      .filter(
        (seen) =>
          seen.portfolioId === FUNDING &&
          seen.kind === "deposit" &&
          seen.symbol === token.symbol &&
          seen.at >= watchedFrom,
      )
      .reduce((sum, seen) => sum + seen.amount, 0);
    const unrecorded = balance - balanceBefore - written;
    const read = withFundingBalance(wallet, token.symbol, balance);
    return unrecorded > ARRIVAL_TOLERANCE
      ? logged(read, entry(FUNDING, "deposit", unrecorded), prices)
      : read;
  });
  deps.track("private_funding_arrived");
  return balance;
}
