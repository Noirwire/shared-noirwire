import type { PortfolioIcon } from "../../domain/portfolioIcon.js";
import type { PieSlice, Portfolio, Wallet } from "../../domain/wallet.js";
import type { PieProblem } from "../pie.js";
import type { OpenSession, Signer, Track, WalletStore } from "../ports.js";
import { refused, type Refused } from "../result.js";
import { openSession } from "./common.js";

export type CreatePortfolioDeps<K extends Signer> = {
  session: OpenSession<K>;
  store: WalletStore;
  track: Track;
  pieProblem(pie: PieSlice[]): PieProblem | null;
  /** A new portfolio record for the key at `derivationIndex`, whose address is `address`. */
  newPortfolio(label: string, address: string, derivationIndex: number): Portfolio;
  /** The derivation index the funding wallet owns. */
  fundingIndex: number;
};

export type CreatePortfolioResult =
  { kind: "created"; portfolio: Portfolio } | { kind: "invalidPie"; problem: PieProblem } | Refused;

/** The next free SLIP-0010 index: the funding wallet owns 0, so the first created portfolio is 1. */
export function nextDerivationIndex(wallet: Wallet, fundingIndex: number): number {
  const highest = wallet.portfolios.reduce(
    (max, portfolio) => Math.max(max, portfolio.derivationIndex),
    0,
  );
  return Math.max(highest, fundingIndex) + 1;
}

/**
 * Creates the next portfolio: derive the keypair, remember it, done.
 * With `pie`, the portfolio is a pie steered toward that mix.
 *
 * No transaction, no cost, no network round trip. A Solana account is a
 * keypair; nothing has to be registered on chain before it can receive.
 *
 * Creation is serialised across tabs, and the index is chosen from the
 * wallet the change is applied to. When another tab stored a portfolio this
 * tab has not seen, the store applies the change again to that newer
 * record, which picks the next index past it - so two tabs creating at
 * once can neither share a keypair nor lose a portfolio.
 */
export async function createPortfolio<K extends Signer>(
  deps: CreatePortfolioDeps<K>,
  input: { label: string; pie?: PieSlice[]; icon?: PortfolioIcon },
): Promise<CreatePortfolioResult> {
  const { label, pie, icon } = input;
  // Guard: a mix that cannot be saved is refused before anything is derived.
  const problem = pie && deps.pieProblem(pie);
  if (problem) return { kind: "invalidPie", problem };

  return deps.store.serialised("noirwire-wallet-accounts", async () => {
    const session = openSession(deps.session);
    if ("kind" in session) return session;

    let portfolio: Portfolio | undefined;
    const saved = await deps.store.update((current) => {
      const index = nextDerivationIndex(current, deps.fundingIndex);
      const key = session.keyAt(index);
      // Locked while this was waiting its turn: the wallet is left as it is.
      if (!key) return current;
      const created = deps.newPortfolio(label, key.publicKey.toBase58(), index);
      // This can run a second time against a newer stored record: the
      // index is chosen again, the id handed to the caller stays.
      portfolio = {
        ...created,
        id: portfolio?.id ?? created.id,
        ...(pie ? { pie } : {}),
        ...(icon ? { icon } : {}),
      };
      return { ...current, portfolios: [portfolio, ...current.portfolios] };
    });

    if (!saved || !portfolio) return refused("portfolioNotSaved");
    deps.track("account_created", { kind: pie ? "pie" : "portfolio" });
    return { kind: "created", portfolio };
  });
}
