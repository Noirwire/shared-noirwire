import { Connection, Keypair, LAMPORTS_PER_SOL, type PublicKey } from "@solana/web3.js";
import {
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TokenAccountNotFoundError,
} from "@solana/spl-token";
import { RPC_URL } from "../global-setup.js";

/**
 * The suite's own connection, for the airdrops and mints that set a test up.
 * Those confirm over the validator's websocket, which the app's connection
 * refuses to open (see src/lib/infrastructure/solana/client.ts).
 */
const setup = new Connection(RPC_URL, "confirmed");

/** A fresh, never-before-seen keypair for one test's owner/funder/recipient role. */
export function freshKeypair(): Keypair {
  return Keypair.generate();
}

/** Airdrops `sol` SOL to `pubkey` and waits for it to land. */
export async function airdropSol(pubkey: PublicKey, sol: number): Promise<void> {
  const { blockhash, lastValidBlockHeight } = await setup.getLatestBlockhash();
  const signature = await setup.requestAirdrop(pubkey, Math.round(sol * LAMPORTS_PER_SOL));
  await setup.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
}

/**
 * The app's own `.rpc()` calls confirm at Anchor's default "processed"
 * commitment, one step below the "confirmed" commitment `connection` (and
 * every balance read in this suite) uses - on a fast local validator a
 * balance read immediately after an await can occasionally observe pre-tx
 * state. Polls instead of trusting a single read after any mutating call.
 */
export async function waitForBalance(
  connection: Connection,
  pubkey: PublicKey,
  predicate: (lamports: number) => boolean,
  timeoutMs = 10_000,
): Promise<number> {
  const start = Date.now();
  let last = await connection.getBalance(pubkey);
  while (!predicate(last)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Balance of ${pubkey.toBase58()} never satisfied predicate (last seen: ${last})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    last = await connection.getBalance(pubkey);
  }
  return last;
}

/** Same as `waitForBalance`, but for an account's existence (e.g. a freshly-created PDA). */
export async function waitForAccount(
  connection: Connection,
  pubkey: PublicKey,
  timeoutMs = 10_000,
) {
  const start = Date.now();
  for (;;) {
    const info = await connection.getAccountInfo(pubkey);
    if (info) return info;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Account ${pubkey.toBase58()} never appeared`);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

/**
 * Creates a throwaway SPL mint on the local validator to stand in for the
 * fixed devnet USDC-alike mint, which only exists on devnet. `authority`
 * is both the mint authority and the fee payer, and must already hold SOL.
 */
export async function createTestMint(authority: Keypair, decimals: number) {
  return createMint(setup, authority, authority.publicKey, null, decimals);
}

/** Mints `amount` (in the mint's UI units, not raw base units) of `mint` into `owner`'s associated token account. */
export async function mintTestTokensTo(
  mint: PublicKey,
  authority: Keypair,
  owner: PublicKey,
  amount: number,
  decimals: number,
): Promise<void> {
  const destination = await getOrCreateAssociatedTokenAccount(setup, authority, mint, owner);
  await mintTo(
    setup,
    authority,
    mint,
    destination.address,
    authority,
    BigInt(Math.round(amount * 10 ** decimals)),
  );
}

/** Reads a token account's raw base-unit balance, or 0 for a not-yet-created account. */
async function getTokenAmount(connection: Connection, ata: PublicKey): Promise<bigint> {
  try {
    const account = await getAccount(connection, ata);
    return account.amount;
  } catch (error) {
    if (error instanceof TokenAccountNotFoundError) return BigInt(0);
    throw error;
  }
}

/** Same idea as `waitForBalance`, but polling a token account's raw base-unit balance. */
export async function waitForTokenAmount(
  connection: Connection,
  ata: PublicKey,
  predicate: (amount: bigint) => boolean,
  timeoutMs = 10_000,
): Promise<bigint> {
  const start = Date.now();
  let last = await getTokenAmount(connection, ata);
  while (!predicate(last)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Token amount of ${ata.toBase58()} never satisfied predicate (last seen: ${last})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    last = await getTokenAmount(connection, ata);
  }
  return last;
}
