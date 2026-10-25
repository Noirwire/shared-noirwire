/* eslint-disable @typescript-eslint/no-explicit-any -- the SDKs are loaded from a sibling checkout at run time and have no types here */
/**
 * Writes tests/fixtures/walletBridge/transactions.json: one golden message for
 * every shape the wallet bridge signs, built by the real order book SDK and
 * the real MagicBlock SDK with the options the trading terminal passes them.
 * CI only reads the file.
 *
 * Run by hand, against a checkout of the trading terminal that has its
 * dependencies installed (it carries both SDKs):
 *
 *   node scripts/wallet-bridge-fixtures.mts ../terminal-noirwire
 *
 * Every key is derived from a fixed seed, so a rerun with the same SDK
 * versions writes the same file.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const terminal = resolve(process.argv[2] ?? "../terminal-noirwire");
const here = dirname(fileURLToPath(import.meta.url));
const output = join(here, "../tests/fixtures/walletBridge/transactions.json");

const require = createRequire(join(terminal, "package.json"));
const load = (name: string): Promise<any> => import(pathToFileURL(require.resolve(name)).href);
const web3 = await load("@solana/web3.js");
const token = await load("@solana/spl-token");
const magic = await load("@magicblock-labs/ephemeral-rollups-sdk");
const orderbook = await import(
  pathToFileURL(join(terminal, "node_modules/@noirwire/orderbook/dist/index.js")).href
);

const { Keypair, PublicKey, Transaction } = web3;

const keyFrom = (label: string) =>
  Keypair.fromSeed(createHash("sha256").update(`wallet-bridge-fixture:${label}`).digest());

const PROGRAM = new PublicKey("BrUoDsreaeXWypVxh6LoGseqwB4TZVJZBxvhfxXprvwP");
const VALIDATOR = new PublicKey("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");
const MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const CUSTODY_NONCE = 424242n;
const BLOCKHASH = keyFrom("blockhash").publicKey.toBase58();

const owner = keyFrom("owner").publicKey;
const gate = keyFrom("gate").publicKey;
const orderKeys = [1, 2, 3, 4].map((at) => keyFrom(`order-key-${at}`).publicKey);

const addresses = new orderbook.Addresses(PROGRAM);
const instructions = new orderbook.Instructions(PROGRAM);
const custodyToken = { mint: MINT, custodyNonce: CUSTODY_NONCE };
const ownerToken = token.getAssociatedTokenAddressSync(MINT, owner, true);

const DEPOSIT = 50_000_000n;
const WITHDRAW = 25_500_000n;
const SOLANA_DEPOSIT = 12_340_000n;
const SOLANA_WITHDRAW = 7_000_001n;

function messageHex(feePayer: any, steps: any[]): string {
  const transaction = new Transaction();
  transaction.feePayer = feePayer;
  transaction.recentBlockhash = BLOCKHASH;
  transaction.add(...steps);
  return Buffer.from(transaction.compileMessage().serialize()).toString("hex");
}

async function delegation(first: boolean, isPrivate: boolean, shuttleId: number) {
  const steps = await magic.delegateSpl(owner, MINT, SOLANA_DEPOSIT, {
    validator: VALIDATOR,
    idempotent: !first,
    payer: owner,
    initVaultIfMissing: false,
    private: isPrivate,
    shuttleId,
  });
  if (isPrivate && first) {
    const [balance] = magic.deriveEphemeralAta(owner, MINT);
    steps.push(magic.delegateEataPermissionIx(owner, balance, VALIDATOR));
  }
  return steps;
}

const cases = {
  openTrader: {
    network: "rollup",
    privateBalance: true,
    message: messageHex(gate, [instructions.openTrader(gate, owner, orderKeys)]),
  },
  setOrderKeys: {
    network: "rollup",
    privateBalance: true,
    message: messageHex(owner, [instructions.setOrderKeys(owner, orderKeys)]),
  },
  deposit: {
    network: "rollup",
    privateBalance: true,
    amountAtoms: DEPOSIT.toString(),
    message: messageHex(owner, [
      instructions.deposit(owner, ownerToken, custodyToken, owner, { collateral: true }, DEPOSIT),
    ]),
  },
  withdraw: {
    network: "rollup",
    privateBalance: true,
    amountAtoms: WITHDRAW.toString(),
    message: messageHex(owner, [
      instructions.withdraw(owner, ownerToken, custodyToken, { collateral: true }, WITHDRAW, [0]),
    ]),
  },
  depositFirstPrivate: {
    network: "solana",
    privateBalance: true,
    amountAtoms: SOLANA_DEPOSIT.toString(),
    message: messageHex(owner, await delegation(true, true, 7)),
  },
  depositFirstPublic: {
    network: "solana",
    privateBalance: false,
    amountAtoms: SOLANA_DEPOSIT.toString(),
    message: messageHex(owner, await delegation(true, false, 7)),
  },
  depositRepeatPrivate: {
    network: "solana",
    privateBalance: true,
    amountAtoms: SOLANA_DEPOSIT.toString(),
    message: messageHex(owner, await delegation(false, true, 7)),
  },
  depositRepeatPublic: {
    network: "solana",
    privateBalance: false,
    amountAtoms: SOLANA_DEPOSIT.toString(),
    message: messageHex(owner, await delegation(false, false, 7)),
  },
  withdrawToSolana: {
    network: "solana",
    privateBalance: true,
    amountAtoms: SOLANA_WITHDRAW.toString(),
    message: messageHex(
      owner,
      await magic.withdrawSpl(owner, MINT, SOLANA_WITHDRAW, {
        validator: VALIDATOR,
        payer: owner,
        initAtasIfMissing: true,
        shuttleId: 9,
      }),
    ),
  },
};

const fixture = {
  meta: {
    orderbookProgram: PROGRAM.toBase58(),
    validator: VALIDATOR.toBase58(),
    usdcMint: MINT.toBase58(),
    custodyNonce: CUSTODY_NONCE.toString(),
    custodyAuthority: addresses.custodyAuthority(CUSTODY_NONCE).toBase58(),
    owner: owner.toBase58(),
    gate: gate.toBase58(),
    orderKeys: orderKeys.map((key: any) => key.toBase58()),
    recentBlockhash: BLOCKHASH,
  },
  cases,
};

writeFileSync(output, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`wrote ${Object.keys(cases).length} messages to ${output}`);
