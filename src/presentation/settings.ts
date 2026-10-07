import type { ProfileSyncStatus } from "../application/actions/syncProfile.js";
import { settingsCopy } from "../copy/settings.js";
import type { ChangeTone } from "../domain/format.js";

/**
 * The line under Settings' Privacy heading. It promises a control over usage
 * analytics only where the screen has one to offer.
 */
export function privacySectionHelp(state: { analyticsControl: boolean }): string {
  const { help, helpWithoutAnalytics } = settingsCopy.sections.privacy;
  return state.analyticsControl ? help : helpWithoutAnalytics;
}

/** The quiet row in Settings that says whether a wallet's labels are backed up. */
export type LabelsBackupView = {
  /** The colour of the row's dot, by the names the design tokens give their colours. */
  tone: ChangeTone;
  label: string;
  /** How it stands, in a word or two. */
  value: string;
  /** The sentence under it, or null while there is nothing more to say. */
  detail: string | null;
};

/**
 * What Settings shows of the labels' backup, or null when it shows nothing
 * at all: no sync has said anything since the unlock, or there is no backup
 * to speak of here.
 */
export function labelsBackupView(status: ProfileSyncStatus | null): LabelsBackupView | null {
  const { label, synced, syncing, behind } = settingsCopy.labelsBackup;
  switch (status?.kind) {
    case "synced":
      return { tone: "safe", label, ...synced };
    case "syncing":
      return { tone: "neutral", label, value: syncing.value, detail: null };
    case "behind":
      return { tone: "danger", label, ...behind };
    default:
      return null;
  }
}
