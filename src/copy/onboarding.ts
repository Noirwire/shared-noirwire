import { plural } from "./plural.js";
import { notSaved } from "./wallet.js";

/** `where` is the platform's place for the keys: "in this browser" or "on this phone". */
const keysStay = (where: string) =>
  `Your keys and recovery phrase stay ${where}. Network requests go through NoirWire's own server, which keeps only a basic record that a request was made, not your address or what's in it.`;

/** `platformNoun` names the device: "device" on the web, "phone" on mobile. */
const onlyWayBack = (platformNoun: string) =>
  `These words are the only way back into your money if this ${platformNoun} is lost. Write them on paper. Anyone who sees them can take everything.`;

/** `keepOpen` is what must stay open while an import runs: "Keep this tab open." or "Keep the app open." */
const importLead = (keepOpen: string) => `${keepOpen} This usually takes a few seconds.`;

/** `where` is where nothing was saved: "in this browser" or "on this phone". */
const importFailed = (where: string) =>
  `We couldn't finish importing your wallet. Nothing was saved ${where}. Try again.`;

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

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
    trustMainnet: `${keysStay("in this browser")} Tracker issuers keep control over their own tokens. The risks are set out in Settings.`,
    trustTestNetwork: `${keysStay("in this browser")} Keys are real; funds are Solana devnet SOL and a test USDC-alike token.`,
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
    intro: onlyWayBack("device"),
    copyDescribe: "Copy recovery phrase",
    saved: "I have saved these words for the next step.",
    neverAsked:
      "NoirWire never asks for these words. Nobody from NoirWire will ever ask you for them.",
    reveal: "Reveal phrase",
    hidden: "••••••",
    /** A reload while the phrase was on screen: it was never saved, so the wallet gets a new one. */
    discarded:
      "This page was reloaded, so the recovery phrase you were shown before was discarded. It was never saved. A wallet created now gets a new phrase, and it has to be written down again.",
    newPhrase:
      "This is a new recovery phrase. Words written down before the reload do not open this wallet.",
    acknowledgeNew: "I understand the earlier phrase is gone and I will write this one down.",
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
    networkFailed: importFailed("in this browser"),
    /** The chain cannot be read at all, so an import cannot start. */
    notNow:
      "We can't look for your wallet right now, so nothing was imported. Nothing was saved in this browser.",
    checking: "Finding your portfolios...",
    /** The import while it works: a title, a lead, the three steps, the slow line and the failure. */
    progress: {
      title: "Importing your wallet",
      lead: importLead("Keep this tab open."),
      steps: [
        "Reading your recovery phrase",
        "Finding your portfolios",
        "Getting everything ready",
      ],
      slow: "Still working. A wallet with many portfolios takes a little longer.",
      failed: importFailed("in this browser"),
    },
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
    /** Asked for from the result of an import, when a portfolio the person expects is not there. */
    lookFurther: {
      action: "Missing a portfolio? Look further",
      looking: "Looking further for your portfolios...",
      found: (count: number) => `Found ${plural(count, "more portfolio")}.`,
      nothing: "No more portfolios were found for this phrase.",
      failed: "We couldn't finish looking. Nothing was changed. Try again.",
    },
  },

  password: {
    title: "Set a password",
    intro:
      "Your recovery phrase is encrypted with this password before it is stored. We never see it and it is never sent anywhere. Anyone who copies this browser's data can try to guess it, so it has to be hard to guess.",
    forgotten:
      "If you forget this password, your recovery phrase still opens your wallet. Without the phrase, nobody can.",
    encryptFailed: "We couldn't encrypt your wallet, so nothing was saved. Try again.",
    encrypting: "Encrypting...",
    finish: "Encrypt and finish",
  },
} as const;

/**
 * What the phone says differently in onboarding: its own quiz rules, its own
 * import screens, and "this phone" where the web says "this browser". Only
 * the strings that differ are here; the phone reads the rest from
 * `onboardingCopy`. See README.md for how the two are kept apart.
 */
export const mobileOnboardingCopy = {
  welcome: {
    trust: `${keysStay("on this phone")} Tracker issuers keep control over their own tokens.`,
  },
  phrase: {
    intro: onlyWayBack("phone"),
    continueReason: "Reveal the words and confirm you have saved them.",
  },
  confirm: {
    intro: "Pick the word at each position from the list you wrote down.",
    checkWord: (position: number) => `Check word ${position} on your paper.`,
    restart: "Let's start again with different words. Look at your paper first.",
    showAgain: "Show phrase again",
    tryAgain: "Try again",
  },
  import: {
    intro:
      "Type or paste the 12 or 24 word recovery phrase. It stays on this phone and is checked against the Solana network only to find what it already holds.",
    paste: "Paste",
    checking: "Checking what this phrase holds...",
    slow: "Looking for portfolios this phrase already has. This can take a moment.",
    networkFailed: importFailed("on this phone"),
    offline:
      "You're offline. Nothing was saved on this phone. Go back online to import your wallet.",
    progress: {
      lead: importLead("Keep the app open."),
      failed: importFailed("on this phone"),
    },
  },
  source: {
    title: "Where did this phrase come from?",
    intro:
      "A phrase can open two different sets of addresses, depending on the app that made it. Here is what each one holds.",
    noirwire: "NoirWire",
    otherWallet: "Another Solana wallet",
    otherWalletExamples: "Such as Phantom or Solflare.",
    notSure: "Not sure",
    used: "This one has been used.",
    opensMostWallets: "Opens the addresses most other wallets use. You can switch afterwards.",
    opensUsed: "Opens the set that has been used.",
    nothingFound: "Nothing found on chain yet",
    tokenBalances: "Token balances",
    portfolios: (count: number) => plural(count, "portfolio"),
    portfoliosAndTokens: (count: number) => `${plural(count, "portfolio")} and token balances`,
    open: "Open this wallet",
  },
  result: {
    found: (count: number) =>
      `Found ${plural(count, "portfolio")} this phrase already had on chain.`,
    foundBalances: "Found token balances this phrase already had on chain.",
    nothing: "Nothing was found on chain for these addresses yet. Add money whenever you're ready.",
    showAddress: "Show funding address",
    hideAddress: "Hide",
    addressLabel: "Funding address",
  },
  password: {
    intro:
      "Your wallet is encrypted with this password before it is stored on this phone. We never see it and it is never sent anywhere. Anyone who gets a copy of this phone's data can try to guess it, so it has to be hard to guess.",
    notSaved: notSaved("phone"),
    alreadyStored: "A wallet is already stored on this phone. Nothing was saved.",
    hide: "Hide password",
  },
  biometric: {
    title: (method: string) => `Unlock with ${method}?`,
    lead: (method: string) =>
      `Open NoirWire with ${method} instead of typing your password each time. Your password is still needed to view your recovery phrase and to change the password.`,
    use: (method: string) => `Use ${method}`,
    notNow: "Not now",
    notTurnedOn: (method: string) =>
      `${sentence(method)} was not turned on. You can turn it on later in Settings.`,
  },
} as const;
