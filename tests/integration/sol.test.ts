import { describe, expect, it } from "vitest";
import { connection } from "../../src/infrastructure/solana/client.js";
import { NETWORK_FEE_LAMPORTS } from "../../src/infrastructure/solana/fees.js";
import {
  depositSol,
  getWalletBalanceSol,
  sendSolTo,
  solToLamports,
} from "../../src/infrastructure/solana/sol.js";
import { airdropSol, freshKeypair, waitForBalance } from "./helpers/chain.js";

/**
 * Native SOL on an account's own keypair, which replaced a custom vault
 * program holding it in a PDA. The property worth pinning is that an account
 * needs no setup at all before it works - that is the whole reason the
 * program was removed.
 */
describe("a brand new account needs no creation step", () => {
  it("receives SOL at a keypair that has never existed on chain", async () => {
    const funder = freshKeypair();
    const owner = freshKeypair();
    await airdropSol(funder.publicKey, 1);

    // Nothing has ever been written for this owner: no account, no PDA.
    expect(await connection.getAccountInfo(owner.publicKey)).toBeNull();

    await depositSol(funder, owner.publicKey, 0.3);

    const landed = await waitForBalance(
      connection,
      owner.publicKey,
      (lamports) => lamports === solToLamports(0.3),
    );
    expect(landed).toBe(solToLamports(0.3));
  });

  it("costs the funder nothing beyond the amount sent and the network fee", async () => {
    const funder = freshKeypair();
    const owner = freshKeypair();
    await airdropSol(funder.publicKey, 1);

    const before = await connection.getBalance(funder.publicKey);
    await depositSol(funder, owner.publicKey, 0.25);
    await waitForBalance(connection, owner.publicKey, (l) => l === solToLamports(0.25));
    const after = await connection.getBalance(funder.publicKey);

    // No rent-exemption subsidy on top: the only extra is one signature's fee.
    const spentBeyondTransfer = before - after - solToLamports(0.25);
    expect(spentBeyondTransfer).toBeLessThanOrEqual(10_000);
  });
});

describe("sendSolTo", () => {
  it("moves the exact amount on to a third party, the owner paying its own fee", async () => {
    const funder = freshKeypair();
    const owner = freshKeypair();
    const recipient = freshKeypair();
    await airdropSol(funder.publicKey, 1);
    await depositSol(funder, owner.publicKey, 0.4);
    await waitForBalance(connection, owner.publicKey, (l) => l === solToLamports(0.4));

    await sendSolTo(owner, funder, recipient.publicKey, 0.15);

    const recipientBalance = await waitForBalance(
      connection,
      recipient.publicKey,
      (lamports) => lamports === solToLamports(0.15),
    );
    expect(recipientBalance).toBe(solToLamports(0.15));

    // The owner paid for its own send: the amount and the fee both left it.
    const ownerBalance = await connection.getBalance(owner.publicKey);
    expect(ownerBalance).toBe(solToLamports(0.4) - solToLamports(0.15) - NETWORK_FEE_LAMPORTS);
  });

  it("lets an account send its entire balance, the fee coming out of the amount", async () => {
    const funder = freshKeypair();
    const owner = freshKeypair();
    const recipient = freshKeypair();
    await airdropSol(funder.publicKey, 1);
    await depositSol(funder, owner.publicKey, 0.2);
    await waitForBalance(connection, owner.publicKey, (l) => l === solToLamports(0.2));

    await sendSolTo(owner, funder, recipient.publicKey, 0.2);

    await waitForBalance(
      connection,
      recipient.publicKey,
      (l) => l === solToLamports(0.2) - NETWORK_FEE_LAMPORTS,
    );
    expect(await getWalletBalanceSol(owner.publicKey)).toBe(0);
  });
});
