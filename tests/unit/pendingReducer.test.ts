import { describe, expect, it } from "vitest";
import { pendingReducer, userClearable, type PendingEvent } from "../../src/application/pending.js";
import type { PendingAction } from "../../src/domain/wallet.js";

const reserve: PendingEvent = { type: "reserve", id: "act_1", at: 1, what: "a send" };
const reserved = pendingReducer(undefined, reserve)!;
const run = (...events: PendingEvent[]) =>
  events.reduce<PendingAction | undefined>(pendingReducer, reserved);

describe("the life of a pending action", () => {
  it("is reserved before anything is signed, and only once", () => {
    expect(reserved).toEqual({ status: "reserved", id: "act_1", at: 1, what: "a send" });
    expect(pendingReducer(reserved, { ...reserve, id: "act_2" })).toBe(reserved);
  });

  it("becomes unknown the moment a transaction of it is signed, replaced by a later one", () => {
    expect(
      run(
        { type: "signed", signature: "first", blockhash: "h1", lastValidBlockHeight: 10 },
        { type: "signed", blockhash: "h2" },
      ),
    ).toEqual({ status: "unknown", id: "act_1", at: 1, what: "a send", blockhash: "h2" });
  });

  it("is submitted once accepted with a block height to settle it by, and unknown without one", () => {
    expect(
      run(
        { type: "signed", blockhash: "h", lastValidBlockHeight: 10 },
        { type: "submitted", signature: "s" },
      ),
    ).toMatchObject({ status: "submitted", signature: "s", lastValidBlockHeight: 10 });
    expect(run({ type: "submitted", signature: "s" })).toMatchObject({
      status: "unknown",
      signature: "s",
    });
  });

  it("keeps what an unknown outcome says, over what was known before", () => {
    expect(
      run(
        { type: "signed", blockhash: "h", signature: "a" },
        { type: "outcomeUnknown", lastValidBlockHeight: 9 },
      ),
    ).toMatchObject({ status: "unknown", signature: "a", lastValidBlockHeight: 9, blockhash: "h" });
  });

  it("ends when released or when the chain shows it landed or expired, and not otherwise", () => {
    expect(run({ type: "released" })).toBeUndefined();
    const sent = run({ type: "outcomeUnknown", signature: "s", lastValidBlockHeight: 9 });
    expect(pendingReducer(sent, { type: "chainChecked", outcome: "landed" })).toBeUndefined();
    expect(pendingReducer(sent, { type: "chainChecked", outcome: "expired" })).toBeUndefined();
    expect(pendingReducer(sent, { type: "chainChecked", outcome: "pending" })).toBe(sent);
    expect(pendingReducer(sent, { type: "chainChecked", outcome: "unknown" })).toBe(sent);
  });

  it("is cleared by the user only when there is no block height or blockhash to settle it by", () => {
    const withHeight = run({ type: "outcomeUnknown", lastValidBlockHeight: 9 })!;
    expect(userClearable(withHeight)).toBe(false);
    expect(pendingReducer(withHeight, { type: "userCleared" })).toBe(withHeight);
    const withHash = run({ type: "signed", blockhash: "h" })!;
    expect(pendingReducer(withHash, { type: "userCleared" })).toBe(withHash);
    expect(
      pendingReducer(run({ type: "outcomeUnknown" }), { type: "userCleared" }),
    ).toBeUndefined();
  });

  it("ignores every event but a reservation when there is nothing pending", () => {
    expect(pendingReducer(undefined, { type: "released" })).toBeUndefined();
    expect(pendingReducer(undefined, { type: "signed", blockhash: "h" })).toBeUndefined();
  });
});
