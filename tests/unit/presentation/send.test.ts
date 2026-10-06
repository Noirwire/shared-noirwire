import { describe, expect, it } from "vitest";
import { FUNDING } from "../../../src/application/pendingActions.js";
import { sendDraft, type SendInput } from "../../../src/application/send.js";
import {
  sendFormView,
  sendRecipientRefusal,
  sendResultView,
  sendReviewView,
  sendSourceView,
  type SendFormState,
  type SendReviewState,
} from "../../../src/presentation/send.js";
import {
  FUNDING_ADDRESS,
  PORTFOLIO_ADDRESS,
  READ,
  testReads,
  testWallet,
} from "../support/screens.js";

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
    network: "Solana",
    balances: READ,
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
    network: "Solana",
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
      /^Real transfer on Solana, straight from this portfolio's own USDC balance/,
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

describe("sending from the main wallet", () => {
  const reads = testReads();
  const wallet = testWallet((w) => ({
    ...w,
    funding: { ...w.funding, sol: 0.5, tokens: { USDC: 25, NVDAx: 4 } },
    portfolios: [
      {
        ...w.portfolios[0],
        holdings: [
          { symbol: "USDC", amount: 40, cost: 40 },
          { symbol: "NVDAx", amount: 2, cost: 150 },
          { symbol: "SOL", amount: 0.1, cost: 10 },
        ],
      },
    ],
  }));
  const source = sendSourceView(reads, wallet, FUNDING)!;

  it("is a source of its own: its title, its address, and its USDC and SOL only", () => {
    expect(source).toEqual({
      title: "Send from main wallet",
      name: "your main wallet",
      ownAddress: FUNDING_ADDRESS,
      archived: false,
      assets: [
        { symbol: "USDC", label: "Cash", held: 25 },
        { symbol: "SOL", label: "SOL", held: 0.5 },
      ],
      empty: "Your main wallet is empty.",
      funding: { ownPortfolios: [PORTFOLIO_ADDRESS] },
    });
    expect(sendSourceView(reads, testWallet(), FUNDING)?.assets).toEqual([]);
  });

  it("leaves a portfolio as the source it was, by platform", () => {
    expect(sendSourceView(reads, wallet, "acc_1")).toEqual({
      title: "Send from portfolio",
      name: "Investing",
      ownAddress: PORTFOLIO_ADDRESS,
      archived: false,
      assets: [
        { symbol: "USDC", label: "Cash", held: 40 },
        { symbol: "NVDAx", label: "NVDAx", held: 2 },
      ],
      empty: "This portfolio is empty.",
    });
    expect(sendSourceView(reads, wallet, "acc_1", "mobile")?.title).toBe("Send from Investing");
    expect(sendSourceView(reads, wallet, "nope")).toBeNull();
  });

  it("will not review a send to one of the person's own portfolios, and says to use Move to portfolio", () => {
    const toOwn = form(
      { funding: source.funding, ownAddress: FUNDING_ADDRESS, destination: PORTFOLIO_ADDRESS },
      { ownAddress: FUNDING_ADDRESS, destination: PORTFOLIO_ADDRESS },
    );
    expect(toOwn.recipientError).toBe(
      "This address is one of your own portfolios. Use Move to portfolio, which keeps the portfolio separate from your main wallet.",
    );
    expect(toOwn.canReview).toBe(false);
    expect(toOwn.review.disabled).toBe(true);
    // The same address from a portfolio is reviewed, with its link warning, as before.
    expect(
      form({ destination: PORTFOLIO_ADDRESS }, { destination: PORTFOLIO_ADDRESS }),
    ).toMatchObject({ recipientError: null, canReview: true });
    expect(sendRecipientRefusal({ recipient: "ownPortfolio" })).toBe(toOwn.recipientError);
  });

  it("speaks of the main wallet, not of a portfolio, in the form", () => {
    const view = form({ funding: source.funding });
    expect(view.canReview).toBe(true);
    expect(view.explainer).toMatch(
      /^A real transfer on Solana, straight from your main wallet to the recipient\./,
    );
    expect(
      form(
        { funding: source.funding, ownAddress: FUNDING_ADDRESS, destination: FUNDING_ADDRESS },
        { ownAddress: FUNDING_ADDRESS, destination: FUNDING_ADDRESS },
      ).recipientError,
    ).toBe("Choose an address other than your main wallet's own.");
    expect(form({ funding: source.funding }, { amountText: "500" }).amountError).toBe(
      "More than your main wallet holds",
    );
    const onPhone = form({ funding: source.funding, platform: "mobile" });
    expect(JSON.stringify(onPhone)).not.toMatch(/this portfolio/i);
  });

  it("says who pays the network cost in the review, and where the money for it comes from", () => {
    expect(review({ fromFunding: true, sendAmount: 9.96 }).cashNote).toBe(
      "0.04 USDC from your main wallet pays the network cost, so 9.96 USDC is sent, not 10.00 USDC.",
    );
    const ownSol = review({ fromFunding: true, cost: { kind: "ownSol", usd: 0.2 } });
    expect(ownSol.terms.at(-1)).toEqual({
      label: "Network cost",
      value: "about 0.20 USD, paid from your main wallet's SOL balance",
    });
    expect(ownSol.confirm.disabled).toBe(false);
    const relayed = review({
      fromFunding: true,
      cost: { kind: "relayer", fee: 0.02, feeRaw: 20_000n, opens: null, count: 1 },
    });
    expect(relayed.networkCost.details?.body).toBe(
      "Every action has a small network cost. NoirWire's relayer pays it, and your main wallet pays the relayer back exactly 0.020000 USDC, from its USDC, in the same transaction. The cost moves with the market: if it has risen by the time you confirm, nothing is sent and you are shown the new cost first. A transaction paid this way shows publicly that your main wallet uses NoirWire. It does not show your portfolios.",
    );
    const short = review({
      fromFunding: true,
      cost: { kind: "needsCash", cash: 0.04, free: 0.01 },
    });
    expect(short.needsCash).toEqual({
      text: "Your main wallet needs at least 0.04 USDC to pay the network cost, and would have 0.01 USDC to spare.",
      action: "Add money",
    });
    expect(short.confirm.disabled).toBe(true);
    // A portfolio's review is worded as it was.
    expect(review({ cost: { kind: "needsCash", cash: 0.04, free: 0.01 } }).needsCash?.action).toBe(
      "Move to portfolio",
    );
  });

  it("names SOL as an asset on the phone, and says how it ended in the main wallet's name", () => {
    const sol = review({ fromFunding: true, symbol: "SOL", platform: "mobile" });
    expect(sol.terms[0]).toEqual({ label: "Asset", value: "SOL" });
    expect(sol.terms.at(-1)?.value).toBe("0.000005 SOL, on top of the amount");
    expect(sendResultView("landed", "10.00 USDC", source.name).body).toBe(
      "To the address you entered. It has left your main wallet.",
    );
    expect(sendResultView("unknown", "10.00 USDC", source.name).body).toBe(
      "This was sent but could not be confirmed. It may still go through. Check your main wallet's balance before trying again.",
    );
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
      { label: "Network", value: "Solana" },
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

  it("warns about linking the portfolio to the main wallet or another portfolio", () => {
    expect(
      review({ recipient: { kind: "own", which: "funding", label: "Funding" } }).linkWarning,
    ).toEqual({
      title: "This links the two addresses publicly.",
      body: "Anyone can then see that this portfolio and your main wallet belong to the same person.",
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
