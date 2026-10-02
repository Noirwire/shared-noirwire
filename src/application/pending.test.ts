import { describe, expect, it } from "vitest";
import {
  LONGEST_VALID_MS,
  NO_PENDING_ACTION,
  canConfirm,
  isUnsettled,
  pendingReducer,
  type PendingAction,
  type PendingEvent,
} from "./pending.js";

const INTENT = "portfolio-1";
const SENT_AT = 1_000_000;

const submitted: PendingAction = {
  status: "submitted",
  intent: INTENT,
  signature: "sig",
  lastValidBlockHeight: 500,
};
const landed: PendingAction = { status: "landed", intent: INTENT };
const expired: PendingAction = { status: "expired", intent: INTENT };

function unknown(receipt: { signature?: string; lastValidBlockHeight?: number } = {}) {
  return pendingReducer(NO_PENDING_ACTION, {
    type: "sentUnseen",
    intent: INTENT,
    now: SENT_AT,
    ...receipt,
  });
}

function checked(reading: Omit<Extract<PendingEvent, { type: "chainChecked" }>, "type" | "now">) {
  return { type: "chainChecked", now: SENT_AT + 1, ...reading } as const;
}

describe("sending", () => {
  it("records a submitted action with its signature and last valid height", () => {
    expect(
      pendingReducer(NO_PENDING_ACTION, {
        type: "submitted",
        intent: INTENT,
        signature: "sig",
        lastValidBlockHeight: 500,
      }),
    ).toEqual(submitted);
  });

  it("records an action sent without a receipt as unknown, with when it was sent", () => {
    expect(unknown()).toEqual({ status: "unknown", intent: INTENT, sentAt: SENT_AT });
    expect(unknown({ signature: "sig", lastValidBlockHeight: 500 })).toEqual({
      status: "unknown",
      intent: INTENT,
      signature: "sig",
      lastValidBlockHeight: 500,
      sentAt: SENT_AT,
    });
  });

  it.each([submitted, unknown()])("ignores a second send while $status", (pending) => {
    const again = { intent: INTENT, signature: "other", lastValidBlockHeight: 900 };
    expect(pendingReducer(pending, { type: "submitted", ...again })).toBe(pending);
    expect(pendingReducer(pending, { type: "sentUnseen", ...again, now: 5 })).toBe(pending);
  });

  it.each([landed, expired])("starts afresh from $status", (settled) => {
    const next = pendingReducer(settled, {
      type: "submitted",
      intent: INTENT,
      signature: "next",
      lastValidBlockHeight: 900,
    });
    expect(next).toMatchObject({ status: "submitted", signature: "next" });
  });
});

describe("settling a submitted action", () => {
  it("lands when the chain shows the signature confirmed", () => {
    expect(pendingReducer(submitted, checked({ signatureStatus: "confirmed" }))).toEqual(landed);
  });

  it("lands when confirmed, even past its last valid height", () => {
    expect(
      pendingReducer(submitted, checked({ signatureStatus: "confirmed", finalizedHeight: 900 })),
    ).toEqual(landed);
  });

  it("expires when the chain shows it failed", () => {
    expect(pendingReducer(submitted, checked({ signatureStatus: "failed" }))).toEqual(expired);
  });

  it("expires when it is not on chain and the finalized height has passed its last valid one", () => {
    expect(
      pendingReducer(submitted, checked({ signatureStatus: "notFound", finalizedHeight: 501 })),
    ).toEqual(expired);
  });

  it("stays submitted while it could still land", () => {
    const stillValid = checked({ signatureStatus: "notFound", finalizedHeight: 500 });
    expect(pendingReducer(submitted, stillValid)).toBe(submitted);
    expect(pendingReducer(submitted, checked({ signatureStatus: "notFound" }))).toBe(submitted);
  });

  it("does not expire on height alone when the signature could not be looked up", () => {
    expect(pendingReducer(submitted, checked({ finalizedHeight: 900 }))).toBe(submitted);
  });

  it("does not expire on the clock: it has a height to wait for", () => {
    const muchLater = {
      type: "chainChecked",
      signatureStatus: "notFound",
      now: SENT_AT + LONGEST_VALID_MS * 10,
    } as const;
    expect(pendingReducer(submitted, muchLater)).toBe(submitted);
  });

  it("lands when its effect is seen in the balances", () => {
    expect(pendingReducer(submitted, { type: "effectObserved" })).toEqual(landed);
  });
});

describe("settling an action sent without a full receipt", () => {
  it("settles by signature when it has one", () => {
    const pending = unknown({ signature: "sig" });
    expect(pendingReducer(pending, checked({ signatureStatus: "confirmed" }))).toEqual(landed);
    expect(pendingReducer(pending, checked({ signatureStatus: "failed" }))).toEqual(expired);
  });

  it("ignores a signature status when it has no signature to match it", () => {
    const pending = unknown();
    expect(pendingReducer(pending, checked({ signatureStatus: "confirmed" }))).toBe(pending);
  });

  it("expires by height alone when it has a last valid height and no signature", () => {
    const pending = unknown({ lastValidBlockHeight: 500 });
    expect(pendingReducer(pending, checked({ finalizedHeight: 500 }))).toBe(pending);
    expect(pendingReducer(pending, checked({ finalizedHeight: 501 }))).toEqual(expired);
  });

  it("expires by the clock only when it has no height to wait for", () => {
    const pending = unknown();
    const at = (now: number) => ({ type: "chainChecked", now }) as const;
    expect(pendingReducer(pending, at(SENT_AT + LONGEST_VALID_MS))).toBe(pending);
    expect(pendingReducer(pending, at(SENT_AT + LONGEST_VALID_MS + 1))).toEqual(expired);
  });

  it("waits for the signature lookup before the clock ends one that has a signature", () => {
    const pending = unknown({ signature: "sig" });
    const late = SENT_AT + LONGEST_VALID_MS + 1;
    expect(pendingReducer(pending, { type: "chainChecked", now: late })).toBe(pending);
    expect(
      pendingReducer(pending, { type: "chainChecked", signatureStatus: "notFound", now: late }),
    ).toEqual(expired);
  });

  it("lands when its effect is seen in the balances", () => {
    expect(pendingReducer(unknown(), { type: "effectObserved" })).toEqual(landed);
  });
});

describe("after settling", () => {
  it.each([landed, expired])("clears $status once acknowledged", (settled) => {
    expect(pendingReducer(settled, { type: "acknowledged" })).toEqual(NO_PENDING_ACTION);
  });

  it("cannot be acknowledged away while unsettled", () => {
    expect(pendingReducer(submitted, { type: "acknowledged" })).toBe(submitted);
  });

  it.each([NO_PENDING_ACTION, landed, expired])("ignores chain evidence when $status", (state) => {
    expect(pendingReducer(state, checked({ signatureStatus: "confirmed" }))).toBe(state);
    expect(pendingReducer(state, { type: "effectObserved" })).toBe(state);
  });
});

describe("canConfirm", () => {
  it("refuses the same intent while its last action is unsettled", () => {
    expect(canConfirm(submitted, INTENT)).toBe(false);
    expect(canConfirm(unknown(), INTENT)).toBe(false);
  });

  it("allows a different intent", () => {
    expect(canConfirm(submitted, "portfolio-2")).toBe(true);
  });

  it.each([NO_PENDING_ACTION, landed, expired])("allows the intent again when $status", (state) => {
    expect(canConfirm(state, INTENT)).toBe(true);
  });
});

describe("isUnsettled", () => {
  it("is true only while the action may still land", () => {
    const states = [NO_PENDING_ACTION, submitted, unknown(), landed, expired];
    expect(states.filter(isUnsettled).map((state) => state.status)).toEqual([
      "submitted",
      "unknown",
    ]);
  });
});
