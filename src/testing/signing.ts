import { PublicKey, TransactionMessage, VersionedTransaction, type Keypair } from "@solana/web3.js";
import { signForSending } from "../infrastructure/solana/signerAccounts.js";

/**
 * Signing for a test's stand-in chain client. A fake that "sends" must still
 * sign the way the real clients do, through the one signing guard, or the
 * rules under test (a reservation before every signature, the network
 * checked first, nothing signed once locked) are not the ones the app runs.
 */

/** An empty transaction of `signer`'s, not yet signed and never sendable. */
export function unsignedTransaction(signer: Keypair): VersionedTransaction {
  return new VersionedTransaction(
    new TransactionMessage({
      payerKey: signer.publicKey,
      recentBlockhash: PublicKey.default.toBase58(),
      instructions: [],
    }).compileToV0Message(),
  );
}

/**
 * Signs `transaction` with `signer` exactly as a chain client does before it
 * sends: through the installed signing guard, so it throws what a real send
 * would (no guard, no reservation, the wrong network, a locked wallet).
 * Resolves to the signed transaction. Nothing is sent anywhere.
 */
export async function signAsClient(
  signer: Keypair,
  stillUnlocked: () => boolean,
  transaction: VersionedTransaction = unsignedTransaction(signer),
): Promise<VersionedTransaction> {
  await signForSending(transaction, signer, stillUnlocked);
  return transaction;
}
