import type { RefusalReason } from "../application/result.js";
import { refusalCopy } from "../copy/refusal.js";

const MESSAGES: Record<RefusalReason, string> = refusalCopy;

/** What a person is told when an action is refused for `reason`. */
export function refusalMessage(reason: RefusalReason): string {
  return MESSAGES[reason];
}
