import { wordlist } from "@scure/bip39/wordlists/english";
import { MIN_PASSWORD_LENGTH } from "../domain/wallet.js";

/**
 * How hard a wallet password is to guess, which is the whole of the
 * wallet's protection once someone has a copy of the encrypted phrase.
 *
 * That attack is offline: whoever copies the browser's storage can guess as
 * fast as their hardware allows, and no lockout or attempt counter can stop
 * them. PBKDF2 at 600,000 iterations slows each guess to roughly 10^4 per
 * second per GPU (an estimate), so the password itself has to carry the
 * rest. The bar below, 10^12 estimated guesses, is about three GPU-years
 * against that rate; a common password is seconds.
 *
 * The estimate comes from zxcvbn, which knows leaked-password lists,
 * keyboard patterns, repeats and dates rather than counting character
 * classes. Its dictionaries are large, so `assessPassword` loads them only
 * when a password is checked. An app that would rather carry them in the
 * screen's own bundle, so the check never waits on a download, builds the
 * checker itself and runs the same rule with `assessPasswordWith`.
 */

const MIN_GUESSES_LOG10 = 12;
/** Stands in for the checker while a password is too short to need one, so nothing is loaded for it. */
const NO_CHECKER: PasswordChecker = { check: () => ({ guessesLog10: 0 }) };
const CONTEXT_WORDS = ["noirwire", "wallet", "solana", "password", "crypto", "stocks"];

export type PasswordAssessment = { ok: true } | { ok: false; reason: string };

/** What estimates a password's guesses: a `ZxcvbnFactory` from `@zxcvbn-ts/core` is one. */
export type PasswordChecker = {
  check(password: string, userInputs?: string[]): { guessesLog10: number };
};

let checker: Promise<PasswordChecker> | null = null;

function loadChecker(): Promise<PasswordChecker> {
  checker ??= Promise.all([import("@zxcvbn-ts/core"), import("@zxcvbn-ts/language-common")])
    .then(
      ([core, common]) =>
        new core.ZxcvbnFactory({
          dictionary: common.dictionary,
          graphs: common.adjacencyGraphs,
        }) as PasswordChecker,
    )
    .catch((error: unknown) => {
      // A failed chunk load must not stick for the whole session: the next
      // check tries again instead of blocking every password screen.
      checker = null;
      throw error;
    });
  return checker;
}

/**
 * The rule itself, with a checker the caller already holds. Synchronous:
 * nothing is loaded. A password too short is refused before the checker is
 * asked.
 */
export function assessPasswordWith(checker: PasswordChecker, password: string): PasswordAssessment {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: `Use at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  const { guessesLog10 } = checker.check(password, CONTEXT_WORDS);
  if (guessesLog10 < MIN_GUESSES_LOG10) {
    return {
      ok: false,
      reason:
        "Too easy to guess. Use a few unrelated words, or tap Suggest a password for a strong one.",
    };
  }
  return { ok: true };
}

/** The same rule, loading the checker and its dictionaries the first time it is asked. */
export async function assessPassword(password: string): Promise<PasswordAssessment> {
  if (password.length < MIN_PASSWORD_LENGTH) return assessPasswordWith(NO_CHECKER, password);
  return assessPasswordWith(await loadChecker(), password);
}

/**
 * Five random words from the 2,048-word BIP-39 list, about 55 bits: far past
 * the bar above and still something a person can type and write down.
 * Chosen with the browser's cryptographic random source, never Math.random.
 */
export function suggestPassphrase(words = 5): string {
  const picks = new Uint32Array(words);
  crypto.getRandomValues(picks);
  return Array.from(picks, (value) => wordlist[value % wordlist.length]).join("-");
}
