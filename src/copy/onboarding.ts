import { plural } from "./plural.js";
import { notSaved } from "./wallet.js";

/** `where` is where the password locks the wallet: "in this browser" or "on this phone". */
const passwordRule = (where: string) => (minLength: number) =>
  `Choose a password of at least ${minLength} characters. It locks the wallet ${where}. We never see it.`;

/** Said wherever an import found nothing: on the result, and in place of the choice of addresses. */
const newEmptyWallet = "Nothing found yet. This phrase will open a new, empty wallet.";

/** `platformNoun` names the device: "device" on the web, "phone" on mobile. */
const onlyWayBack = (platformNoun: string) =>
  `These words are the only way back into your money if this ${platformNoun} is lost. Write them on paper. Anyone who sees them can take everything.`;

/**
 * How long an import takes, said the same wherever it is said. A phrase with
 * nothing on it is 42 lookups at 3 a second, 14 seconds; every portfolio
 * found adds up to 20 more, and a slow phone its own time to work the
 * addresses out. The arithmetic is beside `IMPORT_REQUESTS_PER_SECOND`.
 */
const importTiming = "This can take up to a minute.";

/** `keepOpen` is what must stay open while an import runs: "Keep this tab open." or "Keep the app open." */
const importLead = (keepOpen: string) => `${keepOpen} ${importTiming}`;

/** `where` is where nothing was saved: "in this browser" or "on this phone". */
const importFailed = (where: string) =>
  `We couldn't finish restoring your wallet. Nothing was saved ${where}. Try again.`;

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Creating a wallet or importing one, up to the password that seals it. */
export const onboardingCopy = {
  firstPortfolioLabel: "Investing",
  /** The name a portfolio gets when it is made or found for the user rather than by them. */
  portfolioLabel: (position: number) => `Portfolio ${position}`,

  welcome: {
    brand: "NoirWire",
    title: "Invest in US stock trackers. Privately.",
    lines: [
      "Trackers follow share prices like Apple, Tesla or the S&P 500. You do not own the shares.",
      "Each portfolio is separate from your main wallet. Trades themselves are public.",
    ],
    create: "Create a wallet",
    restore: "Restore a wallet",
    explore: "Explore trackers",
    trust: "No account and no ID check. Only your recovery words can restore your wallet.",
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
      "Add money, then invest in trackers",
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
    title: "Restore your wallet",
    intro:
      "Paste the 12- or 24-word recovery phrase from another wallet. It stays in this browser and is checked against the Solana network only to find its real balance.",
    phraseLabel: "Recovery phrase",
    phrasePlaceholder: "word1 word2 word3 ...",
    wordCount: (count: number) => (count > 0 ? plural(count, "word") : "12 or 24 words"),
    networkFailed: importFailed("in this browser"),
    /** The chain cannot be read at all, so an import cannot start. */
    notNow:
      "We can't look for your wallet right now, so nothing was restored. Nothing was saved in this browser.",
    checking: "Finding your portfolios...",
    /** The one quiet line under the button while an import runs. */
    waitingNote: `Checking what this phrase holds. ${importTiming}`,
    /** Nothing was found for either set of addresses, so there is nothing to choose between. */
    newEmptyWallet,
    /** The import while it works: a title, a lead, the three steps, the slow line and the failure. */
    progress: {
      title: "Restoring your wallet",
      lead: importLead("Keep this tab open."),
      steps: [
        "Reading your recovery phrase",
        "Finding your portfolios",
        "Getting everything ready",
      ],
      slow: "Still working. A wallet with many portfolios takes a little longer.",
      failed: importFailed("in this browser"),
    },
    submit: "Restore wallet",
    testNetworkOnly: "Test network SOL only. ",
    twoSets:
      "A phrase can open two different sets of addresses. Both are checked for SOL, tokens and portfolios, and you choose when it is not clear which one you mean.",
    schemes: {
      app: "NoirWire addresses",
      walletDefault: "Addresses most other wallets use",
    },
    chooseTitle: "Choose which addresses to open.",
    chooseIntro: (bothActive: boolean) =>
      `This phrase can open two different sets of addresses, because wallet apps do not all turn a phrase into addresses the same way. ${
        bothActive
          ? "Both sets have been used, so choose the one you mean to open here."
          : "Neither set has been used yet. If this phrase comes from another wallet app, such as Phantom or Solflare, choose the second. If it was created in NoirWire, choose the first."
      }`,
    schemeFunding: (address: string, found: string) => `Main wallet ${address} · ${found}`,
    nothingFound: "Nothing found yet",
    tokenBalances: "Token balances",
    portfolios: (count: number) => plural(count, "portfolio"),
    reunitedTitle: "Wallet restored",
    importedTitle: "Wallet restored",
    reunitedIntro: (address: string, found: string) =>
      `Opened your main wallet at ${address}. Found: ${found}.`,
    importedIntro: (address: string) =>
      `Nothing was found for these addresses yet. Your main wallet is at ${address}. Add money whenever you're ready.`,
    discovered: (count: number) => `Found ${plural(count, "portfolio")} this phrase already had.`,
    otherSet: "Open the other set instead",
    /** Asked for from the result of an import, when a portfolio the person expects is not there. */
    lookFurther: {
      action: "Missing a portfolio? Look further",
      looking: "Looking further for your portfolios...",
      /** Why Continue cannot be pressed while the further scan runs. */
      continuePaused: "Continue is paused while we look.",
      found: (count: number) => `Found ${plural(count, "more portfolio")}.`,
      nothing: "No more portfolios were found for this phrase.",
      failed: "We couldn't finish looking. Nothing was changed. Try again.",
    },
  },

  password: {
    title: "Set a password",
    /** The rule, said before anything is typed. `minLength` is the store's own minimum. */
    intro: passwordRule("in this browser"),
    forgotten:
      "If you forget this password, your recovery phrase still opens your wallet. Without the phrase, nobody can.",
    encryptFailed: "We couldn't save your wallet. Nothing was saved. Try again.",
    encrypting: "Saving...",
    finish: "Save and finish",
  },
} as const;

/**
 * What the phone says differently in onboarding: its own quiz rules, its own
 * import screens, and "this phone" where the web says "this browser". Only
 * the strings that differ are here; the phone reads the rest from
 * `onboardingCopy`. See README.md for how the two are kept apart.
 */
export const mobileOnboardingCopy = {
  phrase: {
    intro: onlyWayBack("phone"),
    continueReason: "Reveal the words and confirm you have saved them.",
    /** A hidden word's accessible name, read out for each numbered tile. */
    wordLabel: (position: number, word: string) => `Word ${position}, ${word}`,
    /** Offering to copy the phrase, which only the phone warns about: a phone's clipboard is readable by its own keyboards and other apps, and can sync to other devices. */
    copy: {
      confirmTitle: "Copy the recovery phrase?",
      confirmBody: (clearSeconds: number) =>
        `Other apps and keyboards on this phone can read the clipboard, and it may sync to your other devices. It is cleared after ${clearSeconds} seconds.`,
      copyAnyway: "Copy anyway",
      copied: "Copied",
      copiedNote: (clearSeconds: number) =>
        `Copied. The clipboard is cleared in ${clearSeconds} seconds; copy something else to be sure.`,
      failed: "Copy failed. Write the words down instead.",
    },
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
      "You're offline. Nothing was saved on this phone. Go back online to restore your wallet.",
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
    nothingFound: "Nothing found yet",
    tokenBalances: "Token balances",
    portfolios: (count: number) => plural(count, "portfolio"),
    portfoliosAndTokens: (count: number) => `${plural(count, "portfolio")} and token balances`,
    open: "Open this wallet",
  },
  result: {
    found: (count: number) => `Found ${plural(count, "portfolio")} this phrase already had.`,
    foundBalances: "Found token balances this phrase already had.",
    nothing: newEmptyWallet,
    showAddress: "Show my main wallet address",
    hideAddress: "Hide",
    addressLabel: "Main wallet address",
  },
  password: {
    intro: passwordRule("on this phone"),
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
