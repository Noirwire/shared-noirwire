import { mobileOnboardingCopy, onboardingCopy } from "../copy/onboarding.js";
import type { AppPlatform } from "../domain/appPlatform.js";
import { MIN_PASSWORD_LENGTH } from "../domain/wallet.js";

export type NewPasswordView = {
  title: string;
  /** The rule, shown before anything is typed. Its number is the store's own minimum. */
  rule: string;
  forgotten: string;
};

/** Choosing the password that locks a new or imported wallet. */
export function newPasswordView(platform: AppPlatform = "web"): NewPasswordView {
  const copy = onboardingCopy.password;
  const intro = platform === "mobile" ? mobileOnboardingCopy.password.intro : copy.intro;
  return { title: copy.title, rule: intro(MIN_PASSWORD_LENGTH), forgotten: copy.forgotten };
}
