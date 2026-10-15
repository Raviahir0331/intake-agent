import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retryAfterMs, withRetry } from "../src/shared/retry";

function rateLimitError(message: string, headers?: Headers | Record<string, string>) {
  return Object.assign(new Error(message), { status: 429, headers });
}

describe("retryAfterMs", () => {
  it("reads retry-after in seconds from a Headers object", () => {
    expect(retryAfterMs(rateLimitError("429", new Headers({ "retry-after": "7" })))).toBe(7_000);
  });

  it("prefers retry-after-ms over retry-after", () => {
    const headers = { "retry-after-ms": "1500", "retry-after": "9" };
    expect(retryAfterMs(rateLimitError("429", headers))).toBe(1_500);
  });

  it("reads retry-after as an HTTP date", () => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    const headers = { "retry-after": "Thu, 15 Oct 2026 12:00:05 GMT" };
    expect(retryAfterMs(rateLimitError("429", headers), now)).toBe(5_000);
  });

  it("falls back to Groq's 'try again in' hint in the message", () => {
    const groq =
      "Rate limit reached for model `openai/gpt-oss-120b` on tokens per minute (TPM). Please try again in 7.66s.";
    expect(retryAfterMs(rateLimitError(groq))).toBeCloseTo(7_660);
    expect(retryAfterMs(rateLimitError("Please try again in 1m2.5s."))).toBe(62_500);
    expect(retryAfterMs(rateLimitError("Please try again in 450ms."))).toBe(450);
  });

  it("returns undefined when the server gave no hint", () => {
    expect(retryAfterMs(rateLimitError("Too many requests"))).toBeUndefined();
    expect(retryAfterMs("not an error")).toBeUndefined();
  });
});

describe("withRetry on 429", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("waits for the server's retry-after instead of the backoff schedule", async () => {
    const task = vi
      .fn()
      .mockRejectedValueOnce(rateLimitError("429", new Headers({ "retry-after": "5" })))
      .mockResolvedValue("ok");
    const result = withRetry("test", task, { attempts: 3, baseDelayMs: 100 });

    await vi.advanceTimersByTimeAsync(4_999);
    expect(task).toHaveBeenCalledTimes(1); // backoff alone would have retried after 100ms
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe("ok");
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("caps a huge retry-after at maxRetryAfterMs", async () => {
    const task = vi
      .fn()
      .mockRejectedValueOnce(rateLimitError("429", { "retry-after": "3600" }))
      .mockResolvedValue("ok");
    const result = withRetry("test", task, { maxRetryAfterMs: 2_000 });

    await vi.advanceTimersByTimeAsync(2_000);
    await expect(result).resolves.toBe("ok");
  });

  it("allows rateLimitAttempts tries for 429s but only attempts for other failures", async () => {
    const limited = vi.fn().mockRejectedValue(rateLimitError("Please try again in 1s."));
    const limitedResult = withRetry("test", limited, { attempts: 2, rateLimitAttempts: 5 });
    const limitedAssertion = expect(limitedResult).rejects.toThrow("try again");
    await vi.advanceTimersByTimeAsync(10_000);
    await limitedAssertion;
    expect(limited).toHaveBeenCalledTimes(5);

    const serverError = Object.assign(new Error("boom"), { status: 503 });
    const failing = vi.fn().mockRejectedValue(serverError);
    const failingResult = withRetry("test", failing, { attempts: 2, rateLimitAttempts: 5 });
    const failingAssertion = expect(failingResult).rejects.toThrow("boom");
    await vi.advanceTimersByTimeAsync(10_000);
    await failingAssertion;
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("uses exponential backoff for a 429 without a hint", async () => {
    const task = vi
      .fn()
      .mockRejectedValueOnce(rateLimitError("Too many requests"))
      .mockRejectedValueOnce(rateLimitError("Too many requests"))
      .mockResolvedValue("ok");
    const result = withRetry("test", task, { attempts: 3, baseDelayMs: 100 });

    await vi.advanceTimersByTimeAsync(100);
    expect(task).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(200);
    await expect(result).resolves.toBe("ok");
  });
});
