import type { NetworkCost } from "../../domain/networkCost.js";
import type { Unsendable } from "../../domain/recipients.js";
import type { Portfolio, Wallet } from "../../domain/wallet.js";
import { planOwnSolCost, planSendCost, type CostAgreed, type CostChain } from "../networkCost.js";
import { FUNDING } from "../pendingActions.js";
import type { RelayerQuote, Signer, StillUnlocked } from "../ports.js";
import { readWithRetries } from "../retries.js";
import { refused, refusedFor, type Attempt } from "../result.js";
import {
  fundingBalance,
  logged,
  mapPortfolio,
  othersOf,
  positive,
  setRealHolding,
  withFundingBalance,
} from "../walletRecord.js";
import {
  costChangedOf,
  costInCash,
  counted,
  ended,
  failedOf,
  openSession,
  readAfterLanding,
  unknownOf,
  withCashMoved,
  type ActionDeps,
} from "./common.js";
import type { AssetMoves } from "./fundDirectly.js";

/** An asset a portfolio can send, with what a relayer-paid send of it needs. */
export type SendableAsset<K extends Signer> = AssetMoves<K> & {
  /**
   * Sends it with the relayer paying the network and the portfolio paying it
   * back, when it is a token. Undefined for SOL, which pays its own way out
   * of the amount sent.
   */
  sendRelayed?(input: {
    owner: K;
    to: string;
    amount: number;
    reviewedFeeRaw: bigint;
    keepOut: string[];
    stillUnlocked: StillUnlocked;
  }): Promise<string>;
};

/** A token as a send's review prices it. */
export type SendToken = {
  symbol: string;
  decimals: number;
  /** What a send of it to `to` takes from the portfolio's own SOL when it pays the network itself. */
  sendLamports(to: string): Promise<number>;
  /** The relayer's price for a send of `amount` of it from `owner` to `to`. */
  quoteRelayed(owner: string, to: string, amount: number): Promise<RelayerQuote>;
};

export type SendChain<K extends Signer> = {
  asset(symbol: string): SendableAsset<K> | undefined;
  /** The token `symbol` names, or undefined for SOL and anything unregistered. */
  token(symbol: string): SendToken | undefined;
  isRecipientAddress(address: string): boolean;
  /** Reads the recipient from the network: why it cannot receive, or null for a wallet. */
  checkRecipient(address: string): Promise<Unsendable | null>;
  /** The symbol of the cash a relayer's fee is paid in. */
  cashSymbol: string;
  /** What a portfolio's own one-signature transaction costs it, in SOL. */
  networkFeeSol: number;
  cost: CostChain;
};

export type SendDeps<K extends Signer> = ActionDeps<K> & { chain: SendChain<K> };

export type SendInput = { symbol: string; amount: number; to: string };

/**
 * Where a send leaves from: a portfolio, by its id, or the funding wallet,
 * as `FUNDING`. The funding wallet is for cash: it sends its cash and its
 * SOL, and `held` knows of nothing else there.
 */
type Source = {
  address: string;
  /** False for an archived portfolio, which sends nothing. */
  active: boolean;
  /** Set for a portfolio. The funding wallet signs with its own key. */
  portfolio?: Portfolio;
  /** What it holds of `symbol`, as stored, or undefined for an asset it cannot send. */
  held(symbol: string): number | undefined;
};

function sourceOf(wallet: Wallet | null, id: string, cashSymbol: string): Source | undefined {
  if (!wallet) return undefined;
  if (id === FUNDING) {
    const { funding } = wallet;
    return {
      address: funding.address,
      active: true,
      held: (symbol) =>
        symbol === "SOL" || symbol === cashSymbol ? fundingBalance(funding, symbol) : undefined,
    };
  }
  const portfolio = wallet.portfolios.find((entry) => entry.id === id);
  return (
    portfolio && {
      address: portfolio.address,
      active: portfolio.archivedAt === null,
      portfolio,
      held: (symbol) => portfolio.holdings.find((holding) => holding.symbol === symbol)?.amount,
    }
  );
}

/**
 * Whether a send from `id` to `recipient` is the funding wallet paying one
 * of this wallet's own portfolios, archived ones included. That is what Move
 * to portfolio is for: a plain send would join the two addresses in public.
 */
function toOwnPortfolioFromFunding(wallet: Wallet | null, id: string, recipient: string): boolean {
  return id === FUNDING && Boolean(wallet?.portfolios.some((entry) => entry.address === recipient));
}

/**
 * The review of a send: its network cost, and the amount that will really be
 * sent. Sending all of a portfolio's cash while its network cost has to come
 * out of that cash sends the rest.
 *
 * A portfolio that cannot pay the network itself has the relayer priced
 * first, unless `withoutRelayer`: a review made again because the relayer
 * just failed must not offer it straight back.
 *
 * `portfolioId` is `FUNDING` for a send from the funding wallet. One to a
 * portfolio of this wallet is answered as `ownPortfolio` before anything is
 * read or priced.
 */
export async function reviewSend<K extends Signer>(
  deps: Pick<SendDeps<K>, "store" | "prices" | "chain">,
  input: { portfolioId: string; send: SendInput; withoutRelayer: boolean },
): Promise<SendReview> {
  if (toOwnPortfolioFromFunding(deps.store.snapshot(), input.portfolioId, input.send.to.trim())) {
    return { cost: { kind: "unavailable" }, amount: input.send.amount, recipient: "ownPortfolio" };
  }
  const recipient = await recipientOf(deps.chain, input.send.to);
  // A recipient that cannot receive, or could not be read, is the whole
  // answer: no cost is worked out for a send that will not be made.
  if (recipient !== null) {
    return { cost: { kind: "unavailable" }, amount: input.send.amount, recipient };
  }
  return { ...(await reviewCost(deps, input)), recipient };
}

/**
 * What a review of a send answers: its cost, the amount that will really be
 * sent, and what the network said of the recipient. The recipient is part of
 * every review, so no screen can show one for an address nobody checked:
 * null for a wallet, why it cannot receive, "unreadable" when the network
 * could not be asked, or "ownPortfolio" when the funding wallet would be
 * sending to a portfolio of this wallet.
 */
export type SendReview = {
  cost: NetworkCost;
  amount: number;
  recipient: Unsendable | "unreadable" | "ownPortfolio" | null;
};

async function recipientOf<K extends Signer>(
  chain: SendChain<K>,
  to: string,
): Promise<Unsendable | "unreadable" | null> {
  if (!chain.isRecipientAddress(to.trim())) return "offCurve";
  try {
    return await chain.checkRecipient(to.trim());
  } catch {
    return "unreadable";
  }
}

async function reviewCost<K extends Signer>(
  deps: Pick<SendDeps<K>, "store" | "prices" | "chain">,
  input: { portfolioId: string; send: SendInput; withoutRelayer: boolean },
): Promise<{ cost: NetworkCost; amount: number }> {
  const { send, withoutRelayer } = input;
  const { chain } = deps;
  const token = chain.token(send.symbol);
  const source = sourceOf(deps.store.snapshot(), input.portfolioId, chain.cashSymbol);
  // Sending SOL pays its own way out of the amount.
  if (!token || !source) return { cost: { kind: "covered" }, amount: send.amount };
  let lamports: number;
  try {
    lamports = await readWithRetries(() => token.sendLamports(send.to));
  } catch {
    return { cost: { kind: "unavailable" }, amount: send.amount };
  }
  const owner = source.address;
  const solPrice = deps.prices.price("SOL") || undefined;
  try {
    // The funding wallet pays the network itself when it holds the SOL to.
    // Only when it cannot is it priced with the relayer, as a portfolio is.
    const ownSol = source.portfolio
      ? null
      : await planOwnSolCost({ owner, lamportsNeeded: lamports, solPrice }, chain.cost).catch(
          () => null,
        );
    if (ownSol) return { cost: ownSol, amount: send.amount };
    return await planSendCost(
      {
        owner,
        lamportsNeeded: lamports,
        isCash: token.symbol === chain.cashSymbol,
        amount: send.amount,
        held: source.held(token.symbol) ?? 0,
        cashHeld: source.held(chain.cashSymbol) ?? 0,
        decimals: token.decimals,
        solPrice,
        relayerQuote: withoutRelayer
          ? undefined
          : () => token.quoteRelayed(owner, send.to, send.amount),
      },
      chain.cost,
    );
  } catch {
    return { cost: { kind: "unavailable" }, amount: send.amount };
  }
}

/**
 * Sends SOL or any registered token from this portfolio's own balance to
 * `to`. A symbol with no registry entry has no mint and therefore nothing to
 * send.
 *
 * `portfolioId` is `FUNDING` for a send from the funding wallet, of its cash
 * or its SOL. It signs with its own key, is reserved under `FUNDING` and is
 * written into Activity there. Money for one of this wallet's own portfolios
 * is refused here: it goes through Move to portfolio, which keeps the two
 * addresses apart in public.
 */
export async function send<K extends Signer>(
  deps: SendDeps<K>,
  input: { portfolioId: string; send: SendInput; network?: CostAgreed },
): Promise<Attempt> {
  const { portfolioId: id, network } = input;
  const { prices, chain } = deps;
  const handle = chain.asset(input.send.symbol);
  if (!handle) return refusedFor("notTransferable", input.send.symbol);

  // Plan and guard: an active portfolio, or the funding wallet, sending no
  // more than it holds, to a real address that is not its own.
  const session = openSession(deps.session);
  if ("kind" in session) return session;
  const source = sourceOf(session.wallet, id, chain.cashSymbol);
  const held = source?.held(input.send.symbol);
  const amount = input.send.amount;
  const recipient = input.send.to.trim();
  if (toOwnPortfolioFromFunding(session.wallet, id, recipient)) {
    return refused("ownPortfolioFromFunding");
  }
  if (
    !source?.active ||
    held === undefined ||
    !positive(amount) ||
    amount > held ||
    !chain.isRecipientAddress(recipient) ||
    recipient === source.address
  ) {
    return refused("sendNotCompleted");
  }

  const funder = session.fundingSigner();
  const owner = source.portfolio ? session.portfolioSigner(source.portfolio) : funder;
  if (!owner || !funder) return refused(session.refusal());
  const ownerAddress = owner.publicKey.toBase58();
  // What the relayer is paid, when the review showed it paying: cash that
  // leaves with the send, whatever is sent.
  const relayed = Boolean(handle.sendRelayed) && network?.relayerFeeRaw !== undefined;
  const cost = relayed ? costInCash(network?.relayerFeeRaw) : 0;
  const charged = cost > 0 ? { networkCost: cost } : {};

  // Reserve, with the activity entry to write should it land unseen.
  const reservation = await deps.pending.reserve(
    id,
    source.address,
    deps.words.send(handle.symbol, amount),
    {
      kind: "send",
      symbol: handle.symbol,
      amount,
      usd: amount * prices.price(handle.symbol),
      counterparty: recipient,
      ...charged,
    },
  );
  if (!reservation) return refused("actionPending");
  let outcome: unknown;
  let signature: string | undefined;
  let realBalance: number;

  const resync = async () => {
    const balance = await handle.balance(ownerAddress);
    deps.store.update((current) =>
      source.portfolio
        ? mapPortfolio(current, id, (entry) =>
            setRealHolding(prices, entry, handle.symbol, balance),
          )
        : withFundingBalance(current, handle.symbol, balance),
    );
    return balance;
  };

  try {
    realBalance = await handle.balance(ownerAddress);
    if (amount > realBalance) {
      return refused(source.portfolio ? "moreThanOnchain" : "moreThanFunding");
    }

    // Sign and submit. Sending SOL pays its own way out of the amount.
    // Anything else has its network cost paid by the relayer when the review
    // showed that, and otherwise by the portfolio itself, which the send
    // checks it can.
    const withdraw = () => handle.withdraw(owner, funder, amount, recipient, session.live);
    if (!handle.sendRelayed) await withdraw();
    else if (network?.relayerFeeRaw !== undefined) {
      signature = await handle.sendRelayed({
        owner,
        to: recipient,
        amount,
        reviewedFeeRaw: network.relayerFeeRaw,
        keepOut: othersOf(session.wallet, source, recipient),
        stillUnlocked: session.live,
      });
    } else {
      await withdraw();
    }
  } catch (error) {
    outcome = error;
    await resync().catch(() => undefined);
    return (
      unknownOf(error) ??
      costChangedOf(error) ??
      counted(deps, "send_failed", {}, failedOf("sendFailed", error))
    );
  } finally {
    await ended(reservation, outcome);
  }

  // Settle. From here the send has landed, so nothing below may report it as
  // failed: that would invite sending it again. When the balance cannot be
  // read back yet, what was held less what was sent stands in until a
  // refresh replaces it. The sender pays its own fee, so sending all of its
  // SOL delivers the balance less that fee.
  const sent =
    handle.symbol === "SOL" && amount === realBalance ? amount - chain.networkFeeSol : amount;
  const read = await readAfterLanding(() => handle.balance(ownerAddress));
  const isCash = handle.symbol === chain.cashSymbol;
  const newBalance = read ?? Math.max(realBalance - amount - (isCash ? cost : 0), 0);
  void deps.store
    .update((current) =>
      logged(
        source.portfolio
          ? mapPortfolio(current, id, (entry) => {
              const sentFrom = setRealHolding(prices, entry, handle.symbol, newBalance);
              // The cost was paid in cash. When cash is not what was sent, nothing
              // above read it back, so it is taken off here until a refresh does.
              return isCash ? sentFrom : withCashMoved(prices, sentFrom, chain.cashSymbol, -cost);
            })
          : // The funding wallet sends cash or SOL only, and a relayer is paid
            // only on a send of cash: its cost is already in the balance above.
            withFundingBalance(current, handle.symbol, newBalance),
        {
          portfolioId: id,
          kind: "send",
          symbol: handle.symbol,
          amount: sent,
          usd: sent * prices.price(handle.symbol),
          counterparty: recipient,
          ...charged,
        },
        prices,
      ),
    )
    .catch(() => false);
  deps.track("sent");
  return {
    kind: "confirmed",
    ...(signature ? { signature } : {}),
    settlement: read === null ? "balancesEstimated" : "balancesRead",
  };
}
