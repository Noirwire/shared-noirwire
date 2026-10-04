import { describe, expect, it } from "vitest";
import { isTransient } from "../../src/application/retries.js";
import { API_ERRORS, ApiError, apiErrorIn, type ApiErrorCode } from "../../src/domain/apiError.js";
import { failureMessage } from "../../src/presentation/actionResult.js";
import { failedOf } from "../../src/application/actions/common.js";

describe("the server's own errors", () => {
  it("are told from a provider's by their shape: a code and a sentence, both strings", () => {
    expect(apiErrorIn(429, { code: "rate_limited", error: "Too many requests." })).toMatchObject({
      code: "rate_limited",
      status: 429,
    });
    // A JSON-RPC error and a provider's refusal pass through as they are.
    expect(apiErrorIn(400, { jsonrpc: "2.0", error: { code: -32602, message: "no" } })).toBeNull();
    expect(apiErrorIn(400, { error: "Failed to get quotes" })).toBeNull();
    expect(apiErrorIn(400, { error: { code: "bad", message: "no" } })).toBeNull();
    expect(apiErrorIn(200, { code: "rate_limited", error: "x" })).toBeNull();
    expect(apiErrorIn(502, null)).toBeNull();
  });

  it.each(Object.keys(API_ERRORS) as ApiErrorCode[])(
    "%s is asked again exactly when the server did nothing and may do it shortly",
    (code) => {
      const again = [
        "request_timeout",
        "rate_limited",
        "internal_error",
        "upstream_failed",
        "no_answer",
        "unavailable",
        "relayer_unavailable",
        "upstream_not_reached",
        "upstream_timeout",
        "response_timeout",
      ].includes(code);
      const error = new ApiError(code, API_ERRORS[code].status);
      expect(error.asksAgain).toBe(again);
      expect(isTransient(error)).toBe(again);
    },
  );

  it("judges a code it does not know by its status", () => {
    expect(new ApiError("something_new", 503).asksAgain).toBe(true);
    expect(new ApiError("something_new", 409).asksAgain).toBe(false);
  });

  it.each(Object.keys(API_ERRORS) as ApiErrorCode[])(
    "%s is worded for a person by what the app was doing, never by the code or the sentence",
    (code) => {
      const failed = failedOf("sendFailed", new ApiError(code, API_ERRORS[code].status));
      expect(failureMessage(failed)).toBe(
        "We couldn't complete this send. Nothing was sent. Try again.",
      );
    },
  );
});
