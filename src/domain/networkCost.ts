/**
 * Whose token account an action opens, which is what makes its network cost
 * larger: the recipient's, or this portfolio's own for Earn, for a tracker it
 * is buying for the first time, or for the cash a withdrawal returns.
 */
export type Opens = "recipient" | "earn" | "holding" | "cash";
