import "./buffer-polyfill.js";

import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { Keypair, MessageAccountKeys, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { ChainError } from "../../domain/chainError.js";
import { connection } from "./client.js";
import { signatureOf } from "./settlement.js";

/** The wallet locked before the key could sign. Nothing was signed. */
export class WalletLockedError extends ChainError {
  constructor() {
    super("walletLocked");
    this.name = "WalletLockedError";
  }
}

/** Asks, at the moment of the call, whether the wallet a key was taken from is still unlocked. */
export type StillUnlocked = () => boolean;

/**
 * The one place a key is put to a transaction. A signing path spends seconds
 * on the network between being handed the key and using it - building,
 * simulating, checking - and in that time the wallet can be locked by hand,
 * by the idle window or from another tab. Being unlocked when the action
 * started is not being unlocked now, so the question is asked again here,
 * synchronously, with nothing awaited between the answer and the signature.
 */
export function signWhileUnlocked(
  transaction: VersionedTransaction,
  signer: Keypair,
  stillUnlocked: StillUnlocked,
): void {
  if (!stillUnlocked()) throw new WalletLockedError();
  transaction.sign([signer]);
}

/** What is known of a transaction the moment it is signed, before it can leave this device. */
export type SignedRecord = {
  signer: PublicKey;
  /** Its id, when its fee payer has signed already: this signer, or a sponsor before it. */
  signature?: string;
  blockhash: string;
  lastValidBlockHeight?: number;
};

let recorder: ((record: SignedRecord) => Promise<void>) | null = null;

/** Sets what `signForSending` hands each signed transaction to before it may be sent. */
export function recordSignedWith(record: ((record: SignedRecord) => Promise<void>) | null) {
  recorder = record;
}

/**
 * Signs a transaction that is about to be sent, and has it recorded first.
 *
 * What a signed transaction can do once it has left this device cannot be
 * taken back, so where it came from is written down in the wallet's own
 * record before it may go: its blockhash, the block height it expires at,
 * and its id when that is known. If the app is closed a moment later, or the
 * answer to sending it never arrives, that record is what the chain is asked
 * about, and nothing is done again until the chain has answered. A record
 * that cannot be written stops it here, with nothing sent.
 */
export async function signForSending(
  transaction: VersionedTransaction,
  signer: Keypair,
  stillUnlocked: StillUnlocked,
  lastValidBlockHeight?: number,
): Promise<void> {
  signWhileUnlocked(transaction, signer, stillUnlocked);
  // The id is the fee payer's signature: this signer's own when it pays, or
  // one a sponsor already put there. A fee payer still to sign leaves none.
  const signature = signatureOf(transaction);
  await recorder?.({
    signer: signer.publicKey,
    ...(signature ? { signature } : {}),
    blockhash: transaction.message.recentBlockhash,
    ...(lastValidBlockHeight && lastValidBlockHeight > 0 ? { lastValidBlockHeight } : {}),
  });
}

/** Every token account `owner` holds, under both token programs. */
export async function ownedTokenAccounts(owner: PublicKey): Promise<PublicKey[]> {
  const [classic, extended] = await Promise.all(
    [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((programId) =>
      connection.getTokenAccountsByOwner(owner, { programId }),
    ),
  );
  return [...classic.value, ...extended.value].map((entry) => entry.pubkey);
}

/**
 * Every account the transaction can touch, lookup tables included. A token
 * account outside this set cannot change, so only the signer's accounts
 * inside it need watching - which also keeps the simulation request under
 * the RPC's cap of one watched account per transaction account.
 */
export async function resolveAccountKeys(
  transaction: VersionedTransaction,
): Promise<MessageAccountKeys> {
  const lookups = await Promise.all(
    transaction.message.addressTableLookups.map(async (lookup) => {
      const table = (await connection.getAddressLookupTable(lookup.accountKey)).value;
      if (!table) throw new Error("The transaction references a lookup table that does not exist.");
      return table;
    }),
  );
  return transaction.message.getAccountKeys({ addressLookupTableAccounts: lookups });
}

/** The token accounts `owner` holds among `accountKeys`, the ones a transaction is able to touch. */
export async function ownedTokenAccountsIn(
  accountKeys: MessageAccountKeys,
  owner: PublicKey,
): Promise<PublicKey[]> {
  const owned = await ownedTokenAccounts(owner);
  const referenced = new Set<string>();
  for (let i = 0; i < accountKeys.length; i += 1) referenced.add(accountKeys.get(i)!.toBase58());
  return owned.filter((account) => referenced.has(account.toBase58()));
}
