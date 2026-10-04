import type { AppPlatform } from "../domain/appPlatform.js";
import { mobileOnboardingCopy, onboardingCopy } from "../copy/onboarding.js";
import { waitingCopy } from "../copy/waiting.js";
import type { ProgressStep } from "./progress.js";

/**
 * What a person is waiting for:
 * - "content": something to read is loading (balances, prices, a list, a chart).
 * - "check": something they typed is being checked (a recipient, a phrase).
 * - "review": a review is being prepared (its price and its cost).
 * - "action": an action they confirmed is being carried out.
 */
export type WaitingKind = "content" | "check" | "review" | "action";

/** Nothing is shown before this, so a wait that ends at once never flickers. */
export const WAITING_DELAY_MS = 300;

/** From here on the calm "still working" line is shown, by what is being waited for. */
export const STILL_WORKING_AFTER_MS: Record<WaitingKind, number> = {
  content: 4_000,
  check: 4_000,
  review: 4_000,
  action: 8_000,
};

/**
 * How long a wait may run before the screen stops waiting, says it could not
 * finish (`waitingCopy.overdue`) and offers a way out: Back, Cancel or Try
 * again. A read that never answers must not keep a screen waiting, and an
 * action that never answers must not hold a dialog for good. The work may
 * still finish later, unseen, which is why an action's line says to check
 * Activity before doing it again. Where the two apps had set a kind
 * differently, the longer of the two stands, so neither gives up sooner
 * than it did.
 */
export const WAIT_LIMIT_MS: Record<WaitingKind, number> = {
  content: 20_000,
  check: 30_000,
  review: 30_000,
  action: 120_000,
};

/** When an import's progress list moves on to its last step, so a long lookup still shows progress. */
export const IMPORT_LAST_STEP_AFTER_MS = 6_000;

/**
 * What a renderer draws while waiting:
 * - "none": nothing yet.
 * - "placeholder": a quiet shape where the content will be.
 * - "indicator": a small moving mark beside `label`.
 */
export type WaitingSignal = "none" | "placeholder" | "indicator";

export type WaitingView = {
  signal: WaitingSignal;
  /** Shown beside an indicator, and announced for a placeholder. Null while nothing is shown. */
  label: string | null;
  /** The calm line once the wait has run long. Null before that. */
  stillWorking: string | null;
  /** The steps of multi-step work, with the current one marked. Null for work with no steps. */
  steps: ProgressStep[] | null;
};

/** The steps of multi-step work: their titles in order, and which one is under way. */
export type WaitingSteps = { titles: readonly string[]; current: number };

function stepList({ titles, current }: WaitingSteps): ProgressStep[] {
  return titles.map((title, index) => ({
    key: String(index),
    title,
    status: index < current ? "done" : index === current ? "current" : "waiting",
  }));
}

/**
 * What to show `elapsedMs` into a wait of `kind`: nothing at first, then a
 * quiet signal, then the "still working" line. A pure function of the time
 * passed: each platform owns the clock and calls this as it ticks. Steps are
 * shown from the start, since they say what is happening, not that it is slow.
 */
export function waitingView(
  elapsedMs: number,
  kind: WaitingKind,
  steps?: WaitingSteps,
): WaitingView {
  const shown = elapsedMs >= WAITING_DELAY_MS;
  return {
    signal: !shown ? "none" : kind === "content" ? "placeholder" : "indicator",
    label: shown ? waitingCopy.label[kind] : null,
    stillWorking: elapsedMs >= STILL_WORKING_AFTER_MS[kind] ? waitingCopy.stillWorking[kind] : null,
    steps: steps ? stepList(steps) : null,
  };
}

export type ImportWaitingView = WaitingView & { title: string; lead: string };

/**
 * An import under way: the phrase is already read, the lookup is running,
 * and after a while the list moves to its last step. Its own slow line says
 * why a wallet with many portfolios takes longer.
 */
export function importWaitingView(
  elapsedMs: number,
  platform: AppPlatform = "web",
): ImportWaitingView {
  const copy = onboardingCopy.import.progress;
  const words = platform === "mobile" ? { ...copy, ...mobileOnboardingCopy.import.progress } : copy;
  const view = waitingView(elapsedMs, "action", {
    titles: copy.steps,
    current: elapsedMs >= IMPORT_LAST_STEP_AFTER_MS ? 2 : 1,
  });
  return {
    ...view,
    title: words.title,
    lead: words.lead,
    stillWorking: view.stillWorking && words.slow,
  };
}

/** What an import that could not finish says. Nothing was saved. */
export function importFailedText(platform: AppPlatform = "web"): string {
  return platform === "mobile"
    ? mobileOnboardingCopy.import.progress.failed
    : onboardingCopy.import.progress.failed;
}
