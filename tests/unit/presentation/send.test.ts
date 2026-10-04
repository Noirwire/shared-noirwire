import { describe, expect, it } from "vitest";
import { sendDraft, type SendInput } from "../../../src/application/send.js";
import {
  sendFormView,
  sendReviewView,
  type SendFormState,
  type SendReviewState,
} from "../../../src/presentation/send.js";

const OWN = "OwnAddress1111111111111111111111111111111111";
const TO = "Recipient1111111111111111111111111111111WXYZ";

const input = (overrides: Partial<SendInput> = {}): SendInput => ({
  heldRaw: 100,
  unitsPerHeld: 1,
  amountText: "10",
  destination: TO,
  isAddress: true,
  offCurve: false,
  ownAddress: OWN,
  ...overrides,
});

const form = (overrides: Partial<SendFormState> = {}, draftInput: Partial<SendInput> = {}) => {
  const draft = sendDraft(input(draftInput));
  return sendFormView({
    draft,
    symbol: "USDC",
    heldRaw: 100,
    unitsPerHeld: 1,
    destination: TO,
    ownAddress: OWN,
    offCurve: false,
    offCurveMessage: "not a wallet",
    recipientTouched: true,
    amountTouched: true,
    archived: false,
    submitting: false,
    preparing: false,
    network: "Solana mainnet",
    ...overrides,
  });
};

const review = (overrides: Partial<SendReviewState> = {}, draftInput: Partial<SendInput> = {}) =>
  sendReviewView({
    draft: sendDraft(input(draftInput)),
    canReview: true,
    symbol: "USDC",
    unitsPerHeld: 1,
    destination: TO,
    sendAmount: 10,
    cost: { kind: "covered" },
    pricePerHeld: 1,
    recipient: { kind: "known" },
    checks: { checkedAddress: false, acceptedLink: false, lastFour: "" },
    pending: { blocked: false },
    submitting: false,
    network: "Solana mainnet",
    solFee: 0.000005,
    ...overrides,
  });

describe("sendDraft", () => {
  it("converts a typed amount into stored units by the multiplier", () => {
    expect(sendDraft(input({ heldRaw: 10, unitsPerHeld: 2, amountText: "4" }))).toMatchObject({
      held: 20,
      amount: 4,
      rawAmount: 2,
      sendingAll: false,
      validAmount: true,
    });
  });

  it("sends the exact stored amount when everything is sent", () => {
    expect(
      sendDraft(input({ heldRaw: 3, unitsPerHeld: 1 / 3, amountText: String(3 * (1 / 3)) })),
    ).toMatchObject({ sendingAll: true, rawAmount: 3 });
  });

  it("knows nothing about the amount while the multiplier is unknown", () => {
    expect(sendDraft(input({ unitsPerHeld: undefined }))).toMatchObject({
      multiplierKnown: false,
      held: 0,
      rawAmount: 0,
    });
  });

  it("rejects the portfolio's own address and addresses no key can sign for", () => {
    expect(sendDraft(input({ destination: OWN })).validRecipient).toBe(false);
    expect(sendDraft(input({ offCurve: true })).validRecipient).toBe(false);
    expect(sendDraft(input({ isAddress: false })).validRecipient).toBe(false);
    expect(sendDraft(input({ amountText: "-1" })).validAmount).toBe(false);
  });
});

describe("sendFormView", () => {
  it("can be reviewed when address and amount are right", () => {
    const view = form();
    expect(view).toMatchObject({
      recipientError: null,
      amountError: null,
      balanceUnavailable: null,
      canReview: true,
      reviewLabel: "Review",
      amountLine: "10.00 USDC · Available 100.00 USDC",
    });
    expect(view.explainer).toMatch(
      /^Real transfer on Solana mainnet, straight from this portfolio's own USDC balance/,
    );
  });

  it("says what is wrong with the address once it was touched", () => {
    expect(form({ destination: OWN }, { destination: OWN }).recipientError).toBe(
      "Choose an address other than this portfolio's own.",
    );
    expect(form({ offCurve: true }, { offCurve: true }).recipientError).toBe("not a wallet");
    expect(form({}, { isAddress: false }).recipientError).toBe("Enter a valid Solana address.");
    expect(form({ recipientTouched: false }, { isAddress: false }).recipientError).toBeNull();
  });

  it("says what is wrong with the amount, but only once the balance can be shown", () => {
    expect(form({}, { amountText: "500" }).amountError).toBe("More than this portfolio holds");
    expect(form({}, { amountText: "abc" }).amountError).toBe("Enter an amount, like 12.50.");
    const unknown = form({ unitsPerHeld: undefined }, { unitsPerHeld: undefined, amountText: "x" });
    expect(unknown.amountError).toBeNull();
    expect(unknown.balanceUnavailable).toBe(
      "This token's balance cannot be shown right now. Try again in a moment.",
    );
    expect(unknown.amountLine).toBe("Unavailable · Available Unavailable");
  });

  it("cannot be reviewed while archived, sending or preparing", () => {
    expect(form({ archived: true }).canReview).toBe(false);
    expect(form({ submitting: true }).canReview).toBe(false);
    const preparing = form({ preparing: true });
    expect(preparing.canReview).toBe(false);
    expect(preparing.reviewLabel).toBe("Checking...");
  });
});

describe("sendReviewView", () => {
  it("lists the terms, with the dollar value when there is a live price", () => {
    const view = review();
    expect(view.title).toBe("Review send");
    expect(view.recipient).toEqual({
      label: "Recipient address",
      aria: `Recipient address ${TO}`,
      head: TO.slice(0, 6),
      middle: TO.slice(6, -6),
      tail: TO.slice(-6),
    });
    expect(view.terms).toEqual([
      { label: "Asset", value: "USDC" },
      { label: "Amount", value: "10.00 USDC" },
      { label: "USD value", value: "$10.00" },
      { label: "Network", value: "Solana mainnet" },
      { label: "Network cost", value: "Covered" },
    ]);
    expect(review({ pricePerHeld: null }).terms.map((term) => term.label)).not.toContain(
      "USD value",
    );
  });

  it("states a SOL send's own fee, out of or on top of the amount", () => {
    const sol = { symbol: "SOL", cost: { kind: "covered" as const } };
    expect(review(sol).terms.at(-1)?.value).toBe("0.000005 SOL, on top of the amount");
    expect(review(sol, { amountText: "100" }).terms.at(-1)?.value).toBe(
      "0.000005 SOL, taken out of the amount",
    );
  });

  it("says when cash pays the cost and less is sent than was typed", () => {
    expect(review({ sendAmount: 9.96 }).cashNote).toBe(
      "0.04 USDC from this portfolio pays the network cost, so 9.96 USDC is sent, not 10.00 USDC.",
    );
    expect(review().cashNote).toBeNull();
  });

  it("warns about linking the portfolio to the funding wallet or another portfolio", () => {
    expect(
      review({ recipient: { kind: "own", which: "funding", label: "Funding" } }).linkWarning,
    ).toEqual({
      title: "This links the two addresses publicly.",
      body: "Anyone can then see that this portfolio and your funding wallet belong to the same person.",
      accept: "I understand this links them",
    });
    expect(
      review({ recipient: { kind: "own", which: "portfolio", label: "Savings" } }).linkWarning
        ?.body,
    ).toBe(
      "Anyone can then see that this portfolio and your other portfolio (Savings) belong to the same person.",
    );
  });

  it("warns about a first send and about a look-alike address", () => {
    expect(review({ recipient: { kind: "new" } }).firstTime).toBe(
      "First time sending to this address. Check every character against the source, not just the start and end.",
    );
    expect(
      review({ recipient: { kind: "lookalike", address: "Abc", label: "Mum" } }).lookalike,
    ).toEqual({
      title: "This address looks like one you have used before but is different.",
      previous: "Mum: ",
      address: "Abc",
      check: "Check every character against the source, not just the start and end.",
      confirm: "I have checked the full address",
    });
    expect(review({ recipient: { kind: "lookalike", address: "Abc" } }).lookalike?.previous).toBe(
      "Previous recipient: ",
    );
    expect(review().firstTime).toBeNull();
    expect(review().lookalike).toBeNull();
  });

  it("asks for the last four characters of a large send, or one of unknown value", () => {
    expect(review().lastFour).toBeNull();
    expect(review({ pricePerHeld: 200 }).lastFour?.label).toBe(
      "Type the last 4 characters of the recipient address to confirm this large send",
    );
    expect(review({ pricePerHeld: null }).lastFour?.label).toBe(
      "Type the last 4 characters of the recipient address to confirm this send",
    );
    expect(review({}, { amountText: "60" }).lastFour).not.toBeNull();
  });

  it("can be confirmed only once every check the review asks for is answered", () => {
    expect(review().confirm).toEqual({ label: "Send", disabled: false });
    expect(review({ canReview: false }).confirm.disabled).toBe(true);
    expect(review({ pending: { blocked: true } }).confirm.disabled).toBe(true);
    expect(review({ cost: { kind: "unavailable" } }).confirm.disabled).toBe(true);
    const lookalike = { kind: "lookalike" as const, address: "Abc" };
    expect(review({ recipient: lookalike }).confirm.disabled).toBe(true);
    expect(
      review({
        recipient: lookalike,
        checks: { checkedAddress: true, acceptedLink: false, lastFour: "" },
      }).confirm.disabled,
    ).toBe(false);
    const own = { kind: "own" as const, which: "funding" as const, label: "Funding" };
    expect(review({ recipient: own }).confirm.disabled).toBe(true);
    expect(
      review({
        recipient: own,
        checks: { checkedAddress: false, acceptedLink: true, lastFour: "" },
      }).confirm.disabled,
    ).toBe(false);
    expect(review({ pricePerHeld: 200 }).confirm.disabled).toBe(true);
    expect(
      review({
        pricePerHeld: 200,
        checks: { checkedAddress: false, acceptedLink: false, lastFour: "WXYZ" },
      }).confirm.disabled,
    ).toBe(false);
    expect(review({ submitting: true }).confirm).toEqual({
      label: "Sending...",
      disabled: true,
    });
  });
});
