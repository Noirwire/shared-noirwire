import { settingsCopy } from "../copy/settings.js";

/**
 * The line under Settings' Privacy heading. It promises a control over usage
 * analytics only where the screen has one to offer.
 */
export function privacySectionHelp(state: { analyticsControl: boolean }): string {
  const { help, helpWithoutAnalytics } = settingsCopy.sections.privacy;
  return state.analyticsControl ? help : helpWithoutAnalytics;
}
