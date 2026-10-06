import { SETTLEMENT_DELAY_MS } from "../../domain/privateTransfer.js";
import type { Signer, StillUnlocked } from "../ports.js";
import { FUNDING } from "../pendingActions.js";
import { refused, refusedFor, type Unsuccessful } from "../result.js";
import {
  activePortfolio,
  logged,
  mapPortfolio,
  positive,
  setRealHolding,
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
  refresh: Pick<Refresh, "funding">;
};

/** An accepted private transfer: what it cost, and the balance its arrival is watched from. */
export type PrivateFundResult =
  Unsuccessful | { kind: "submitted"; signature: string; feeTokens: number; balanceBefore: number };

/**
 * Funds a portfolio the way the product actually promises: the funding
 * wallet's USDC reaches it without a direct, public funding-wallet ->
 * portfolio transfer ever being written to the chain.
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
  input: { portfolioId: string; amount: number; symbol: string },
): Promise<PrivateFundResult> {
  const { portfolioId: id, amount, symbol } = input;

  // Plan.
  const session = openSession(deps.session);
  if ("kind" in session) return session;
  const portfolio = activePortfolio(session.wallet, id);
  if (!portfolio || !positive(amount)) return refused("activePortfolioAmount");
  const token = deps.privateToken(symbol);
  if (!token) return refusedFor("notPrivate", symbol);

  // Guard: the recipient is the key the phrase derives, never the stored
  // string: money must only ever go to an account this wallet can sign for.
  const funder = session.fundingSigner();
  const owner = session.portfolioSigner(portfolio);
  if (!funder || !owner) return refused(session.refusal());

  // Reserve against the funding wallet before it signs. An accepted transfer
  // keeps it until the transaction that enqueued it is seen on chain: money
  // arriving later is the queue's doing, not proof of that.
  const reservation = await deps.pending.reserve(
    FUNDING,
    session.wallet.funding.address,
    deps.words.privateTransfer(token.symbol, amount, portfolio.label),
  );
  if (!reservation) return refused("actionPending");
  let outcome: unknown;
  let accepted: { signature: string; feeTokens: number; balanceBefore: number };

  try {
    const recipient = owner.publicKey.toBase58();
    const balanceBefore = await token.balance(recipient);

    // Sign and submit.
    const sent = await token.sendPrivately({
      sender: funder,
      to: recipient,
      amount,
      // No portfolio of this wallet, archived ones included, may be named
      // in the transaction the funding wallet signs.
      keepOut: session.wallet.portfolios.map((entry) => entry.address),
      stillUnlocked: session.live,
    });
    accepted = { ...sent, balanceBefore };
  } catch (error) {
    outcome = error;
    const unknown = unknownOf(error);
    if (unknown) {
      void deps.refresh
        .funding(session.wallet.funding.address, token.symbol)
        .catch(() => undefined);
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
  void deps.refresh.funding(session.wallet.funding.address, token.symbol).catch(() => undefined);
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
  input: { portfolioId: string; symbol: string; balanceBefore: number; amount: number },
): Promise<number | null> {
  const { portfolioId: id, balanceBefore } = input;
  const { prices } = deps;
  const current = deps.store.snapshot();
  const portfolio = current?.portfolios.find((entry) => entry.id === id);
  const token = deps.privateToken(input.symbol);
  if (!current || !portfolio || !token) return null;

  const deadline = Date.now() + SETTLEMENT_TIMEOUT_MS;
  const complete = balanceBefore + input.amount - ARRIVAL_TOLERANCE;
  let balance = balanceBefore;
  let nudged = false;

  while (Date.now() < deadline && balance < complete) {
    await new Promise((resolve) => setTimeout(resolve, ARRIVAL_POLL_MS));
    balance = await token.balance(portfolio.address).catch(() => balance);

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
  const arrived = balance - balanceBefore;
  deps.store.update((wallet) =>
    logged(
      mapPortfolio(wallet, id, (entry) => setRealHolding(prices, entry, token.symbol, balance)),
      {
        portfolioId: id,
        kind: "fund",
        symbol: token.symbol,
        amount: arrived,
        usd: arrived * prices.price(token.symbol),
      },
      prices,
    ),
  );
  deps.track("private_funding_arrived");
  return balance;
}
