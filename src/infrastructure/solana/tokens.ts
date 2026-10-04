import "./buffer-polyfill.js";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAccountLenForMint,
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_PROGRAM_ID,
  TokenAccountNotFoundError,
} from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { requireSendableRecipient } from "./address.js";
import { connection } from "./client.js";
import { usdcMintKey } from "./config.js";
import { NETWORK_FEE_LAMPORTS, requireFunderCovers, requireSenderCovers } from "./fees.js";
import type { RelayedDraft, RelayerTerms } from "./relayer.js";
import type { StillUnlocked } from "./signerAccounts.js";
import { signSendConfirm, toRawUnits } from "./sol.js";
import { readTokenAmount } from "./swap/guard.js";

/**
 * Which token program owns a mint. USDC is classic SPL Token; every tokenized
 * stock is Token-2022, because the extensions the issuer relies on (a
 * permanent delegate and a freeze authority) only exist there. The two
 * programs have different addresses, so every account derivation and every
 * instruction has to be told which one it is talking about - passing the
 * wrong one does not fail loudly, it derives a different address that simply
 * holds nothing.
 */
type TokenProgram = PublicKey;

/** The deterministic associated-token-account address for one owner's balance of `mint`. */
export function ataFor(
  mint: PublicKey,
  owner: PublicKey,
  programId: TokenProgram = TOKEN_PROGRAM_ID,
): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, true, programId);
}

/** Real token balance in UI units (not raw base units). 0 for an owner with no ATA yet - a normal, common state. */
export async function getTokenBalance(
  mint: PublicKey,
  decimals: number,
  owner: PublicKey,
  programId: TokenProgram = TOKEN_PROGRAM_ID,
): Promise<number> {
  try {
    const account = await getAccount(
      connection,
      ataFor(mint, owner, programId),
      undefined,
      programId,
    );
    return Number(account.amount) / 10 ** decimals;
  } catch (error) {
    if (error instanceof TokenAccountNotFoundError) return 0;
    throw error;
  }
}

/**
 * The rent an associated token account for `mint` costs.
 *
 * Read from the mint rather than assumed, because a Token-2022 account is not
 * a fixed size: the mint's own extensions decide which account extensions the
 * ATA must carry, and an ATA always carries ImmutableOwner on top. A hardcoded
 * classic-SPL account length under-funds a Token-2022 account and the creation
 * fails for a reason that reads as an unrelated balance problem.
 */
export function ataRentFor(mint: PublicKey, programId: TokenProgram): Promise<number> {
  const key = mint.toBase58();
  let rent = ataRents.get(key);
  if (!rent) {
    rent = getMint(connection, mint, undefined, programId).then((mintInfo) =>
      connection.getMinimumBalanceForRentExemption(getAccountLenForMint(mintInfo)),
    );
    ataRents.set(key, rent);
    rent.catch(() => ataRents.delete(key));
  }
  return rent;
}

/**
 * A mint's account size is fixed and the rent rate does not move in practice,
 * so each mint is asked about once per session instead of on every trade and
 * send. A failed lookup is forgotten and asked again.
 */
const ataRents = new Map<string, Promise<number>>();

/**
 * Makes sure `owner`'s associated token account for `mint` already exists,
 * creating it from `funder` first when it does not. Idempotent: a no-op the
 * second time. `funder` pays and is the transaction's only signer - `owner`
 * does not need to sign for a token account to be created on its behalf.
 *
 * The token program requires the account's rent-exempt cost to be paid as
 * part of the same instruction that creates it. That rent stays locked in the
 * ATA for as long as the account exists.
 */
export async function ensureTokenAccountExists(
  mint: PublicKey,
  owner: PublicKey,
  funder: Keypair,
  programId: TokenProgram = TOKEN_PROGRAM_ID,
  stillUnlocked?: StillUnlocked,
): Promise<void> {
  const ata = ataFor(mint, owner, programId);
  const existing = await connection.getAccountInfo(ata);
  if (existing) return;

  await requireFunderCovers(funder, await ataRentFor(mint, programId));

  await signSendConfirm(
    [createAssociatedTokenAccountInstruction(funder.publicKey, ata, owner, mint, programId)],
    funder,
    stillUnlocked,
  );
}

/**
 * Deposits `amount` of `mint` from `funder`'s own balance into `owner`'s.
 * Ensures both associated token accounts exist first (creating either one
 * from `funder` if needed - `funder`'s own ATA is expected to already exist
 * in this app's setup, but this does not assume that for other funders).
 * `funder` signs and pays the transaction fee.
 */
export async function depositToken(
  mint: PublicKey,
  decimals: number,
  funder: Keypair,
  owner: PublicKey,
  amount: number,
  programId: TokenProgram = TOKEN_PROGRAM_ID,
  stillUnlocked?: StillUnlocked,
): Promise<void> {
  await ensureTokenAccountExists(mint, owner, funder, programId, stillUnlocked);
  await ensureTokenAccountExists(mint, funder.publicKey, funder, programId, stillUnlocked);

  await signSendConfirm(
    [
      createTransferCheckedInstruction(
        ataFor(mint, funder.publicKey, programId),
        mint,
        ataFor(mint, owner, programId),
        funder.publicKey,
        toRawUnits(amount, decimals),
        decimals,
        undefined,
        programId,
      ),
    ],
    funder,
    stillUnlocked,
  );
}

/**
 * What sending `mint` to `to` costs the sender in lamports: the network fee,
 * and the rent of the recipient's token account when the send has to open
 * it. Reads only the recipient's account, in a request of its own.
 */
export async function tokenSendLamports(
  mint: PublicKey,
  to: PublicKey,
  programId: TokenProgram = TOKEN_PROGRAM_ID,
): Promise<number> {
  const destination = await connection.getAccountInfo(ataFor(mint, to, programId));
  return NETWORK_FEE_LAMPORTS + (destination ? 0 : await ataRentFor(mint, programId));
}

/**
 * A direct associated-token-account-to-associated-token-account transfer of
 * `mint` from `owner`'s own balance to `to`'s, in one transaction that
 * `owner` alone signs and pays for: the network fee, and the rent of `to`'s
 * token account when it has to be opened first. All of it is checked against
 * `owner`'s SOL before anything is built.
 *
 * `funder` never signs or pays. A transaction it co-signed, or a token
 * account it opened for the recipient just before, would name the funding
 * wallet and the portfolio together on chain. It is taken only to tell a send
 * from the funding wallet itself apart, for the wording of a refusal.
 *
 * Asking for exactly the balance the chain reports sends that balance in raw
 * units, not the rounded figure it was shown as.
 */
export async function withdrawToken(
  mint: PublicKey,
  decimals: number,
  owner: Keypair,
  funder: Keypair,
  amount: number,
  to: PublicKey,
  programId: TokenProgram = TOKEN_PROGRAM_ID,
  stillUnlocked?: StillUnlocked,
): Promise<void> {
  await requireSendableRecipient(to);

  const source = ataFor(mint, owner.publicKey, programId);
  const destination = ataFor(mint, to, programId);
  // Two reads, not one: the sender's accounts and the recipient's belong to
  // different addresses, and one request naming both would tell the RPC
  // provider they are connected before anything is sent.
  const [ownerInfo, sourceInfo] = await connection.getMultipleAccountsInfo([
    owner.publicKey,
    source,
  ]);
  const destinationInfo = await connection.getAccountInfo(destination);

  const held = readTokenAmount(sourceInfo?.data);
  const rawAmount = amount === Number(held) / 10 ** decimals ? held : toRawUnits(amount, decimals);
  if (rawAmount === 0n || rawAmount > held) {
    throw new Error("More than this address holds.");
  }

  const rent = destinationInfo ? 0 : await ataRentFor(mint, programId);
  await requireSenderCovers(
    ownerInfo?.lamports ?? 0,
    NETWORK_FEE_LAMPORTS + rent,
    rent > 0 ? "the network fee and the recipient's token account" : "the network fee",
    owner.publicKey.equals(funder.publicKey),
  );

  await signSendConfirm(
    [
      ...(destinationInfo
        ? []
        : [
            createAssociatedTokenAccountIdempotentInstruction(
              owner.publicKey,
              destination,
              to,
              mint,
              programId,
            ),
          ]),
      createTransferCheckedInstruction(
        source,
        mint,
        destination,
        owner.publicKey,
        rawAmount,
        decimals,
        undefined,
        programId,
      ),
    ],
    owner,
    stillUnlocked,
  );
}

const TRANSFER_CHECKED = 12;

/** What a relayer-paid transaction built here may call directly: the account it opens, and token transfers. */
function relayedPrograms(programId: TokenProgram) {
  return [
    { programId: ASSOCIATED_TOKEN_PROGRAM_ID },
    { programId, instructions: [TRANSFER_CHECKED] },
    { programId: TOKEN_PROGRAM_ID, instructions: [TRANSFER_CHECKED] },
  ];
}

/**
 * The same send as `withdrawToken`, built for the fee relayer to pay for:
 * `terms.feePayer` is the transaction's fee payer and the funder of the
 * recipient's token account when that has to be opened, and the portfolio
 * signs only as the authority over its own token account. The payment that
 * covers the cost is added by the caller (src/infrastructure/solana/relayer.ts).
 *
 * The account is opened only when it is missing. The relay charges its rent
 * for every create instruction the relayer funds, needed or not, so an
 * unconditional one would bill the sender for nothing on every send.
 *
 * Cash pays the cost out of the account it is sent from, so a cash send must
 * leave the fee behind. While pricing, an amount that does not is reduced to
 * fit, because the fee is not known yet; when it is, such an amount is
 * refused.
 */
export async function relayedSendDraft(
  send: {
    mint: PublicKey;
    decimals: number;
    programId: TokenProgram;
    owner: PublicKey;
    to: PublicKey;
    amount: number;
  },
  terms: RelayerTerms,
): Promise<RelayedDraft> {
  const { mint, decimals, programId, owner, to } = send;
  await requireSendableRecipient(to);

  const usdc = usdcMintKey();
  const isCash = mint.equals(usdc);
  const source = ataFor(mint, owner, programId);
  const destination = ataFor(mint, to, programId);
  // Two reads, not one, for the reason `withdrawToken` gives.
  const sourceInfo = await connection.getAccountInfo(source);
  const destinationInfo = await connection.getAccountInfo(destination);

  const held = readTokenAmount(sourceInfo?.data);
  const asked =
    send.amount === Number(held) / 10 ** decimals ? held : toRawUnits(send.amount, decimals);
  const room = isCash ? held - terms.feeRaw : held;
  const amountRaw = terms.pricing && asked > room ? room : asked;
  if (amountRaw <= 0n || amountRaw > room) {
    throw new Error("More than this portfolio holds once its network cost is paid.");
  }

  const cashAccount = ataFor(usdc, owner);
  return {
    instructions: [
      ...(destinationInfo
        ? []
        : [
            createAssociatedTokenAccountIdempotentInstruction(
              terms.feePayer,
              destination,
              to,
              mint,
              programId,
            ),
          ]),
      createTransferCheckedInstruction(
        source,
        mint,
        destination,
        owner,
        amountRaw,
        decimals,
        undefined,
        programId,
      ),
    ],
    intent: { kind: "send", mint, programId, to, amountRaw },
    opens: destinationInfo ? null : { owner: to, mint, programId },
    mints: [
      { mint: usdc, programId: TOKEN_PROGRAM_ID },
      { mint, programId },
    ],
    limits: (feeRaw) => ({
      cashAccount,
      maxCashSpent: isCash ? amountRaw + feeRaw : feeRaw,
      ...(isCash ? {} : { alsoSpends: { account: source, maxAmount: amountRaw } }),
      // The recipient's account must gain exactly what the sender's loses.
      receive: { account: destination, minAmount: amountRaw },
      exact: true,
      maxLamportsSpent: 0n,
      programs: relayedPrograms(programId),
    }),
  };
}

/**
 * Opens `owner`'s own token account for `mint` at the relayer's expense, and
 * does nothing else. A portfolio with no SOL cannot be sold a tracker it has
 * no account for: the venue will not build that order. With the account
 * open it will, and pays for the order itself, so this is the step before a
 * first buy. Null when the account is already there, which makes a second
 * attempt skip a step that was done.
 */
export async function relayedOpenDraft(
  open: { mint: PublicKey; programId: TokenProgram; owner: PublicKey },
  terms: RelayerTerms,
): Promise<RelayedDraft> {
  const { mint, programId, owner } = open;
  const usdc = usdcMintKey();
  const account = ataFor(mint, owner, programId);
  return {
    instructions: [
      createAssociatedTokenAccountIdempotentInstruction(
        terms.feePayer,
        account,
        owner,
        mint,
        programId,
      ),
    ],
    intent: { kind: "open" },
    opens: { owner, mint, programId },
    mints: [
      { mint: usdc, programId: TOKEN_PROGRAM_ID },
      { mint, programId },
    ],
    limits: (feeRaw) => ({
      cashAccount: ataFor(usdc, owner),
      maxCashSpent: feeRaw,
      exact: true,
      maxLamportsSpent: 0n,
      programs: relayedPrograms(programId),
    }),
  };
}
