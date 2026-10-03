import { mobileOnboardingCopy, onboardingCopy } from "../copy/onboarding.js";
import type { ImportResolution, SchemeActivity } from "../domain/importResolution.js";
import type { DerivationScheme } from "../domain/wallet.js";

/**
 * The phone's "Where did this phrase come from?" screen and its import
 * result: what each set of addresses was found to hold, in words, and never
 * an address.
 */

export type ImportSourceChoice = "app" | "walletDefault" | "notSure";

/** The scheme the most other wallets use, opened when the chain cannot decide. */
const MOST_WALLETS: DerivationScheme = "walletDefault";

const copy = mobileOnboardingCopy.source;

/**
 * Token balances: anything at the funding address. A set whose only sign of
 * use is a portfolio found further along shows no funding balance.
 */
function heldTokens(activity: SchemeActivity): boolean {
  return activity.balanceSol > 0 || (activity.active && activity.portfolios.length === 0);
}

export function importFoundText(activity: SchemeActivity): string {
  const portfolios = activity.portfolios.length;
  const tokens = heldTokens(activity);
  if (portfolios > 0 && tokens) return copy.portfoliosAndTokens(portfolios);
  if (portfolios > 0) return copy.portfolios(portfolios);
  if (tokens) return copy.tokenBalances;
  return copy.nothingFound;
}

/** The scheme a choice opens. "Not sure" follows the chain, or what most wallets use. */
export function importSchemeFor(
  choice: ImportSourceChoice,
  resolution: ImportResolution,
): DerivationScheme {
  return choice === "notSure" ? (resolution.scheme ?? MOST_WALLETS) : choice;
}

export type ImportSourceOption = {
  choice: ImportSourceChoice;
  title: string;
  captions: { text: string; tone: "dim" | "faint" | "safe" }[];
};

export type ImportSourceView = {
  options: ImportSourceOption[];
  /** Preselected when exactly one set shows anything on chain. */
  preselected: ImportSourceChoice | null;
};

export function importSourceView(resolution: ImportResolution): ImportSourceView {
  const usedMark = (scheme: DerivationScheme) =>
    resolution.scheme === scheme ? [{ text: copy.used, tone: "safe" as const }] : [];
  return {
    preselected: resolution.scheme,
    options: [
      {
        choice: "app",
        title: copy.noirwire,
        captions: [{ text: importFoundText(resolution.app), tone: "dim" }, ...usedMark("app")],
      },
      {
        choice: "walletDefault",
        title: copy.otherWallet,
        captions: [
          { text: copy.otherWalletExamples, tone: "faint" },
          { text: importFoundText(resolution.walletDefault), tone: "dim" },
          ...usedMark("walletDefault"),
        ],
      },
      {
        choice: "notSure",
        title: copy.notSure,
        captions: [
          { text: resolution.scheme ? copy.opensUsed : copy.opensMostWallets, tone: "dim" },
        ],
      },
    ],
  };
}

export type ImportResultView = { title: string; body: string; found: boolean };

export function importResultView(activity: SchemeActivity): ImportResultView {
  const portfolios = activity.portfolios.length;
  const result = mobileOnboardingCopy.result;
  if (!activity.active)
    return { title: onboardingCopy.import.importedTitle, body: result.nothing, found: false };
  return {
    title: onboardingCopy.import.reunitedTitle,
    body: portfolios > 0 ? result.found(portfolios) : result.foundBalances,
    found: true,
  };
}

/** An address in groups of four characters, as it is shown and read once the user asks for it. */
export function groupsOfFour(address: string): string[] {
  return address.match(/.{1,4}/g) ?? [];
}

export type LookFurtherView = {
  /** The label of the control that starts the further scan, or null while one is running. */
  action: string | null;
  /** What to show while it runs. */
  waiting: string | null;
  /** How the last one ended. */
  note: { text: string; tone: "safe" | "dim" | "danger" } | null;
};

/**
 * The "Missing a portfolio? Look further" control on an import's result, on
 * both platforms: offered until it is running, and afterwards saying how
 * many more were found, that there were none, or that it could not finish.
 * `before` is the result it was asked from and `after` what came back.
 */
export function lookFurtherView(
  state:
    | { status: "idle" }
    | { status: "looking" }
    | { status: "failed" }
    | { status: "done"; before: SchemeActivity; after: SchemeActivity },
): LookFurtherView {
  const words = onboardingCopy.import.lookFurther;
  switch (state.status) {
    case "idle":
      return { action: words.action, waiting: null, note: null };
    case "looking":
      return { action: null, waiting: words.looking, note: null };
    case "failed":
      return {
        action: words.action,
        waiting: null,
        note: { text: words.failed, tone: "danger" },
      };
    case "done": {
      const more = state.after.portfolios.length - state.before.portfolios.length;
      return {
        action: words.action,
        waiting: null,
        note:
          more > 0
            ? { text: words.found(more), tone: "safe" }
            : { text: words.nothing, tone: "dim" },
      };
    }
  }
}
