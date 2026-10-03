import { plural } from "./plural.js";

const keysStay =
  "Your keys and recovery phrase stay in this browser. Network requests are relayed by NoirWire's server, which stores and logs nothing.";

/** Creating a wallet or importing one, up to the password that seals it. */
export const onboardingCopy = {
  firstPortfolioLabel: "Investing",
  /** The name a portfolio gets when it is made or found for the user rather than by them. */
  portfolioLabel: (position: number) => `Portfolio ${position}`,

  welcome: {
    brand: "NoirWire",
    title: "Keep your investing separate from your everyday wallet.",
    lead: "Each portfolio is its own address. Fund it through the private route and nothing on chain ties it to your funding wallet. The trades themselves still happen in public.",
    create: "Create my wallet",
    import: "Import an existing wallet",
    lookAround: "Look around first",
    trustMainnet: `${keysStay} Tracker issuers keep control over their own tokens. The risks are set out in Settings.`,
    trustTestNetwork: `${keysStay} Keys are real; funds are Solana devnet SOL and a test USDC-alike token.`,
    examplePortfolios: "Your portfolios",
    exampleBadge: "Example",
    exampleTotal: "$2,584.78",
    exampleCount: "2 portfolios",
    examples: [
      { label: "Investing", detail: "S&P 500 tracker", value: "$1,842.60" },
      { label: "Long term", detail: "Apple tracker", value: "$742.18" },
    ],
    steps: [
      "One recovery phrase for the whole wallet",
      "A separate address for each portfolio",
      "Add USDC, then invest in stock trackers",
    ],
    footnote:
      "Labels stay local. Public activity stays visible. Ownership links are not published by NoirWire.",
  },

  phrase: {
    title: "Write these twelve words down.",
    intro:
      "These words are the only way back into your money if this device is lost. Write them on paper. Anyone who sees them can take everything.",
    copyDescribe: "Copy recovery phrase",
    saved: "I have saved these words for the next step.",
    neverAsked:
      "NoirWire never asks for these words. Nobody from NoirWire will ever ask you for them.",
    reveal: "Reveal phrase",
    hidden: "••••••",
  },

  confirm: {
    title: "Confirm your phrase",
    intro:
      "Pick the word at each position from your saved list. A wrong pick takes you back to the phrase, and the positions asked for change each time.",
    missed:
      "Not that one. Go back to your phrase, check what you wrote down, and try again with new positions.",
    question: (step: number, total: number) => `Question ${step} of ${total}`,
    whichWord: (position: number) => `Which word is number ${position}?`,
    backToPhrase: "Back to the phrase",
  },

  import: {
    title: "Import an existing wallet.",
    intro:
      "Paste the 12- or 24-word recovery phrase from another wallet. It stays in this browser and is checked against the Solana network only to find its real balance.",
    phraseLabel: "Recovery phrase",
    phrasePlaceholder: "word1 word2 word3 ...",
    wordCount: (count: number) => (count > 0 ? plural(count, "word") : "12 or 24 words"),
    networkFailed: "Could not reach the network to check balances. Try again.",
    checking: "Checking balances and recovering portfolios onchain...",
    submit: "Import wallet",
    testNetworkOnly: "Devnet SOL only. ",
    twoSets:
      "A phrase can open two different sets of addresses. Both are checked for SOL, tokens and portfolios, and you choose when the chain cannot tell which one you mean.",
    schemes: {
      app: "NoirWire addresses",
      walletDefault: "Addresses most other wallets use",
    },
    chooseTitle: "Choose which addresses to open.",
    chooseIntro: (bothActive: boolean) =>
      `This phrase can open two different sets of addresses, because wallet apps do not all turn a phrase into addresses the same way. ${
        bothActive
          ? "Both sets have been used, so choose the one you mean to open here."
          : "Neither set shows anything onchain yet. If this phrase comes from another wallet app, such as Phantom or Solflare, choose the second. If it was created in NoirWire, choose the first."
      }`,
    schemeFunding: (address: string, found: string) => `Funding wallet ${address} · ${found}`,
    nothingFound: "Nothing found onchain",
    tokenBalances: "Token balances",
    portfolios: (count: number) => plural(count, "portfolio"),
    reunitedTitle: "Wallet reunited with its funds.",
    importedTitle: "Wallet imported.",
    reunitedIntro: (address: string, found: string) =>
      `Opened the funding wallet at ${address}. Found: ${found}.`,
    importedIntro: (address: string) =>
      `Nothing was found onchain for these addresses yet. The funding wallet is at ${address}. Fund it whenever you're ready.`,
    discovered: (count: number) =>
      `Found ${plural(count, "portfolio")} this phrase already had onchain.`,
    otherSet: "Open the other set instead",
  },

  password: {
    title: "Set a password",
    intro:
      "Your recovery phrase is encrypted with this password before it is stored. We never see it and it is never sent anywhere. Anyone who copies this browser's data can try to guess it, so it has to be hard to guess.",
    forgotten:
      "If you forget this password, your recovery phrase still opens your wallet. Without the phrase, nobody can.",
    encryptFailed: "Could not encrypt the wallet. Try again.",
    encrypting: "Encrypting...",
    finish: "Encrypt and finish",
  },
} as const;
