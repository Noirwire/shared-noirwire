import { describe, expect, it } from "vitest";
import {
  NO_PENDING_ACTION,
  canReserve,
  isUnsettled,
  pendingReducer,
  type PendingAction,
  type PendingEvent,
} from "./pending.js";

const reserved: PendingAction = { status: "reserved" };
const submitted: PendingAction = {
  status: "submitted",
  signature: "sig",
  lastValidBlockHeight: 500,
};
const landed: PendingAction = { status: "landed", signature: "sig" };
const expired: PendingAction = { status: "expired" };
const unknownBare: PendingAction = { status: "unknown" };
const unknownWithHeight: PendingAction = { status: "unknown", lastValidBlockHeight: 500 };
const unknownWithSignature: PendingAction = { status: "unknown", signature: "sig" };

const ALL = [
  NO_PENDING_ACTION,
  reserved,
  submitted,
  unknownBare,
  unknownWithHeight,
  unknownWithSignature,
  landed,
  expired,
];

const chain = (reading: Omit<Extract<PendingEvent, { type: "chainChecked" }>, "type">) =>
  ({ type: "chainChecked", ...reading }) as const;

function apply(pending: PendingAction, ...events: PendingEvent[]) {
  return events.reduce(pendingReducer, pending);
}

describe("reserving", () => {
  it.each([NO_PENDING_ACTION, landed, expired])("reserves from $status", (pending) => {
    expect(pendingReducer(pending, { type: "reserve" })).toEqual(reserved);
  });

  it.each([reserved, submitted, unknownBare, unknownWithSignature])(
    "refuses to reserve again while $status, returning the same state",
    (pending) => {
      expect(pendingReducer(pending, { type: "reserve" })).toBe(pending);
    },
  );

  it("is allowed exactly when the last action has settled", () => {
    expect(ALL.filter(canReserve).map((state) => state.status)).toEqual([
      "none",
      "landed",
      "expired",
    ]);
  });
});

describe("leaving a reservation", () => {
  it("records the exact transaction once it is sent", () => {
    expect(
      pendingReducer(reserved, { type: "submitted", signature: "sig", lastValidBlockHeight: 500 }),
    ).toEqual(submitted);
  });

  it("clears only for a failure certain to be before anything left the device", () => {
    expect(pendingReducer(reserved, { type: "releasedBeforeSend" })).toEqual(NO_PENDING_ACTION);
    for (const state of [submitted, unknownBare]) {
      expect(pendingReducer(state, { type: "releasedBeforeSend" })).toBe(state);
    }
  });

  it("becomes unknown for any later failure, keeping whatever receipt there is", () => {
    expect(pendingReducer(reserved, { type: "outcomeUnknown" })).toEqual(unknownBare);
    expect(pendingReducer(reserved, { type: "outcomeUnknown", signature: "sig" })).toEqual(
      unknownWithSignature,
    );
    expect(pendingReducer(submitted, { type: "outcomeUnknown" })).toEqual({
      status: "unknown",
      signature: "sig",
      lastValidBlockHeight: 500,
    });
  });

  it("accepts a submission only from a reservation", () => {
    const event = { type: "submitted", signature: "x", lastValidBlockHeight: 9 } as const;
    for (const state of [NO_PENDING_ACTION, submitted, unknownBare, landed, expired]) {
      expect(pendingReducer(state, event)).toBe(state);
    }
  });
});

describe("settling a submitted action from the chain", () => {
  it("lands when the signature is confirmed, even past its last valid height", () => {
    expect(pendingReducer(submitted, chain({ signatureStatus: "confirmed" }))).toEqual(landed);
    expect(
      pendingReducer(submitted, chain({ signatureStatus: "confirmed", blockHeight: 900 })),
    ).toEqual(landed);
  });

  it("expires when the chain shows it failed", () => {
    expect(pendingReducer(submitted, chain({ signatureStatus: "failed" }))).toEqual(expired);
  });

  it("expires when the signature is not found and the block height is past its last valid one", () => {
    expect(
      pendingReducer(submitted, chain({ signatureStatus: "notFound", blockHeight: 501 })),
    ).toEqual(expired);
  });

  it("stays while it could still land", () => {
    for (const reading of [
      { signatureStatus: "notFound", blockHeight: 500 },
      { signatureStatus: "notFound" },
      { blockHeight: 900 },
      {},
    ] as const) {
      expect(pendingReducer(submitted, chain(reading))).toBe(submitted);
    }
  });

  it("lands when its effect shows in the balances", () => {
    expect(pendingReducer(submitted, chain({ effect: "seen" }))).toEqual(landed);
  });
});

describe("settling an action whose outcome is unknown", () => {
  it("settles by signature when it has one", () => {
    expect(pendingReducer(unknownWithSignature, chain({ signatureStatus: "confirmed" }))).toEqual(
      landed,
    );
    expect(pendingReducer(unknownWithSignature, chain({ signatureStatus: "failed" }))).toEqual(
      expired,
    );
  });

  it("never expires a signature with no last valid height on chain evidence of absence", () => {
    const reading = chain({ signatureStatus: "notFound", blockHeight: 10 ** 9, effect: "absent" });
    expect(pendingReducer(unknownWithSignature, reading)).toBe(unknownWithSignature);
  });

  it("ignores a signature status when it has no signature of its own", () => {
    expect(pendingReducer(unknownBare, chain({ signatureStatus: "confirmed" }))).toBe(unknownBare);
  });

  it("with only a height, expires when the height has passed and the effect is absent", () => {
    expect(
      pendingReducer(unknownWithHeight, chain({ blockHeight: 501, effect: "absent" })),
    ).toEqual(expired);
    expect(pendingReducer(unknownWithHeight, chain({ blockHeight: 500, effect: "absent" }))).toBe(
      unknownWithHeight,
    );
    expect(pendingReducer(unknownWithHeight, chain({ blockHeight: 501 }))).toBe(unknownWithHeight);
  });

  it("lands when its effect shows in the balances", () => {
    expect(pendingReducer(unknownBare, chain({ effect: "seen" }))).toEqual({ status: "landed" });
  });

  it("with no block height, stays unknown whatever the chain or time says", () => {
    const readings = [
      chain({ blockHeight: 10 ** 9, effect: "absent" }),
      chain({}),
      chain({ blockHeight: 1 }),
    ];
    for (const reading of readings) expect(pendingReducer(unknownBare, reading)).toBe(unknownBare);
  });

  it("with no block height, is cleared only by the person", () => {
    expect(pendingReducer(unknownBare, { type: "userCleared" })).toEqual(NO_PENDING_ACTION);
    expect(pendingReducer(unknownWithSignature, { type: "userCleared" })).toEqual(
      NO_PENDING_ACTION,
    );
  });

  it("cannot be cleared by the person while there is a block height to wait for", () => {
    for (const state of [unknownWithHeight, submitted, reserved]) {
      expect(pendingReducer(state, { type: "userCleared" })).toBe(state);
    }
  });
});

describe("after settling", () => {
  it.each([landed, expired])("clears $status once acknowledged", (settled) => {
    expect(pendingReducer(settled, { type: "acknowledged" })).toEqual(NO_PENDING_ACTION);
  });

  it.each([reserved, submitted, unknownBare])("cannot acknowledge away $status", (state) => {
    expect(pendingReducer(state, { type: "acknowledged" })).toBe(state);
  });

  it.each([NO_PENDING_ACTION, reserved, landed, expired])(
    "ignores chain evidence when $status",
    (state) => {
      expect(pendingReducer(state, chain({ signatureStatus: "confirmed", effect: "seen" }))).toBe(
        state,
      );
    },
  );
});

describe("a whole life", () => {
  it("runs reserve, submit, land, acknowledge, and reserves again", () => {
    const end = apply(
      NO_PENDING_ACTION,
      { type: "reserve" },
      { type: "submitted", signature: "sig", lastValidBlockHeight: 500 },
      chain({ signatureStatus: "confirmed" }),
      { type: "acknowledged" },
      { type: "reserve" },
    );
    expect(end).toEqual(reserved);
  });

  it("marks exactly reserved, submitted and unknown as unsettled", () => {
    expect(ALL.filter(isUnsettled).map((state) => state.status)).toEqual([
      "reserved",
      "submitted",
      "unknown",
      "unknown",
      "unknown",
    ]);
  });
});
