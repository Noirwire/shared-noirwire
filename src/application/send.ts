import { tooPrecise, typedAmount } from "../domain/amount.js";
/** What a send form holds, as typed, and what it knows about the asset and the address. */
export type SendInput = {
  /** What the portfolio holds of the asset, as stored. */
  heldRaw: number;
  /** Shown units per stored unit of the asset, or undefined while that is not known. */
  unitsPerHeld: number | undefined;
  amountText: string;
  /** How many decimals the asset has. An amount typed with more is refused. Unchecked when absent. */
  decimals?: number;
  /** The recipient as typed, trimmed. */
  destination: string;
  /** Whether `destination` is a well-formed address. */
  isAddress: boolean;
  /** Whether it is an address no key can sign for. */
  offCurve: boolean;
  /** The sending portfolio's own address. */
  ownAddress: string;
};

/** What a send of `SendInput` would move, and whether its parts are valid. */
export type SendDraft = {
  multiplierKnown: boolean;
  /** What the portfolio holds, in shown units. */
  held: number;
  validAmount: boolean;
  /** The amount was typed with more decimals than the asset has. */
  tooPrecise: boolean;
  /** The typed amount in shown units, or 0 when it is not a valid amount. */
  amount: number;
  sendingAll: boolean;
  /** The amount in stored units, which is what is reviewed and sent. */
  rawAmount: number;
  validRecipient: boolean;
};

export function sendDraft(input: SendInput): SendDraft {
  const { heldRaw, unitsPerHeld } = input;
  const multiplierKnown = unitsPerHeld !== undefined;
  const held = multiplierKnown ? heldRaw * unitsPerHeld : 0;
  const precise = input.decimals !== undefined && tooPrecise(input.amountText, input.decimals);
  const amount = precise ? 0 : typedAmount(input.amountText);
  const validAmount = amount > 0;
  // Sending the full shown balance moves the exact stored raw amount, so
  // converting shown units back to raw leaves no rounding dust behind.
  const sendingAll = validAmount && amount === held;
  const typedRaw = multiplierKnown ? amount / unitsPerHeld : 0;
  const rawAmount = validAmount ? (sendingAll ? heldRaw : typedRaw) : 0;
  const validRecipient =
    input.isAddress && !input.offCurve && input.destination !== input.ownAddress;
  return {
    multiplierKnown,
    held,
    validAmount,
    tooPrecise: precise,
    amount,
    sendingAll,
    rawAmount,
    validRecipient,
  };
}
