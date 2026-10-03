import {
  ACCOUNT_SIZE,
  AccountType,
  MINT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { Buffer } from "buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendCopy } from "../../src/copy/send.js";
import { hasForeignCharacters } from "../../src/domain/recipients.js";
import {
  checkRecipient,
  recipientFromCode,
  unsendable,
} from "../../src/infrastructure/solana/address.js";
import { connection } from "../../src/infrastructure/solana/client.js";

const wallet = () => Keypair.generate().publicKey.toBase58();
const account = (owner: PublicKey, data = new Uint8Array(0), executable = false) => ({
  executable,
  owner: owner.toBase58(),
  data,
});

afterEach(() => vi.restoreAllMocks());

describe("unsendable", () => {
  it("allows a wallet nobody has funded and an ordinary system account", () => {
    expect(unsendable(wallet(), null)).toBeNull();
    expect(unsendable(wallet(), account(SystemProgram.programId))).toBeNull();
  });

  it("names a program, a mint, a token account and a program-owned account", () => {
    expect(unsendable(wallet(), account(SystemProgram.programId, undefined, true))).toBe("program");
    expect(unsendable(wallet(), account(TOKEN_PROGRAM_ID, new Uint8Array(MINT_SIZE)))).toBe("mint");
    expect(unsendable(wallet(), account(TOKEN_PROGRAM_ID, new Uint8Array(ACCOUNT_SIZE)))).toBe(
      "tokenAccount",
    );
    const mint2022 = new Uint8Array(ACCOUNT_SIZE + 10);
    mint2022[ACCOUNT_SIZE] = AccountType.Mint;
    expect(unsendable(wallet(), account(TOKEN_2022_PROGRAM_ID, mint2022))).toBe("mint");
    expect(unsendable(wallet(), account(Keypair.generate().publicKey))).toBe("programOwned");
  });

  it("names an address no key can sign for", () => {
    const [offCurve] = PublicKey.findProgramAddressSync([Buffer.from("x")], PublicKey.default);
    expect(unsendable(offCurve.toBase58(), null)).toBe("offCurve");
  });

  it("has words for every reason", () => {
    for (const reason of ["program", "mint", "tokenAccount", "offCurve", "programOwned"] as const) {
      expect(sendCopy.unsendable[reason]).toMatch(/\.$/);
    }
  });
});

describe("checkRecipient", () => {
  it("reads the account from the network and names what it is", async () => {
    vi.spyOn(connection, "getAccountInfo").mockResolvedValue({
      executable: false,
      owner: TOKEN_PROGRAM_ID,
      data: Buffer.alloc(ACCOUNT_SIZE),
      lamports: 1,
    });
    expect(await checkRecipient(wallet())).toBe("tokenAccount");
  });

  it("allows an address that holds nothing yet", async () => {
    vi.spyOn(connection, "getAccountInfo").mockResolvedValue(null);
    expect(await checkRecipient(wallet())).toBeNull();
  });
});

describe("recipientFromCode", () => {
  it("takes a plain address, or only the address of a payment code", () => {
    const to = wallet();
    expect(recipientFromCode(` ${to} `)).toEqual({ address: to, fromPaymentCode: false });
    expect(recipientFromCode(`solana:${to}?amount=5&memo=x`)).toEqual({
      address: to,
      fromPaymentCode: true,
    });
    expect(recipientFromCode("https://example.com")).toBeNull();
    expect(recipientFromCode("solana:nope")).toBeNull();
  });

  it("tells pasted text holding characters an address cannot have", () => {
    expect(hasForeignCharacters(wallet())).toBe(false);
    expect(hasForeignCharacters("0OIl")).toBe(true);
  });
});
