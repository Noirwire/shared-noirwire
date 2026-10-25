import "../buffer-polyfill.js";

import { Buffer } from "buffer";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  ATA_PROGRAM,
  DELEGATION_PROGRAM,
  DISCRIMINATORS,
  EPHEMERAL_VAULT,
  ESPL_PROGRAM,
  MAGIC_PROGRAM,
  PERMISSION_PROGRAM,
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
  type BridgePins,
} from "./pins.js";

/**
 * The instructions the wallet is willing to sign, built here from its own
 * pins and the few values it reads out of a request (an amount, a shuttle
 * id, four order keys). The request's bytes are accepted only when they are
 * identical to a message made of these, so there is no field of a signed
 * message that the terminal alone decided.
 */

type Meta = { pubkey: PublicKey; isSigner: boolean; isWritable: boolean };

const signer = (pubkey: PublicKey): Meta => ({ pubkey, isSigner: true, isWritable: false });
const payer = (pubkey: PublicKey): Meta => ({ pubkey, isSigner: true, isWritable: true });
const writable = (pubkey: PublicKey): Meta => ({ pubkey, isSigner: false, isWritable: true });
const readonly = (pubkey: PublicKey): Meta => ({ pubkey, isSigner: false, isWritable: false });

const text = (value: string) => new TextEncoder().encode(value);
const find = (program: PublicKey, ...seeds: Uint8Array[]) =>
  PublicKey.findProgramAddressSync(seeds, program)[0];

function tag(...bytes: number[]): Buffer {
  return Buffer.from(bytes);
}

function hex(value: string): Buffer {
  return Buffer.from(value, "hex");
}

function u64(value: bigint): Buffer {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return Buffer.from(bytes);
}

function u32(value: number): Buffer {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return Buffer.from(bytes);
}

/** Every address the order book derives for one owner, from the pinned program. */
export function orderbookAddresses(pins: BridgePins, owner: PublicKey) {
  const program = pins.orderbookProgram;
  const view = find(program, text("view"), owner.toBytes());
  return {
    exchange: find(program, text("exchange")),
    ledger: find(program, text("ledger")),
    view,
    viewPermission: permissionOf(view),
    ownerToken: tokenAccount(owner, pins.usdcMint),
    riskAccounts: pins.marketIds.flatMap((id) =>
      ["market", "book", "price"].map((seed) => find(program, text(seed), Uint8Array.of(id))),
    ),
  };
}

export function tokenAccount(owner: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, true, TOKEN_PROGRAM, ATA_PROGRAM);
}

function permissionOf(account: PublicKey): PublicKey {
  return find(PERMISSION_PROGRAM, text("permission:"), account.toBytes());
}

function custody(pins: BridgePins): { authority: PublicKey; account: PublicKey } | null {
  if (!pins.custodyAuthority) return null;
  return {
    authority: pins.custodyAuthority,
    account: tokenAccount(pins.custodyAuthority, pins.usdcMint),
  };
}

function orderbook(pins: BridgePins, keys: Meta[], data: Buffer): TransactionInstruction {
  return new TransactionInstruction({ programId: pins.orderbookProgram, keys, data });
}

export function openTrader(
  pins: BridgePins,
  gate: PublicKey,
  owner: PublicKey,
  orderKeys: PublicKey[],
): TransactionInstruction {
  const a = orderbookAddresses(pins, owner);
  return orderbook(
    pins,
    [
      signer(gate),
      signer(owner),
      writable(a.exchange),
      writable(a.ledger),
      writable(a.view),
      writable(a.viewPermission),
      readonly(PERMISSION_PROGRAM),
      writable(EPHEMERAL_VAULT),
      readonly(MAGIC_PROGRAM),
    ],
    Buffer.concat([hex(DISCRIMINATORS.openTrader), ...orderKeys.map((key) => key.toBuffer())]),
  );
}

export function setOrderKeys(
  pins: BridgePins,
  owner: PublicKey,
  orderKeys: PublicKey[],
): TransactionInstruction {
  return orderbook(
    pins,
    [signer(owner), writable(orderbookAddresses(pins, owner).view)],
    Buffer.concat([hex(DISCRIMINATORS.setOrderKeys), ...orderKeys.map((key) => key.toBuffer())]),
  );
}

/** The collateral deposit of `amount` from the owner's own token account into the owner's own seat. */
export function deposit(
  pins: BridgePins,
  owner: PublicKey,
  amount: bigint,
): TransactionInstruction | null {
  const held = custody(pins);
  if (!held) return null;
  const a = orderbookAddresses(pins, owner);
  return orderbook(
    pins,
    [
      signer(owner),
      readonly(a.exchange),
      writable(a.ledger),
      readonly(a.view),
      readonly(held.authority),
      writable(held.account),
      writable(a.ownerToken),
      readonly(TOKEN_PROGRAM),
    ],
    Buffer.concat([hex(DISCRIMINATORS.deposit), tag(0), u64(amount)]),
  );
}

/** The collateral withdrawal of `amount` from the owner's seat into the owner's own token account. */
export function withdraw(
  pins: BridgePins,
  owner: PublicKey,
  amount: bigint,
): TransactionInstruction | null {
  const held = custody(pins);
  if (!held) return null;
  const a = orderbookAddresses(pins, owner);
  return orderbook(
    pins,
    [
      signer(owner),
      readonly(a.exchange),
      writable(a.ledger),
      writable(a.view),
      readonly(held.authority),
      writable(held.account),
      writable(a.ownerToken),
      readonly(TOKEN_PROGRAM),
      ...a.riskAccounts.map(readonly),
    ],
    Buffer.concat([hex(DISCRIMINATORS.withdraw), tag(0), u64(amount)]),
  );
}

/** The accounts of the ephemeral token program that belong to one owner and mint. */
function ephemeral(owner: PublicKey, mint: PublicKey) {
  const eata = find(ESPL_PROGRAM, owner.toBytes(), mint.toBytes());
  const vault = find(ESPL_PROGRAM, mint.toBytes());
  return {
    eata,
    vault,
    vaultToken: tokenAccount(vault, mint),
    rent: find(ESPL_PROGRAM, text("rent")),
  };
}

function shuttle(owner: PublicKey, mint: PublicKey, id: number) {
  const eata = find(ESPL_PROGRAM, owner.toBytes(), mint.toBytes(), u32(id));
  return {
    eata,
    ata: find(ESPL_PROGRAM, eata.toBytes(), mint.toBytes()),
    walletToken: tokenAccount(eata, mint),
  };
}

/** The three accounts the delegation program keeps for something delegated from `program`. */
function delegation(account: PublicKey, program: PublicKey) {
  return [
    find(program, text("buffer"), account.toBytes()),
    find(DELEGATION_PROGRAM, text("delegation"), account.toBytes()),
    find(DELEGATION_PROGRAM, text("delegation-metadata"), account.toBytes()),
  ];
}

function espl(keys: Meta[], data: Buffer): TransactionInstruction {
  return new TransactionInstruction({ programId: ESPL_PROGRAM, keys, data });
}

export function createTokenAccount(owner: PublicKey, mint: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: ATA_PROGRAM,
    keys: [
      payer(owner),
      writable(tokenAccount(owner, mint)),
      readonly(owner),
      readonly(mint),
      readonly(SYSTEM_PROGRAM),
      readonly(TOKEN_PROGRAM),
    ],
    data: tag(1),
  });
}

export function initEphemeralAta(owner: PublicKey, mint: PublicKey): TransactionInstruction {
  return espl(
    [
      writable(ephemeral(owner, mint).eata),
      payer(owner),
      readonly(owner),
      readonly(mint),
      readonly(SYSTEM_PROGRAM),
    ],
    tag(0),
  );
}

export function transferToVault(
  owner: PublicKey,
  mint: PublicKey,
  amount: bigint,
): TransactionInstruction {
  const e = ephemeral(owner, mint);
  return espl(
    [
      writable(e.eata),
      readonly(e.vault),
      readonly(mint),
      writable(tokenAccount(owner, mint)),
      writable(e.vaultToken),
      signer(owner),
      readonly(TOKEN_PROGRAM),
    ],
    Buffer.concat([tag(2), u64(amount)]),
  );
}

export function createEataPermission(owner: PublicKey, mint: PublicKey): TransactionInstruction {
  const eata = ephemeral(owner, mint).eata;
  return espl(
    [
      writable(eata),
      writable(permissionOf(eata)),
      payer(owner),
      readonly(SYSTEM_PROGRAM),
      readonly(PERMISSION_PROGRAM),
    ],
    tag(6, 0),
  );
}

export function delegateEphemeralAta(
  owner: PublicKey,
  mint: PublicKey,
  validator: PublicKey,
): TransactionInstruction {
  const eata = ephemeral(owner, mint).eata;
  return espl(
    [
      payer(owner),
      writable(eata),
      readonly(ESPL_PROGRAM),
      ...delegation(eata, ESPL_PROGRAM).map(writable),
      readonly(DELEGATION_PROGRAM),
      readonly(SYSTEM_PROGRAM),
    ],
    Buffer.concat([tag(4), validator.toBuffer()]),
  );
}

export function delegateEataPermission(
  owner: PublicKey,
  mint: PublicKey,
  validator: PublicKey,
): TransactionInstruction {
  const eata = ephemeral(owner, mint).eata;
  const permission = permissionOf(eata);
  return espl(
    [
      payer(owner),
      writable(eata),
      readonly(PERMISSION_PROGRAM),
      writable(permission),
      readonly(SYSTEM_PROGRAM),
      ...delegation(permission, PERMISSION_PROGRAM).map(writable),
      readonly(DELEGATION_PROGRAM),
      readonly(validator),
    ],
    tag(7),
  );
}

export function setupAndDelegateShuttle(
  owner: PublicKey,
  mint: PublicKey,
  validator: PublicKey,
  shuttleId: number,
  amount: bigint,
): TransactionInstruction {
  const e = ephemeral(owner, mint);
  const s = shuttle(owner, mint, shuttleId);
  const ownerToken = tokenAccount(owner, mint);
  return espl(
    [
      payer(owner),
      writable(e.rent),
      writable(s.eata),
      writable(s.ata),
      writable(s.walletToken),
      signer(owner),
      readonly(ESPL_PROGRAM),
      ...delegation(s.ata, ESPL_PROGRAM).map(writable),
      readonly(DELEGATION_PROGRAM),
      readonly(ATA_PROGRAM),
      readonly(SYSTEM_PROGRAM),
      writable(ownerToken),
      readonly(mint),
      readonly(TOKEN_PROGRAM),
      readonly(e.vault),
      writable(ownerToken),
      writable(e.vaultToken),
    ],
    Buffer.concat([tag(24), u32(shuttleId), u64(amount), validator.toBuffer()]),
  );
}

export function withdrawThroughShuttle(
  owner: PublicKey,
  mint: PublicKey,
  validator: PublicKey,
  shuttleId: number,
  amount: bigint,
): TransactionInstruction {
  const e = ephemeral(owner, mint);
  const s = shuttle(owner, mint, shuttleId);
  return espl(
    [
      payer(owner),
      writable(e.rent),
      writable(s.eata),
      writable(s.ata),
      writable(s.walletToken),
      signer(owner),
      readonly(ESPL_PROGRAM),
      ...delegation(s.ata, ESPL_PROGRAM).map(writable),
      readonly(DELEGATION_PROGRAM),
      readonly(ATA_PROGRAM),
      readonly(SYSTEM_PROGRAM),
      writable(tokenAccount(owner, mint)),
      readonly(mint),
      readonly(TOKEN_PROGRAM),
    ],
    Buffer.concat([tag(26), u32(shuttleId), u64(amount), validator.toBuffer()]),
  );
}
