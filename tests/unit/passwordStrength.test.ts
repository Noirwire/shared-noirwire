import { describe, expect, it } from "vitest";
import { assessPassword, suggestPassphrase } from "../../src/wallet/passwordStrength.js";

describe("assessPassword", () => {
  it.each(["password1234", "qwertyuiop12", "123456789012", "noirwirewallet", "aaaaaaaaaaaa"])(
    "rejects the easily guessed %s",
    async (password) => {
      expect((await assessPassword(password)).ok).toBe(false);
    },
  );

  it("rejects anything shorter than 12 characters", async () => {
    expect(await assessPassword("x7#Qm!9zL2")).toEqual({
      ok: false,
      reason: "Use at least 12 characters.",
    });
  });

  it("accepts a long random password", async () => {
    expect(await assessPassword("vQ7!mZ2#rL9$kT4p")).toEqual({ ok: true });
  });

  it("accepts every suggested passphrase", async () => {
    for (let i = 0; i < 20; i += 1) {
      expect(await assessPassword(suggestPassphrase())).toEqual({ ok: true });
    }
  });
});

describe("suggestPassphrase", () => {
  it("gives five words and does not repeat itself", () => {
    const first = suggestPassphrase();
    expect(first.split("-")).toHaveLength(5);
    expect(suggestPassphrase()).not.toBe(first);
  });
});
