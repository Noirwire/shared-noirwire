import { MAX_UNUSED_PORTFOLIOS_IN_A_ROW } from "../../domain/importResolution.js";
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
 * Whether the wallet's own record shows the portfolio was ever used: it holds
 * something, or something it did is in the activity list. A reservation that
 * never sent anything is not use. This errs toward "never used": a portfolio
 * that received something this device has not read yet counts as unused
 * until it has.
 */
function everUsed(wallet: Wallet, portfolio: Portfolio): boolean {
  return (
    portfolio.holdings.some((holding) => holding.amount > 0) ||
    wallet.activity.some((entry) => entry.portfolioId === portfolio.id)
  );
}

/**
 * How many derivation indices in a row, past the last portfolio that was
 * ever used, have never been used, archived portfolios included. An import
 * scans for portfolios until it meets `DISCOVERY_GAP` unused addresses in a
 * row, so this run is what stands between a restore and the next portfolio
 * to be created.
 */
export function unusedPortfoliosInARow(wallet: Wallet, fundingIndex: number): number {
  const lastUsed = wallet.portfolios
    .filter((portfolio) => everUsed(wallet, portfolio))
    .reduce((max, portfolio) => Math.max(max, portfolio.derivationIndex), fundingIndex);
  return nextDerivationIndex(wallet, fundingIndex) - 1 - lastUsed;
}

/** Whether another portfolio may be created without putting it out of an import's reach. */
export function canCreatePortfolio(wallet: Wallet, fundingIndex: number): boolean {
  return unusedPortfoliosInARow(wallet, fundingIndex) < MAX_UNUSED_PORTFOLIOS_IN_A_ROW;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Whether another portfolio of the wallet, archived ones included, already
 * goes by `label`, whatever its capitals or the spaces around it. `exceptId`
 * leaves out the portfolio being renamed.
 */
export function portfolioNameTaken(wallet: Wallet, label: string, exceptId?: string): boolean {
  return wallet.portfolios.some(
    (portfolio) => portfolio.id !== exceptId && sameName(portfolio.label, label),
  );
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
 *
 * Refused with `unusedPortfolios` while the wallet already ends in
 * `MAX_UNUSED_PORTFOLIOS_IN_A_ROW` portfolios that were never used: one more,
 * funded, could lie past where an import of the phrase stops looking.
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
    let tooManyUnused = false;
    let nameTaken = false;
    const saved = await deps.store.update((current) => {
      nameTaken = portfolioNameTaken(current, label, portfolio?.id);
      tooManyUnused = !canCreatePortfolio(current, deps.fundingIndex);
      if (nameTaken || tooManyUnused) return current;
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

    if (nameTaken) return refused("duplicateName");
    if (tooManyUnused) return refused("unusedPortfolios");
    if (!saved || !portfolio) return refused("portfolioNotSaved");
    deps.track("account_created", { kind: pie ? "pie" : "portfolio" });
    return { kind: "created", portfolio };
  });
}
