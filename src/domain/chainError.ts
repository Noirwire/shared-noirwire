/**
 * Why a step that reaches the chain, the relayer or the wallet's own record
 * stopped, as a code. A use case decides what each one means for the action,
 * and presentation chooses the words: the message of one of these errors is
 * its code, never a sentence for a person.
 */
export type ChainErrorCode =
  /** The wallet was locked before a key could sign. Nothing was signed. */
  | "walletLocked"
  /** The relayer could not be used. Nothing was sent. */
  | "relayerUnavailable"
  /** The relayer's fee rose past what was reviewed. Nothing was sent. */
  | "networkCostRose"
  /** A relayer-paid transaction was sent, and the chain shows it did not land. */
  | "relayedNotLanded"
  /** Sent, with no word on whether it landed. It may still land. */
  | "outcomeUnknown"
  /** A signed transaction could not be written into the wallet's record first. Nothing was sent. */
  | "notRecorded"
  /** The venue has no price for this order right now. */
  | "noQuote";

export class ChainError extends Error {
  constructor(
    readonly code: ChainErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "ChainError";
  }
}

/** Whether `error` is a `ChainError` of `code`. */
export function isChainError(error: unknown, code: ChainErrorCode): error is ChainError {
  return error instanceof ChainError && error.code === code;
}

/**
 * A transaction that was sent and whose result could not be learned. It is
 * not a failure: the transaction may still land, so retrying blind can do the
 * same thing twice. Callers should say so instead of reporting a failed trade.
 */
export class UnknownOutcomeError extends ChainError {
  /**
   * `signature` is the transaction's id when it is known, and
   * `lastValidBlockHeight` the height past which it can no longer land.
   * Either is enough to learn later what became of it.
   */
  constructor(
    readonly signature?: string,
    readonly lastValidBlockHeight?: number,
  ) {
    super("outcomeUnknown");
    this.name = "UnknownOutcomeError";
  }
}
