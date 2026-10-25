import type { NetworkName } from "./protocol.js";

/**
 * What a request to sign turned out to be once its bytes were read: the
 * wallet's own account of it, from which the approval screen is drawn. The
 * terminal's description of what it asks for is never part of it.
 */

export type TransactionKind =
  "openTrader" | "setOrderKeys" | "deposit" | "withdraw" | "depositToRollup" | "withdrawToSolana";

/** Which of the two ways a Solana deposit is built: the first for an owner, or a repeat. */
export type DepositVariant = "first" | "repeat";

export type RefusalWhy =
  | "empty"
  | "tooLong"
  | "versioned"
  | "unparsable"
  | "notCanonical"
  | "program"
  | "network"
  | "count"
  | "discriminator"
  | "data"
  | "zeroAmount"
  | "initVault"
  | "instruction"
  | "sequence"
  | "orderKeys"
  | "payer"
  | "notConfigured"
  | "mismatch"
  | "looksLikeTransaction"
  | "notText"
  | "notChallenge"
  | "otherUser"
  | "tooOld"
  | "tooNew";

export type Refused = {
  ok: false;
  refusal: "notDecodable" | "notAllowed";
  why: RefusalWhy;
};

export type AccountRole = { address: string; signer: boolean; writable: boolean };

export type DecodedInstruction = { program: string; name: string; accounts: AccountRole[] };

export type DecodedTransaction = {
  type: "transaction";
  kind: TransactionKind;
  network: NetworkName;
  owner: string;
  /** The USDC atoms a deposit or withdrawal moves; null for a kind that moves nothing. */
  amountAtoms: bigint | null;
  variant?: DepositVariant;
  feePayer: string;
  signatureCount: number;
  recentBlockhash: string;
  /** How many instructions open an account that holds rent. */
  accountsOpened: number;
  /** The four trading keys an opening or a device change sets. */
  orderKeys?: string[];
  instructions: DecodedInstruction[];
};

export type DecodedSignIn = { type: "signIn"; address: string; timestamp: number };

export type DecodedRequest = DecodedTransaction | DecodedSignIn;

export type Decoded<T> = { ok: true; request: T } | Refused;
