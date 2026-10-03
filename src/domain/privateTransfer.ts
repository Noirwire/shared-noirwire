/**
 * The settlement window the queue may deliver in. A private transfer is
 * unlinkable because it settles out of the program's queue rather than as a
 * direct transfer; the delay and the split are what additionally blur *when*
 * and *how much*. Wider is more private and slower - this pair is the
 * smallest that still separates send from arrival for a person watching,
 * and it is the number the UI quotes rather than a vaguer promise.
 */
export const SETTLEMENT_DELAY_MS = { min: 2_000, max: 15_000 } as const;

/** MagicBlock's published privacy fee on a private base-to-base transfer. */
export const PRIVACY_FEE_BPS = 10;

/**
 * Every transfer is built gasless: the service's sponsor pays the network fee
 * and the rent of the accounts a first transfer opens, and is paid back a
 * flat relay fee in the token being moved. The funding wallet therefore needs
 * no SOL at all. Both figures are MagicBlock's published ones, and both
 * networks this app runs on support the mode for USDC, so there is no
 * self-paid path to fall back to.
 *
 * `RELAY_FEE_RAW` is also the ceiling the check before signing enforces: a
 * transaction whose relay-fee transfer moves more than this is refused.
 */
export const RELAY_FEE_RAW = 200_000n;
export const MIN_TRANSFER_RAW = 500_000n;

/** The privacy fee on `amountRaw`, rounded up so the limit never sits below the real charge. */
export function privacyFeeFor(amountRaw: bigint): bigint {
  return (amountRaw * BigInt(PRIVACY_FEE_BPS) + 9_999n) / 10_000n;
}

/**
 * What a private transfer of `amount` costs, in the token's own units, for a
 * token of `decimals`. The funding wallet pays no SOL: the network fee is the
 * service's, and it is paid back by the flat relay fee.
 */
export function privateTransferCosts(amount: number, decimals: number) {
  const units = (raw: bigint) => Number(raw) / 10 ** decimals;
  // Summed in base units, so the total is the figure the check before signing enforces.
  const raw = Number.isFinite(amount)
    ? BigInt(Math.round(Math.max(amount, 0) * 10 ** decimals))
    : 0n;
  const privacyFee = privacyFeeFor(raw);
  return {
    privacyFee: units(privacyFee),
    relayFee: units(RELAY_FEE_RAW),
    minimum: units(MIN_TRANSFER_RAW),
    total: units(raw + privacyFee + RELAY_FEE_RAW),
  };
}
