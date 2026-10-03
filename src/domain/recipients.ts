export type RecipientClass =
  | { kind: "own"; label: string; which: "funding" | "portfolio" }
  | { kind: "known" }
  | { kind: "lookalike"; address: string; label?: string }
  | { kind: "new" };

type RecipientHistory = {
  funding: { address: string };
  portfolios: { address: string; label: string }[];
  activity: { kind: string; counterparty?: string }[];
};

/**
 * Characters matched at each end to call an address a look-alike. Poisoning
 * attacks grind vanity addresses that copy the start and end a person glances
 * at; real ones often match only three on each side. A chance 3+3 match
 * between two honest base58 addresses is about 1 in 38 billion.
 */
const LOOKALIKE_EDGE = 3;

/** Exact addresses take priority over the matching-ends poisoning pattern. */
export function classifyRecipient(
  address: string,
  wallet: RecipientHistory | null,
): RecipientClass {
  if (!wallet) return { kind: "new" };

  const own = [
    { address: wallet.funding.address, label: "Funding wallet", which: "funding" as const },
    ...wallet.portfolios.map((portfolio) => ({
      address: portfolio.address,
      label: portfolio.label,
      which: "portfolio" as const,
    })),
  ];
  const ownMatch = own.find((entry) => entry.address === address);
  if (ownMatch) return { kind: "own", label: ownMatch.label, which: ownMatch.which };

  const previous = wallet.activity.flatMap((entry) =>
    entry.kind === "send" && entry.counterparty ? [entry.counterparty] : [],
  );
  if (previous.includes(address)) return { kind: "known" };

  const similar = [
    ...own.map(({ address, label }) => ({ address, label })),
    ...previous.map((entry) => ({ address: entry, label: undefined })),
  ].find(
    (entry) =>
      entry.address !== address &&
      entry.address.slice(0, LOOKALIKE_EDGE) === address.slice(0, LOOKALIKE_EDGE) &&
      entry.address.slice(-LOOKALIKE_EDGE) === address.slice(-LOOKALIKE_EDGE),
  );
  if (similar) return { kind: "lookalike", address: similar.address, label: similar.label };
  return { kind: "new" };
}
