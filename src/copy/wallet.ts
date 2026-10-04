import { plural } from "./plural.js";

/** The vault refused a new wallet. `platformNoun` names the device: "browser" or "phone". */
export const notSaved = (platformNoun: string) =>
  `This ${platformNoun} would not save the wallet (storage is full or blocked). Nothing was changed.`;

/** A reset deletes the wallet from where it is kept. `platformNoun` is "browser" or "phone". */
const resetWarning = (platformNoun: string) =>
  `This deletes the wallet from this ${platformNoun}. Your recovery phrase is the only way back in. Without it, everything in your funding wallet and in every portfolio is gone for good, and nobody can restore it.`;

/** The stored wallet cannot be read. `where` is "in this browser" or "on this phone". */
const damaged = (where: string) =>
  `The wallet stored ${where} cannot be read. Reset it and restore it from your recovery phrase.`;

/** `where` is "in this browser" or "on this phone". */
const noWallet = (where: string) => `There is no wallet ${where}.`;

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Unlocking, passwords, resetting and copying: the wallet itself rather than what is in it. */
export const walletCopy = {
  unlock: {
    title: "Unlock NoirWire",
    lead: "Your wallet is stored encrypted, so it has to be unlocked with your password each time this page loads.",
    password: "Password",
    unlocking: "Unlocking...",
    unlock: "Unlock",
    forgotten:
      "Forgotten the password? It cannot be recovered - it never left this device. Reset the wallet and restore it from your recovery phrase.",
    reset: "Reset this wallet",
  },

  newPassword: {
    label: "New password",
    suggest: "Suggest a password",
    checkFailed: "Could not check this password. Check your connection and type again.",
    checking: "Checking strength...",
    strong: "Strong password.",
    confirm: "Confirm password",
    mismatch: "Both entries must match.",
    show: "Show password",
    writeItDown:
      "Write it down somewhere safe. It cannot be recovered, only replaced with your recovery phrase.",
  },

  resetConfirm: {
    word: "RESET",
    warning: resetWarning("browser"),
    typeToConfirm: (word: string) => `Type ${word} to confirm`,
    delete: "Delete this wallet",
  },

  /** A reset that did not remove the wallet. */
  reset: {
    notRemoved:
      "This browser would not delete the wallet. It is still on this device, locked. Try again.",
  },

  /** A browser that cannot hold a lock across tabs, so two tabs could not be kept from acting at once. */
  crossTab: {
    notice:
      "This browser cannot keep your wallet safe across tabs, so nothing can be changed or sent from here. You can still look. To use your wallet, open it in a current browser.",
    refused:
      "This browser cannot keep your wallet safe across tabs, so nothing was changed or sent. Open your wallet in a current browser.",
  },

  copyButton: {
    copied: "Copied",
    describeCopied: (describe: string) => `${describe}: copied`,
    failed: "Copy failed. Select and copy the text manually.",
    clearing: (seconds: number) =>
      `Copied. This page will try to clear the clipboard in ${plural(seconds, "second")}; copy something else to be sure.`,
    toClipboard: "Copied to clipboard.",
  },

  /** Why nothing was signed: the key the phrase derives is not the one for the address on screen. */
  keyMismatch:
    "This wallet's recovery phrase does not match the address shown. Nothing was signed. Reload to unlock again.",

  /** What the store answers when a wallet could not be opened, saved or changed. */
  store: {
    notSaved: notSaved("browser"),
    walletExists:
      "A wallet already exists on this device, most likely created in another tab. Nothing was saved here. Reload this page to unlock that wallet.",
    wrongPassword: "That password does not match this wallet.",
    interrupted: "The wallet was locked or changed while it was being unlocked. Try again.",
    damaged: damaged("in this browser"),
    addressMismatch:
      "The addresses stored for this wallet do not match its recovery phrase, so it was not opened. Reset the wallet and restore it from your recovery phrase.",
    noWallet: noWallet("in this browser"),
    noWalletToChange: "There is no wallet to change.",
    currentPasswordWrong: "Your current password is not right.",
    samePassword: "That is already your password.",
    passwordNotChanged: "Could not change the password. Your old password still works.",
    changedElsewhere:
      "The wallet changed in another tab while this was running. Nothing was saved.",
    keyRefused: "The saved unlock key does not open this wallet. Enter your password.",
    rekeyRefused:
      "The new password could not be saved for quick unlock, so it was not changed. Your old password still works.",
    passwordChangeUnknown:
      "The password change may have been saved, but the stored wallet could not be read back to check. Unlock with the new password first; if it does not open, use the old one. Another change waits until the wallet can be read.",
    rekeyNotUndone:
      "The password was changed, but quick unlock could not be updated. Use the new password, and turn quick unlock on again.",
  },
} as const;

/**
 * What the phone says differently about unlocking and resetting, and its
 * words for unlocking with a fingerprint or a face. Everything else is
 * `walletCopy`. `method` is the device's own name for its biometric check.
 */
export const mobileWalletCopy = {
  unlock: {
    lead: "Your wallet is stored encrypted on this phone, so it has to be unlocked each time the app opens.",
    forgotten:
      "Forgotten the password? It cannot be recovered. It never left this phone. Reset the wallet and restore it from your recovery phrase.",
    use: (method: string) => `Use ${method}`,
    lockedOut: (method: string) =>
      `${sentence(method)} is unavailable right now. Enter your password.`,
    changed: (method: string) =>
      `${sentence(method)} settings changed on this phone, so it was turned off for NoirWire. Enter your password.`,
    prompt: "Unlock NoirWire",
  },

  newPassword: {
    /** The phone checks a password with no connection, so it never says to check one. */
    checkFailed: "Could not check this password. Type it again.",
  },

  resetConfirm: {
    warning: resetWarning("phone"),
  },

  reset: {
    notRemoved:
      "The wallet could not be deleted from this phone (storage is blocked). It is still stored here, locked. Try again.",
    deleting: "Deleting...",
  },

  store: {
    damaged: damaged("on this phone"),
    noWallet: noWallet("on this phone"),
  },

  /** Where a secret (an address, a recovery phrase) is held back because the phone could not confirm it is kept out of screenshots and recordings. */
  protection: {
    refused: "This can't be shown safely right now, so it is kept hidden. Try again.",
  },
} as const;
