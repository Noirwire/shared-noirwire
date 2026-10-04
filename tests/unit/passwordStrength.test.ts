import { describe, expect, it } from "vitest";
import { ZxcvbnFactory } from "@zxcvbn-ts/core";
import { adjacencyGraphs, dictionary } from "@zxcvbn-ts/language-common";
import {
  assessPassword,
  assessPasswordWith,
  suggestPassphrase,
  type PasswordChecker,
} from "../../src/wallet/passwordStrength.js";

describe("assessPasswordWith", () => {
  const checker = new ZxcvbnFactory({ dictionary, graphs: adjacencyGraphs }) as PasswordChecker;
  const SAMPLES = [
    "short",
    "password1234",
    "qwertyuiop12",
    "noirwirewallet",
    "vQ7!mZ2#rL9$kT4p",
    "orbit-cactus-lamp-velvet-quarry",
  ];

  it.each(SAMPLES)(
    "answers at once, and word for word as assessPassword does, for %s",
    async (s) => {
      const now = assessPasswordWith(checker, s);
      expect(now).not.toBeInstanceOf(Promise);
      expect(now).toEqual(await assessPassword(s));
    },
  );

  it("refuses a short password without asking the checker", () => {
    const unused: PasswordChecker = {
      check: () => {
        throw new Error("asked");
      },
    };
    expect(assessPasswordWith(unused, "x7#Qm!9zL2")).toEqual({
      ok: false,
      reason: "Use at least 12 characters.",
    });
  });

  it("gives the checker the words an attacker would try first", () => {
    const inputs: (string[] | undefined)[] = [];
    const recording: PasswordChecker = {
      check: (_password, userInputs) => {
        inputs.push(userInputs);
        return { guessesLog10: 20 };
      },
    };
    expect(assessPasswordWith(recording, "anything-long-enough")).toEqual({ ok: true });
    expect(inputs[0]).toContain("noirwire");
  });

  it("lets what the checker throws through, so a caller can say the check could not run", () => {
    const broken: PasswordChecker = {
      check: () => {
        throw new Error("no dictionary");
      },
    };
    expect(() => assessPasswordWith(broken, "anything-long-enough")).toThrow("no dictionary");
  });
});

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
