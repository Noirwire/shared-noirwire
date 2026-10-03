import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ComputeBudgetProgram,
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { connection } from "../../src/infrastructure/solana/client.js";
import {
  signWhileUnlocked,
  WalletLockedError,
} from "../../src/infrastructure/solana/signerAccounts.js";
import { depositSol, signSendConfirm } from "../../src/infrastructure/solana/sol.js";
import { signatureOf } from "../../src/infrastructure/solana/settlement.js";

const payer = Keypair.generate();

function unsigned(): VersionedTransaction {
  return new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1 })],
    }).compileToV0Message(),
  );
}

afterEach(() => vi.restoreAllMocks());

describe("signWhileUnlocked", () => {
  it("signs while the wallet is still unlocked", () => {
    const transaction = unsigned();
    signWhileUnlocked(transaction, payer, () => true);
    expect(signatureOf(transaction)).not.toBeNull();
  });

  it("leaves the transaction unsigned once the wallet has locked", () => {
    const transaction = unsigned();
    expect(() => signWhileUnlocked(transaction, payer, () => false)).toThrow(WalletLockedError);
    expect(signatureOf(transaction)).toBeNull();
  });
});

describe("a wallet that locks between building a transaction and signing it", () => {
  /** Unlocked when the action starts; locked by the time the blockhash comes back. */
  function lockDuringBuild() {
    let unlocked = true;
    vi.spyOn(connection, "getLatestBlockhash").mockImplementation(async () => {
      unlocked = false;
      return { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1 };
    });
    const sent = vi.spyOn(connection, "sendRawTransaction").mockResolvedValue("unused");
    return { stillUnlocked: () => unlocked, sent };
  }

  const transfer = [
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1,
    }),
  ];

  it("signs and sends nothing", async () => {
    const { stillUnlocked, sent } = lockDuringBuild();
    expect(stillUnlocked()).toBe(true);
    await expect(signSendConfirm(transfer, payer, stillUnlocked)).rejects.toThrow(
      WalletLockedError,
    );
    expect(sent).not.toHaveBeenCalled();
  });

  it("is refused through a deposit as well", async () => {
    const { stillUnlocked, sent } = lockDuringBuild();
    await expect(
      depositSol(payer, Keypair.generate().publicKey, 0.1, stillUnlocked),
    ).rejects.toThrow(WalletLockedError);
    expect(sent).not.toHaveBeenCalled();
  });
});
