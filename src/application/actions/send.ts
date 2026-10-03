import type { NetworkCost } from "../../domain/networkCost.js";
import { planSendCost, type CostAgreed, type CostChain } from "../networkCost.js";
import type { RelayerQuote, Signer, StillUnlocked } from "../ports.js";
import { refused, refusedFor, type Attempt } from "../result.js";
import {
  activePortfolio,
  holdingIn,
  logged,
  mapPortfolio,
  othersOf,
  positive,
  setRealHolding,
} from "../walletRecord.js";
import {
  costChangedOf,
  counted,
  failedOf,
  openSession,
  unknownOf,
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
  /** The symbol of the cash a relayer's fee is paid in. */
  cashSymbol: string;
  /** What a portfolio's own one-signature transaction costs it, in SOL. */
  networkFeeSol: number;
  cost: CostChain;
};

export type SendDeps<K extends Signer> = ActionDeps<K> & { chain: SendChain<K> };

export type SendInput = { symbol: string; amount: number; to: string };

/**
 * The review of a send: its network cost, and the amount that will really be
 * sent. Sending all of a portfolio's cash while its network cost has to come
 * out of that cash sends the rest.
 *
 * A portfolio that cannot pay the network itself has the relayer priced
 * first, unless `withoutRelayer`: a review made again because the relayer
 * just failed must not offer it straight back.
 */
export async function reviewSend<K extends Signer>(
  deps: Pick<SendDeps<K>, "store" | "prices" | "chain">,
  input: { portfolioId: string; send: SendInput; withoutRelayer: boolean },
): Promise<{ cost: NetworkCost; amount: number }> {
  const { send, withoutRelayer } = input;
  const { chain } = deps;
  const token = chain.token(send.symbol);
  const portfolio = deps.store
    .snapshot()
    ?.portfolios.find((entry) => entry.id === input.portfolioId);
  // Sending SOL pays its own way out of the amount.
  if (!token || !portfolio) return { cost: { kind: "covered" }, amount: send.amount };
  let lamports: number;
  try {
    lamports = await token.sendLamports(send.to);
  } catch {
    return { cost: { kind: "unavailable" }, amount: send.amount };
  }
  const owner = portfolio.address;
  try {
    return await planSendCost(
      {
        owner,
        lamportsNeeded: lamports,
        isCash: token.symbol === chain.cashSymbol,
        amount: send.amount,
        held: holdingIn(portfolio, token.symbol).amount,
        cashHeld: holdingIn(portfolio, chain.cashSymbol).amount,
        decimals: token.decimals,
        solPrice: deps.prices.price("SOL") || undefined,
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
 */
export async function send<K extends Signer>(
  deps: SendDeps<K>,
  input: { portfolioId: string; send: SendInput; network?: CostAgreed },
): Promise<Attempt> {
  const { portfolioId: id, network } = input;
  const { prices, chain } = deps;
  const handle = chain.asset(input.send.symbol);
  if (!handle) return refusedFor("notTransferable", input.send.symbol);

  // Plan and guard: an active portfolio sending no more than it holds, to a
  // real address that is not its own.
  const session = openSession(deps.session);
  if ("kind" in session) return session;
  const portfolio = activePortfolio(session.wallet, id);
  const holding = portfolio?.holdings.find((h) => h.symbol === input.send.symbol);
  const amount = input.send.amount;
  const recipient = input.send.to.trim();
  if (
    !portfolio ||
    !holding ||
    !positive(amount) ||
    amount > holding.amount ||
    !chain.isRecipientAddress(recipient) ||
    recipient === portfolio.address
  ) {
    return refused("sendNotCompleted");
  }

  const owner = session.portfolioSigner(portfolio);
  const funder = session.fundingSigner();
  if (!owner || !funder) return refused(session.refusal());
  const ownerAddress = owner.publicKey.toBase58();

  // Reserve, with the activity entry to write should it land unseen.
  const reservation = await deps.pending.reserve(
    id,
    portfolio.address,
    deps.words.send(handle.symbol, amount),
    {
      kind: "send",
      symbol: handle.symbol,
      amount,
      usd: amount * prices.price(handle.symbol),
      counterparty: recipient,
    },
  );
  if (!reservation) return refused("actionPending");
  let outcome: unknown;

  const resync = async () => {
    const balance = await handle.balance(ownerAddress);
    deps.store.update((current) =>
      mapPortfolio(current, id, (entry) => setRealHolding(prices, entry, handle.symbol, balance)),
    );
    return balance;
  };

  try {
    const realBalance = await handle.balance(ownerAddress);
    if (amount > realBalance) return refused("moreThanOnchain");

    // Sign and submit. Sending SOL pays its own way out of the amount.
    // Anything else has its network cost paid by the relayer when the review
    // showed that, and otherwise by the portfolio itself, which the send
    // checks it can.
    const withdraw = () => handle.withdraw(owner, funder, amount, recipient, session.live);
    let signature: string | undefined;
    if (!handle.sendRelayed) await withdraw();
    else if (network?.relayerFeeRaw !== undefined) {
      signature = await handle.sendRelayed({
        owner,
        to: recipient,
        amount,
        reviewedFeeRaw: network.relayerFeeRaw,
        keepOut: othersOf(session.wallet, portfolio, recipient),
        stillUnlocked: session.live,
      });
    } else {
      await withdraw();
    }

    // Settle. A portfolio pays its own fee, so sending all of its SOL
    // delivers the balance less that fee.
    const sent =
      handle.symbol === "SOL" && amount === realBalance ? amount - chain.networkFeeSol : amount;
    const newBalance = await handle.balance(ownerAddress);
    deps.store.update((current) =>
      logged(
        mapPortfolio(current, id, (entry) =>
          setRealHolding(prices, entry, handle.symbol, newBalance),
        ),
        {
          portfolioId: id,
          kind: "send",
          symbol: handle.symbol,
          amount: sent,
          usd: sent * prices.price(handle.symbol),
          counterparty: recipient,
        },
        prices,
      ),
    );
    deps.track("sent");
    return {
      kind: "confirmed",
      ...(signature ? { signature } : {}),
      settlement: "balancesRead",
    };
  } catch (error) {
    outcome = error;
    await resync().catch(() => undefined);
    return (
      unknownOf(error) ??
      costChangedOf(error) ??
      counted(deps, "send_failed", {}, failedOf("sendFailed", error))
    );
  } finally {
    await reservation.finish(outcome);
  }
}
