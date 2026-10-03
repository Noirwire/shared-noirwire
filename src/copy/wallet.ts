/** The vault refused a new wallet. `platformNoun` names the device: "browser" or "phone". */
export const notSaved = (platformNoun: string) =>
  `This ${platformNoun} would not save the wallet (storage is full or blocked). Nothing was changed.`;

/** Unlocking, passwords, resetting and copying: the wallet itself rather than what is in it. */
export const walletCopy = {
  unlock: {
    title: "Unlock NoirWire",
    lead: "Your wallet is stored encrypted, so it has to be unlocked with your password each time this page loads.",
    password: "Password",
    unlocking: "Unlocking...",
    unlock: "Unlock",
    forgotten:
      "Forgotten the password? It cannot be recovered - it never left this device. Reset the wallet and import it again from your recovery phrase.",
    reset: "Reset this wallet",
  },

  newPassword: {
    label: "New password",
    suggest: "Suggest a passphrase",
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
    warning:
      "This deletes the wallet from this browser. Your recovery phrase is the only way back in. Without it, everything in your funding wallet and in every portfolio is gone for good, and nobody can restore it.",
    typeToConfirm: (word: string) => `Type ${word} to confirm`,
    delete: "Delete this wallet",
  },

  copyButton: {
    copied: "Copied",
    describeCopied: (describe: string) => `${describe}: copied`,
    failed: "Copy failed. Select and copy the text manually.",
    clearing: (seconds: number) =>
      `Copied. This page will try to clear the clipboard in ${seconds} seconds; copy something else to be sure.`,
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
    damaged:
      "The wallet stored in this browser cannot be read. Reset it and import it again from your recovery phrase.",
    addressMismatch:
      "The addresses stored for this wallet do not match its recovery phrase, so it was not opened. Reset the wallet and import it again from your recovery phrase.",
    noWallet: "There is no wallet in this browser.",
    noWalletToChange: "There is no wallet to change.",
    currentPasswordWrong: "Your current password is not right.",
    passwordNotChanged: "Could not change the password. Your old password still works.",
    changedElsewhere:
      "The wallet changed in another tab while this was running. Nothing was saved.",
    keyRefused: "The saved unlock key does not open this wallet. Enter your password.",
    rekeyRefused:
      "The new password could not be saved for quick unlock, so it was not changed. Your old password still works.",
    rekeyNotUndone:
      "The password was changed, but quick unlock could not be updated. Use the new password, and turn quick unlock on again.",
  },
} as const;
