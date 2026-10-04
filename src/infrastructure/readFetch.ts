import { isBusyStatus, readWithRetries } from "../application/retries.js";
import { authorizedFetch } from "./apiSession.js";

/**
 * `fetch` for a read: a request that moves nothing and can be asked again.
 * One that never gets through, or comes back 429 or 5xx, is asked again a
 * few times with a short pause before the failure is thrown, and one the
 * server turns down for its session is made once more with a renewed one.
 * Never for a request that submits a signed transaction.
 */
export function readFetch(input: string, init?: RequestInit): Promise<Response> {
  return readWithRetries(async () => {
    const response = await authorizedFetch(input, { ...init, asksAgain: true });
    if (isBusyStatus(response.status)) throw new Error(`${response.status} from a read.`);
    return response;
  });
}
