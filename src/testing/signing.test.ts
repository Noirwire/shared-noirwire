import { Keypair } from "@solana/web3.js";
import { afterEach, describe, expect, it } from "vitest";
import { ChainError } from "../domain/chainError.js";
import { guardSigningWith, type SignedRecord } from "../infrastructure/solana/signerAccounts.js";
import { signatureOf } from "../infrastructure/solana/settlement.js";
import { signAsClient, unsignedTransaction } from "./index.js";

const signer = Keypair.generate();

afterEach(() => guardSigningWith(null));

describe("signAsClient", () => {
  it("refuses to sign when no signing guard is installed, as a real send would", async () => {
    await expect(signAsClient(signer, () => true)).rejects.toMatchObject({ code: "notRecorded" });
  });

  it("signs through the installed guard, which records the signature first", async () => {
    const records: SignedRecord[] = [];
    guardSigningWith({
      confirmNetwork: async () => undefined,
      record: async (record) => void records.push(record),
    });
    const signed = await signAsClient(signer, () => true);
    expect(signatureOf(signed)).not.toBeNull();
    expect(records).toHaveLength(1);
    expect(records[0].signer.equals(signer.publicKey)).toBe(true);
    expect(records[0].signature).toBe(signatureOf(signed));
  });

  it("signs nothing on the wrong network, with no reservation, or once locked", async () => {
    const transaction = unsignedTransaction(signer);
    guardSigningWith({
      confirmNetwork: async () => Promise.reject(new ChainError("wrongNetwork")),
      record: async () => undefined,
    });
    await expect(signAsClient(signer, () => true, transaction)).rejects.toMatchObject({
      code: "wrongNetwork",
    });
    guardSigningWith(null);
    guardSigningWith({
      confirmNetwork: async () => undefined,
      record: async () => Promise.reject(new ChainError("notRecorded")),
    });
    await expect(signAsClient(signer, () => false, transaction)).rejects.toMatchObject({
      code: "walletLocked",
    });
    expect(signatureOf(transaction)).toBeNull();
  });
});
