import { ChainError } from "../../domain/chainError.js";
import { connection } from "./client.js";
import { expectedGenesisHash } from "./config.js";

/**
 * Asks the connection which chain it serves, by its genesis hash, and
 * refuses with `ChainError("wrongNetwork")` unless it is the one this app is
 * built for. Checked right before every signature, not only at start: the
 * relay or the provider behind it can change while the app runs.
 */
export async function confirmNetwork(): Promise<void> {
  if ((await connection.getGenesisHash()) !== expectedGenesisHash()) {
    throw new ChainError("wrongNetwork");
  }
}
