import { isBusyStatus, readWithRetries } from "../application/retries.js";

/**
 * `fetch` for a read: a request that moves nothing and can be asked again.
 * One that never gets through, or comes back 429 or 5xx, is asked again a
 * few times with a short pause before the failure is thrown. Never for a
 * request that submits a signed transaction.
 */
export function readFetch(input: string, init?: RequestInit): Promise<Response> {
  return readWithRetries(async () => {
    const response = await fetch(input, init);
    if (isBusyStatus(response.status)) throw new Error(`${response.status} from a read.`);
    return response;
  });
}
