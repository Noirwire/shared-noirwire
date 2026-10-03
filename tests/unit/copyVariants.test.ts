import { describe, expect, it } from "vitest";
import { mobileOnboardingCopy, onboardingCopy } from "../../src/copy/onboarding.js";
import { walletCopy } from "../../src/copy/wallet.js";

/**
 * The web's strings are built from the same templates as the phone's. These
 * pin the web's wording byte for byte, so a template change cannot move it.
 */
describe("per-platform copy", () => {
  it("keeps the web's wording exactly", () => {
    expect(onboardingCopy.welcome.trustMainnet).toBe(
      "Your keys and recovery phrase stay in this browser. Network requests are relayed by NoirWire's server, which stores and logs nothing. Tracker issuers keep control over their own tokens. The risks are set out in Settings.",
    );
    expect(onboardingCopy.welcome.trustTestNetwork).toBe(
      "Your keys and recovery phrase stay in this browser. Network requests are relayed by NoirWire's server, which stores and logs nothing. Keys are real; funds are Solana devnet SOL and a test USDC-alike token.",
    );
    expect(onboardingCopy.phrase.intro).toBe(
      "These words are the only way back into your money if this device is lost. Write them on paper. Anyone who sees them can take everything.",
    );
    expect(walletCopy.store.notSaved).toBe(
      "This browser would not save the wallet (storage is full or blocked). Nothing was changed.",
    );
  });

  it("says the same on the phone with the phone's words", () => {
    expect(mobileOnboardingCopy.welcome.trust).toBe(
      "Your keys and recovery phrase stay on this phone. Network requests are relayed by NoirWire's server, which stores and logs nothing. Tracker issuers keep control over their own tokens.",
    );
    expect(mobileOnboardingCopy.phrase.intro).toBe(
      "These words are the only way back into your money if this phone is lost. Write them on paper. Anyone who sees them can take everything.",
    );
    expect(mobileOnboardingCopy.password.notSaved).toBe(
      "This phone would not save the wallet (storage is full or blocked). Nothing was changed.",
    );
  });

  it("puts a method name at the start of a sentence with a capital", () => {
    expect(mobileOnboardingCopy.biometric.notTurnedOn("fingerprint")).toBe(
      "Fingerprint was not turned on. You can turn it on later in Settings.",
    );
  });

  it("has no em dash on either platform", () => {
    const text = JSON.stringify([onboardingCopy, mobileOnboardingCopy, walletCopy]);
    expect(text).not.toContain(String.fromCharCode(0x2014));
  });
});
