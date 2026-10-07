import { describe, expect, it } from "vitest";
import type { ProfileSyncStatus } from "../../../src/application/actions/syncProfile.js";
import { labelsBackupView } from "../../../src/presentation/settings.js";

describe("the labels backup row in Settings", () => {
  it("is not shown at all before a first sync, or where there is no backup to speak of", () => {
    expect(labelsBackupView(null)).toBeNull();
    expect(labelsBackupView({ kind: "off" })).toBeNull();
  });

  it("gives each state it does show its own dot, and no two states the same words", () => {
    const shown: ProfileSyncStatus[] = [
      { kind: "synced", at: 1 },
      { kind: "syncing" },
      { kind: "behind" },
    ];
    const views = shown.map((status) => labelsBackupView(status)!);
    expect(views.map((view) => view.tone)).toEqual(["safe", "neutral", "danger"]);
    expect(new Set(views.map((view) => view.value)).size).toBe(3);
    expect(new Set(views.map((view) => view.label)).size).toBe(1);
    // A sync under way has nothing more to say yet; the two that ended explain themselves.
    expect(views.map((view) => view.detail === null)).toEqual([false, true, false]);
  });
});
