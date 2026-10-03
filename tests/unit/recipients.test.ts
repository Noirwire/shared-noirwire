import { describe, expect, it } from "vitest";
import { classifyRecipient } from "../../src/domain/recipients.js";

const funding = "Fund" + "a".repeat(32) + "Last";
const account = "Port" + "b".repeat(32) + "Tail";
const previous = "Prev" + "c".repeat(32) + "Done";
const wallet = {
  funding: { address: funding },
  portfolios: [{ address: account, label: "Portfolio 2" }],
  activity: [
    { kind: "fund", counterparty: "Unused" + "d".repeat(32) + "Addr" },
    { kind: "send", counterparty: previous },
    { kind: "send" },
  ],
};

describe("classifyRecipient", () => {
  it("recognizes the wallet's funding and account addresses", () => {
    expect(classifyRecipient(funding, wallet)).toEqual({
      kind: "own",
      label: "Funding wallet",
      which: "funding",
    });
    expect(classifyRecipient(account, wallet)).toEqual({
      kind: "own",
      label: "Portfolio 2",
      which: "portfolio",
    });
  });

  it("recognizes an exact previous send before checking similarity", () => {
    expect(classifyRecipient(previous, wallet)).toEqual({ kind: "known" });
  });

  it("flags a different address with the same first and last four characters", () => {
    expect(classifyRecipient("Prev" + "x".repeat(32) + "Done", wallet)).toEqual({
      kind: "lookalike",
      address: previous,
      label: undefined,
    });
    expect(classifyRecipient("Port" + "x".repeat(32) + "Tail", wallet)).toEqual({
      kind: "lookalike",
      address: account,
      label: "Portfolio 2",
    });
  });

  it("ignores non-send activity and returns new for an unrelated address", () => {
    expect(classifyRecipient("Unused" + "d".repeat(32) + "Addr", wallet)).toEqual({ kind: "new" });
    expect(classifyRecipient("Other" + "e".repeat(32) + "Addr", wallet)).toEqual({ kind: "new" });
    expect(classifyRecipient("anything", null)).toEqual({ kind: "new" });
  });
});

describe("three-character look-alikes", () => {
  it("flags an address matching only the first and last three characters", () => {
    const known = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
    const poisoned = "9WzQ3kPnaY7hLfDk2cVbRr8mUeTj6sWqGx4oBvNtKWWM";
    const wallet = {
      funding: { address: "11111111111111111111111111111111" },
      portfolios: [],
      activity: [{ kind: "send", counterparty: known }],
    };
    expect(classifyRecipient(poisoned, wallet)).toMatchObject({
      kind: "lookalike",
      address: known,
    });
  });
});
