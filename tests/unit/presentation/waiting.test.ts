import { describe, expect, it } from "vitest";
import {
  IMPORT_LAST_STEP_AFTER_MS,
  STILL_WORKING_AFTER_MS,
  WAIT_LIMIT_MS,
  WAITING_DELAY_MS,
  importFailedText,
  importWaitingView,
  waitingView,
  type WaitingKind,
} from "../../../src/presentation/waiting.js";

const KINDS: WaitingKind[] = ["content", "check", "review", "action"];

describe("waitingView", () => {
  it("names its thresholds", () => {
    expect(WAITING_DELAY_MS).toBe(300);
    expect(STILL_WORKING_AFTER_MS).toEqual({
      content: 4_000,
      check: 4_000,
      review: 4_000,
      action: 8_000,
    });
    expect(IMPORT_LAST_STEP_AFTER_MS).toBe(6_000);
  });

  it("names how long each kind of wait may run, well past its still-working line", () => {
    expect(WAIT_LIMIT_MS).toEqual({
      content: 20_000,
      check: 30_000,
      review: 30_000,
      action: 120_000,
    });
    for (const kind of KINDS) {
      expect(WAIT_LIMIT_MS[kind]).toBeGreaterThan(STILL_WORKING_AFTER_MS[kind]);
    }
  });

  it.each(KINDS)(
    "shows nothing for %s before the delay, so a quick wait never flickers",
    (kind) => {
      for (const elapsed of [0, WAITING_DELAY_MS - 1]) {
        expect(waitingView(elapsed, kind)).toEqual({
          signal: "none",
          label: null,
          stillWorking: null,
          steps: null,
        });
      }
    },
  );

  it("then shows a placeholder for content and an indicator for the rest", () => {
    expect(waitingView(WAITING_DELAY_MS, "content")).toEqual({
      signal: "placeholder",
      label: "Loading",
      stillWorking: null,
      steps: null,
    });
    expect(waitingView(WAITING_DELAY_MS, "check")).toMatchObject({
      signal: "indicator",
      label: "Checking...",
    });
    expect(waitingView(1_000, "review")).toMatchObject({
      signal: "indicator",
      label: "Preparing your review...",
    });
    expect(waitingView(1_000, "action")).toMatchObject({
      signal: "indicator",
      label: "Working on it...",
    });
  });

  it.each(KINDS)("says it is still working on %s only once its threshold has passed", (kind) => {
    const after = STILL_WORKING_AFTER_MS[kind];
    expect(waitingView(after - 1, kind).stillWorking).toBeNull();
    expect(waitingView(after, kind).stillWorking).toMatch(/^Still /);
  });

  it("says what a long wait means in the person's terms", () => {
    expect(waitingView(4_000, "content").stillWorking).toBe(
      "Still loading. This is taking longer than usual.",
    );
    expect(waitingView(4_000, "check").stillWorking).toBe(
      "Still checking. This is taking longer than usual.",
    );
    expect(waitingView(4_000, "review").stillWorking).toBe(
      "Still preparing your review. Nothing has been sent.",
    );
    expect(waitingView(8_000, "action").stillWorking).toBe(
      "Still working. You can leave this open; nothing more is needed from you.",
    );
  });

  it("marks which step of multi-step work is under way, from the start", () => {
    const titles = ["Opening the holding", "Placing the order", "Reading the new balance"];
    expect(waitingView(0, "action", { titles, current: 1 }).steps).toEqual([
      { key: "0", title: "Opening the holding", status: "done" },
      { key: "1", title: "Placing the order", status: "current" },
      { key: "2", title: "Reading the new balance", status: "waiting" },
    ]);
    expect(
      waitingView(0, "action", { titles, current: 0 }).steps?.map((step) => step.status),
    ).toEqual(["current", "waiting", "waiting"]);
  });

  it("is the same for the same input", () => {
    expect(waitingView(5_000, "review")).toEqual(waitingView(5_000, "review"));
  });
});

describe("importWaitingView", () => {
  const statuses = (elapsed: number) => importWaitingView(elapsed).steps?.map((s) => s.status);

  it("has read the phrase and is finding portfolios, then moves to the last step", () => {
    expect(importWaitingView(0).steps?.map((step) => step.title)).toEqual([
      "Reading your recovery phrase",
      "Finding your portfolios",
      "Getting everything ready",
    ]);
    expect(statuses(0)).toEqual(["done", "current", "waiting"]);
    expect(statuses(IMPORT_LAST_STEP_AFTER_MS - 1)).toEqual(["done", "current", "waiting"]);
    expect(statuses(IMPORT_LAST_STEP_AFTER_MS)).toEqual(["done", "done", "current"]);
  });

  it("says what is happening and about how long it takes, under the button, from the start", () => {
    const note = "Checking what this phrase holds. This can take up to a minute.";
    expect(importWaitingView(0).note).toBe(note);
    expect(importWaitingView(15_000, "mobile").note).toBe(note);
  });

  it("says why a long import is long, once it is", () => {
    expect(importWaitingView(7_999).stillWorking).toBeNull();
    expect(importWaitingView(8_000).stillWorking).toBe(
      "Still working. A wallet with many portfolios takes a little longer.",
    );
  });

  it("speaks of a tab on the web and of the app on the phone", () => {
    expect(importWaitingView(0)).toMatchObject({
      title: "Importing your wallet",
      lead: "Keep this tab open. This can take up to a minute.",
    });
    expect(importWaitingView(0, "mobile")).toMatchObject({
      title: "Importing your wallet",
      lead: "Keep the app open. This can take up to a minute.",
    });
  });

  it("says nothing was saved when it could not finish", () => {
    expect(importFailedText()).toBe(
      "We couldn't finish importing your wallet. Nothing was saved in this browser. Try again.",
    );
    expect(importFailedText("mobile")).toBe(
      "We couldn't finish importing your wallet. Nothing was saved on this phone. Try again.",
    );
  });
});
