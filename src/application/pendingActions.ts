import { ChainError, UnknownOutcomeError } from "../domain/chainError.js";
import type { PendingAction, Wallet } from "../domain/wallet.js";
import {
  pendingReducer,
  signedSomething,
  type ChainOutcome,
  type PendingEvent,
} from "./pending.js";
import type { PriceReader } from "./ports.js";
import { logged, mapPortfolio, randomId } from "./walletRecord.js";

/**
 * One action at a time per portfolio, and never the same one twice.
 *
 * An action is reserved before anything is signed: under a lock every tab
 * shares, the wallet record is read afresh, and only if the portfolio has
 * nothing reserved or unsettled is a reservation written into it. Two taps
 * on Confirm, or Confirm in two tabs, therefore cannot both get as far as a
 * signature. The button is held back too, but the record is what decides.
 *
 * Each transaction the action signs is written into its reservation before
 * it may leave this device (`recordSigned`), so a reservation always says
 * whether anything could have been sent. It ends in one of three ways:
 * - the action completed, or failed in a way that is certain to have sent
 *   nothing that can still land (it was refused before signing, the relayer
 *   never received it, or the chain shows it failed): it is released;
 * - its outcome is unknown: it stays, and the chain is asked about it
 *   (`settlePending`) until it shows the transaction landed or expired.
 *   Nothing more is confirmed from that portfolio meanwhile;
 * - the tab doing it went away (closed, reloaded) before anything was signed:
 *   the reservation's own lock, held for as long as the action runs, is then
 *   free, and the reservation is released by whoever looks next.
 *
 * It is kept in the encrypted wallet record, through the store, so a reload,
 * a lock and unlock or another tab all see it. The states and events are the
 * shared package's (src/application/pending.ts).
 */

/**
 * The scope an action is reserved in: a portfolio's id, or `FUNDING` for
 * the funding wallet, whose action is moving money into a portfolio.
 */
export const FUNDING = "funding";

/** What is known of a transaction the moment it is signed, before it can leave this device. */
export type SignedRecord = {
  /** The address of the key that signed. */
  signer: string;
  signature?: string;
  blockhash: string;
  lastValidBlockHeight?: number;
};

export type PendingActionsDeps = {
  store: {
    snapshot(): Wallet | null;
    update(change: (wallet: Wallet) => Wallet): Promise<boolean>;
    /** Takes in what another tab stored, writing nothing. False when locked or unreadable. */
    sync(): Promise<boolean>;
    serialised<T>(name: string, task: () => Promise<T>): Promise<T>;
    subscribe(listener: () => void): () => void;
  };
  locks: {
    /** Takes the lock that says a reservation's tab is alive, and hands back what releases it. */
    hold(id: string): Promise<() => void>;
    /** Whether the tab that made a reservation is gone. Null when that cannot be told. */
    ownerGone(id: string): Promise<boolean | null>;
  };
  /** Asks the chain what became of a signed or sent transaction. */
  settle(
    sent: Pick<PendingAction, "signature" | "lastValidBlockHeight" | "blockhash">,
  ): Promise<ChainOutcome>;
  prices: Pick<PriceReader, "isPosition" | "shownUnits">;
};

export type Reservation = {
  /**
   * Ends the reservation: with no error, or one certain to have sent nothing
   * that can still land, it is released; with an unknown outcome it stays.
   */
  finish(error?: unknown): Promise<void>;
  /**
   * Ends it as sent and accepted but not yet seen on chain, under
   * `signature`: it stays until the chain shows that transaction landed.
   * For a send a service accepts and lands later, such as a private transfer.
   */
  submitted(signature: string): Promise<void>;
};

export type PendingActions = ReturnType<typeof createPendingActions>;

function pendingIn(wallet: Wallet, key: string): PendingAction | undefined {
  return key === FUNDING
    ? wallet.funding.pendingAction
    : wallet.portfolios.find((entry) => entry.id === key)?.pendingAction;
}

function setPendingIn(wallet: Wallet, key: string, next: PendingAction | undefined): Wallet {
  const put = <T extends { pendingAction?: PendingAction }>(entry: T): T => {
    const rest = { ...entry };
    delete rest.pendingAction;
    return next ? { ...rest, pendingAction: next } : rest;
  };
  return key === FUNDING
    ? { ...wallet, funding: put(wallet.funding) }
    : mapPortfolio(wallet, key, put);
}

/** Applies `event` to `key`'s pending action, but only to reservation `id`: one another tab made in between is left alone. */
function applied(wallet: Wallet, key: string, id: string, event: PendingEvent): Wallet {
  const current = pendingIn(wallet, key);
  if (current?.id !== id) return wallet;
  return setPendingIn(wallet, key, pendingReducer(current, event));
}

/** What a finished action's error means for its reservation. */
function endingOf(error: unknown): PendingEvent {
  if (error instanceof UnknownOutcomeError) {
    return {
      type: "outcomeUnknown",
      signature: error.signature,
      lastValidBlockHeight: error.lastValidBlockHeight,
    };
  }
  return { type: "released" };
}

export function createPendingActions(deps: PendingActionsDeps) {
  const { store, locks } = deps;

  /** The reservations this tab is running, by the address of the wallet that signs for them. */
  const running = new Map<string, { portfolioId: string; id: string }>();
  const listeners = new Set<() => void>();

  function changed() {
    listeners.forEach((listener) => listener());
  }

  /** Wallet changes and this tab's own reservations starting and ending. */
  function subscribePending(listener: () => void) {
    const fromStore = store.subscribe(listener);
    listeners.add(listener);
    return () => {
      fromStore();
      listeners.delete(listener);
    };
  }

  function pendingFor(portfolioId: string): PendingAction | undefined {
    const wallet = store.snapshot();
    return wallet ? pendingIn(wallet, portfolioId) : undefined;
  }

  /** Whether this tab is in the middle of the action reserved for `portfolioId`. */
  function runningHere(portfolioId: string): boolean {
    return [...running.values()].some((entry) => entry.portfolioId === portfolioId);
  }

  /**
   * Reserves the next action of the portfolio `portfolioId` (whose address is
   * `address`), or answers null when something is already reserved or
   * unsettled for it, in this tab or any other. `what` is the action in the
   * user's words, and `activity` the entry to write should it turn out to
   * have landed without this tab seeing it.
   */
  async function reserve(
    portfolioId: string,
    address: string,
    what: string,
    activity?: PendingAction["activity"],
  ): Promise<Reservation | null> {
    const id = randomId("act");
    const release = await locks.hold(id);
    const event: PendingEvent = { type: "reserve", id, at: Date.now(), what, activity };
    const won = await store.serialised("noirwire-reserve", async () => {
      if (!(await store.sync()) || pendingFor(portfolioId)) return false;
      const saved = await store.update((wallet) =>
        pendingIn(wallet, portfolioId)
          ? wallet
          : setPendingIn(wallet, portfolioId, pendingReducer(undefined, event)),
      );
      // What is stored now decides: another tab's write may have got there first.
      return saved && (await store.sync()) && pendingFor(portfolioId)?.id === id;
    });
    if (!won) {
      release();
      return null;
    }
    running.set(address, { portfolioId, id });
    changed();

    let finished = false;
    const end = async (ending: PendingEvent) => {
      if (finished) return;
      finished = true;
      running.delete(address);
      await store.update((wallet) => applied(wallet, portfolioId, id, ending));
      release();
      changed();
    };
    return {
      submitted: (signature) => end({ type: "submitted", signature }),
      finish: (error) => end(endingOf(error)),
    };
  }

  /**
   * Writes a transaction a portfolio has just signed into its running
   * reservation, before it can be sent. A transaction signed by an address
   * with no reservation here is not this module's. One that cannot be written
   * stops the send, with nothing sent.
   */
  async function recordSigned(record: SignedRecord): Promise<void> {
    const entry = running.get(record.signer);
    if (!entry) return;
    const saved = await store.update((wallet) =>
      applied(wallet, entry.portfolioId, entry.id, {
        type: "signed",
        signature: record.signature,
        blockhash: record.blockhash,
        lastValidBlockHeight: record.lastValidBlockHeight,
      }),
    );
    if (!saved || pendingFor(entry.portfolioId)?.id !== entry.id) {
      throw new ChainError("notRecorded");
    }
  }

  /**
   * Asks the chain what became of `portfolioId`'s unsettled action, and removes
   * it once that is known: "landed" also writes its activity entry, "expired"
   * just clears it. "unknown" means there is nothing to settle it by, and it
   * is left for the user to clear (`clearPending`). "none" when there is
   * nothing reserved. Storage is read first, so one that another tab recorded
   * is found too.
   */
  async function settlePending(portfolioId: string): Promise<"none" | ChainOutcome> {
    await store.sync();
    const sent = pendingFor(portfolioId);
    if (!sent) return "none";
    if (runningHere(portfolioId)) return "pending";

    let outcome: ChainOutcome;
    if (signedSomething(sent) || sent.status !== "reserved") outcome = await deps.settle(sent);
    else {
      // Nothing was signed under it. It is either still running in the tab
      // that made it, or that tab is gone and nothing ever will be.
      const gone = await locks.ownerGone(sent.id);
      if (gone === null) return "unknown";
      if (!gone) return "pending";
      await store.update((wallet) => applied(wallet, portfolioId, sent.id, { type: "released" }));
      return "expired";
    }
    if (outcome === "pending" || outcome === "unknown") return outcome;

    await store.update((wallet) => {
      const cleared = applied(wallet, portfolioId, sent.id, { type: "chainChecked", outcome });
      return outcome === "landed" && sent.activity && cleared !== wallet && portfolioId !== FUNDING
        ? logged(cleared, { portfolioId, ...sent.activity }, deps.prices)
        : cleared;
    });
    return outcome;
  }

  /**
   * Removes an unsettled action the chain cannot settle, on the user's word,
   * once they have checked the portfolio's balance. Only that one, and only
   * while it has no block height or blockhash to settle it by: a newer
   * reservation that took its place in the meantime is left alone.
   */
  async function clearPending(portfolioId: string, id: string): Promise<void> {
    if (runningHere(portfolioId)) return;
    await store.update((wallet) => applied(wallet, portfolioId, id, { type: "userCleared" }));
  }

  return {
    subscribePending,
    pendingFor,
    runningHere,
    reserve,
    recordSigned,
    settlePending,
    clearPending,
  };
}
