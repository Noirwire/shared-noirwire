import type { Keypair } from "@solana/web3.js";
import type { RewardsApi } from "../../application/ports.js";
import {
  inviteCodeAsSent,
  isInviteCode,
  rewardsJoinMessage,
  rewardsMessage,
  type RewardsState,
  type RewardsWeek,
} from "../../domain/rewards.js";
import { apiUrl } from "../api.js";
import { apiErrorOf, authorizedFetch } from "../apiSession.js";
import { readFetch } from "../readFetch.js";
import { base58 } from "./bytes.js";
import { signMessage } from "./profile.js";
import { WalletLockedError, type StillUnlocked } from "./signerAccounts.js";

/**
 * Rewards on NoirWire's server: points for trades, for a wallet that joined.
 *
 * A member is the public key of a key derived for this alone. It holds
 * nothing and is no funding wallet's and no portfolio's, and what it asks is
 * signed with it. A claim is the one request that names a portfolio beside
 * it: the portfolio signs the same message, so the server can see the trade
 * was the member's, and the server keeps neither the portfolio's address nor
 * the trade's signature afterwards.
 */

/** The server's code for a trade it cannot see as final yet, the one refusal of a claim that is asked again. */
const NOT_FINALIZED = "transaction_not_finalized";

const posting = (body: Record<string, unknown>): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** `key`'s signature over `message`, as the server reads one. Nothing is signed once the wallet has locked. */
function signed(key: Keypair, message: string, stillUnlocked: StillUnlocked): string {
  if (!stillUnlocked()) throw new WalletLockedError();
  return base58(signMessage(key, new TextEncoder().encode(message)));
}

/**
 * A request that carries the moment it was made, in Unix seconds, signed for
 * by the member over what `message` makes of the key and that moment.
 */
function stamped(
  member: Keypair,
  stillUnlocked: StillUnlocked,
  message: (rewardsKey: string, at: number) => string,
): { rewardsKey: string; at: number; signature: string } {
  const rewardsKey = member.publicKey.toBase58();
  const at = Math.floor(Date.now() / 1000);
  return { rewardsKey, at, signature: signed(member, message(rewardsKey, at), stillUnlocked) };
}

/** The failure a request ends in when its answer is neither a success nor one this client has a reading for. */
async function failureOf(response: Response, what: string): Promise<Error> {
  return (await apiErrorOf(response)) ?? new Error(`${response.status} from ${what}.`);
}

const unsound = () => new Error("A rewards request was answered without a member's standing.");

/** A count the server may not send yet: the number, or null for anything else. */
const countIn = (value: unknown): number | null => (typeof value === "number" ? value : null);

/** The running week as the server sent it, or null when it sent none. */
function weekIn(value: unknown): RewardsWeek | null {
  if (value === null || value === undefined) return null;
  const { index, endsAt, feeMicroUsdc, shareBps, traders } = value as Record<string, unknown>;
  if (
    typeof index !== "number" ||
    typeof endsAt !== "string" ||
    typeof feeMicroUsdc !== "string" ||
    typeof shareBps !== "number"
  ) {
    throw unsound();
  }
  return { index, endsAt, feeMicroUsdc, shareBps, traders: countIn(traders) };
}

/** A member's standing, rebuilt field by field from what the server sent. Throws for anything else. */
function stateIn(value: unknown): RewardsState {
  const { code, codeActive, invited, wasInvited, points, week } = (value ?? {}) as Record<
    string,
    unknown
  >;
  // A code is put into a link people pass on, so only one the server could have issued is taken.
  if (
    !isInviteCode(code) ||
    typeof codeActive !== "boolean" ||
    typeof invited !== "number" ||
    typeof wasInvited !== "boolean" ||
    typeof points !== "string"
  ) {
    throw unsound();
  }
  return { code, codeActive, invited, wasInvited, points, week: weekIn(week) };
}

export const rewardsApi: RewardsApi<Keypair> = {
  async config() {
    const response = await readFetch(apiUrl("rewards", "/config"));
    if (!response.ok) throw await failureOf(response, "the rewards settings");
    const { enabled, seasonStart, seasonWeeks, weeklyPoints, tradersThisWeek } =
      (await response.json()) as Record<string, unknown>;
    if (enabled !== true) return null;
    if (
      typeof seasonStart !== "string" ||
      typeof seasonWeeks !== "number" ||
      typeof weeklyPoints !== "number"
    ) {
      throw new Error("The rewards settings were answered without a season.");
    }
    return { seasonStart, seasonWeeks, weeklyPoints, tradersThisWeek: countIn(tradersThisWeek) };
  },

  async join(member, inviteCode, stillUnlocked) {
    // The code that is signed for is the one that is sent, to the letter.
    const code = inviteCodeAsSent(inviteCode);
    const response = await readFetch(
      apiUrl("rewards", "/join"),
      posting({
        ...stamped(member, stillUnlocked, (key, at) => rewardsJoinMessage(key, at, code)),
        ...(code === undefined ? {} : { inviteCode: code }),
      }),
    );
    if (response.ok) return { kind: "joined", state: stateIn(await response.json()) };
    const refusal = await apiErrorOf(response);
    if (refusal?.code === "invite_code_invalid") return { kind: "inviteNotValid" };
    throw refusal ?? new Error(`${response.status} from joining rewards.`);
  },

  async state(member, stillUnlocked) {
    const response = await readFetch(
      apiUrl("rewards", "/state"),
      posting(
        stamped(member, stillUnlocked, (key, at) => rewardsMessage("state", key, String(at))),
      ),
    );
    if (response.ok) return stateIn(await response.json());
    const refusal = await apiErrorOf(response);
    // A server that runs no rewards answers 404 too, as `not_found`: that is no word on the member.
    if (refusal?.code === "not_a_member") return null;
    throw refusal ?? new Error(`${response.status} from a rewards read.`);
  },

  /**
   * Asked once. The server takes a trade once whoever asks and however
   * often, so a claim with no clear answer is simply made again later; one
   * turned down as not final yet is not asked again here, since a trade
   * takes longer to become final than a retry waits.
   */
  async claim({ member, portfolio, transaction, stillUnlocked }) {
    const rewardsKey = member.publicKey.toBase58();
    const message = rewardsMessage("claim", rewardsKey, transaction);
    const response = await authorizedFetch(apiUrl("rewards", "/claims"), {
      ...posting({
        rewardsKey,
        transaction,
        portfolio: portfolio.publicKey.toBase58(),
        portfolioSignature: signed(portfolio, message, stillUnlocked),
        rewardsSignature: signed(member, message, stillUnlocked),
      }),
      asksAgain: true,
    });
    if (response.ok) {
      const { credited, feeMicroUsdc, state } = (await response.json()) as Record<string, unknown>;
      if (
        credited !== true ||
        (typeof feeMicroUsdc !== "string" && typeof feeMicroUsdc !== "number")
      ) {
        throw new Error("A rewards claim was answered without a credit.");
      }
      return { kind: "credited", feeMicroUsdc: String(feeMicroUsdc), state: stateIn(state) };
    }
    // Only the server's own word on this claim settles it. A busy server, one that runs no
    // rewards right now (`not_found`) and anyone else's answer leave it to be made again.
    const refusal = await apiErrorOf(response);
    if (refusal?.code === "not_a_member") return { kind: "notMember" };
    if (refusal?.status === 409) return { kind: "alreadyClaimed" };
    if (refusal?.code === NOT_FINALIZED) return { kind: "notFinalized" };
    if (refusal?.status === 422 || refusal?.code === "signature_invalid") {
      return { kind: "refused", code: refusal.code };
    }
    throw refusal ?? new Error(`${response.status} from a rewards claim.`);
  },
};
