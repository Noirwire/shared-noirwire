import { isBusyStatus, readWithRetries } from "../application/retries.js";
import { apiErrorOf, authorizedFetch } from "./apiSession.js";

/**
 * `fetch` for a read: a request that moves nothing and can be asked again.
 * One that never gets through, or comes back busy (by the server's own code,
 * or a 429 or 5xx from anyone else), is asked again a few times with a short pause before the failure is thrown, and one the
 * server turns down for its session is made once more with a renewed one.
 * Never for a request that submits a signed transaction.
 */
export function readFetch(input: string, init?: RequestInit): Promise<Response> {
  return readWithRetries(async () => {
    const response = await authorizedFetch(input, { ...init, asksAgain: true });
    const refusal = await apiErrorOf(response);
    if (refusal?.asksAgain) throw refusal;
    if (!refusal && isBusyStatus(response.status)) {
      throw new Error(`${response.status} from a read.`);
    }
    return response;
  });
}
