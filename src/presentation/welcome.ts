import { onboardingCopy } from "../copy/onboarding.js";
import type { AppPlatform } from "../domain/appPlatform.js";

export type WelcomeAction = {
  kind: "create" | "restore" | "explore";
  label: string;
  /** Only creating a wallet is a filled button; the others are quiet. */
  filled: boolean;
};

export type WelcomeView = {
  brand: string;
  title: string;
  lines: readonly string[];
  actions: WelcomeAction[];
  /** The one line under the actions. */
  trust: string;
  /** The web's example beside the column. The phone has no room for one. */
  example: {
    heading: string;
    badge: string;
    total: string;
    count: string;
    portfolios: readonly { label: string; detail: string; value: string }[];
    steps: readonly string[];
    footnote: string;
  } | null;
};

/** The first screen: what the app is for, the three ways in, and nothing about how it is built. */
export function welcomeView(platform: AppPlatform): WelcomeView {
  const copy = onboardingCopy.welcome;
  return {
    brand: copy.brand,
    title: copy.title,
    lines: copy.lines,
    actions: [
      { kind: "create", label: copy.create, filled: true },
      { kind: "restore", label: copy.restore, filled: false },
      { kind: "explore", label: copy.explore, filled: false },
    ],
    trust: copy.trust,
    example:
      platform === "mobile"
        ? null
        : {
            heading: copy.examplePortfolios,
            badge: copy.exampleBadge,
            total: copy.exampleTotal,
            count: copy.exampleCount,
            portfolios: copy.examples,
            steps: copy.steps,
            footnote: copy.footnote,
          },
  };
}
