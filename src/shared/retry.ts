import { logger } from "./logger";

type RetryOptions = {
  attempts?: number;
  /** Attempts allowed when the failure is a 429. Defaults to `attempts`; never lower than it. */
  rateLimitAttempts?: number;
  baseDelayMs?: number;
  /** Upper bound on a server-requested wait, so a bogus retry-after can't stall the run. */
  maxRetryAfterMs?: number;
  shouldRetry?: (error: unknown) => boolean;
};

/**
 * Exponential backoff with jitter. On a 429 the server's own hint (retry-after header, or the
 * "try again in Xs" text Groq and OpenAI put in the message) wins over the backoff schedule.
 * Every failed attempt is logged so retries are visible in the run output instead of happening
 * silently inside a library.
 */
export async function withRetry<T>(
  label: string,
  task: (attempt: number) => Promise<T>,
  {
    attempts = 3,
    rateLimitAttempts = attempts,
    baseDelayMs = 500,
    maxRetryAfterMs = 60_000,
    shouldRetry = isTemporaryFailure,
  }: RetryOptions = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await task(attempt);
    } catch (error) {
      const rateLimited = statusOf(error) === 429;
      const allowedAttempts = rateLimited ? Math.max(attempts, rateLimitAttempts) : attempts;
      if (attempt >= allowedAttempts || !shouldRetry(error)) throw error;

      const jitterMs = Math.random() * baseDelayMs;
      const serverWaitMs = rateLimited ? retryAfterMs(error) : undefined;
      const delayMs =
        serverWaitMs !== undefined
          ? Math.min(serverWaitMs, maxRetryAfterMs) + jitterMs
          : baseDelayMs * 2 ** (attempt - 1) + jitterMs;
      logger.warn(
        {
          label,
          attempt,
          nextAttemptInMs: Math.round(delayMs),
          ...(serverWaitMs !== undefined ? { retryAfterMs: Math.round(serverWaitMs) } : {}),
          error: describeError(error),
        },
        "attempt failed, retrying",
      );
      await sleep(delayMs);
    }
  }
}

/** Timeouts, dropped connections, rate limits and 5xx are worth another try. 4xx are not. */
export function isTemporaryFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  if (error.name === "TimeoutError" || error.name === "AbortError") return true;
  if (error instanceof TypeError && error.message === "fetch failed") return true;

  const status = statusOf(error);
  return status !== undefined && (status === 408 || status === 429 || status >= 500);
}

/**
 * How long the server asked us to wait, in ms. Reads `retry-after-ms`, then `retry-after`
 * (seconds or an HTTP date), then a "try again in 1m2.5s" / "in 450ms" hint in the message.
 */
export function retryAfterMs(error: unknown, now = Date.now()): number | undefined {
  const headers = (error as { headers?: unknown } | null)?.headers;

  const retryAfterMsHeader = Number(readHeader(headers, "retry-after-ms"));
  if (Number.isFinite(retryAfterMsHeader) && retryAfterMsHeader >= 0) return retryAfterMsHeader;

  const retryAfter = readHeader(headers, "retry-after")?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.max(0, date - now);
  }

  const message = error instanceof Error ? error.message : "";
  const hint = /try again in ((?:\d+(?:\.\d+)?(?:h|ms|m|s))+)/i.exec(message);
  return hint ? parseDuration(hint[1]!) : undefined;
}

function parseDuration(text: string): number {
  const unitMs: Record<string, number> = { h: 3_600_000, m: 60_000, s: 1_000, ms: 1 };
  let total = 0;
  for (const [, value, unit] of text.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    total += Number(value) * unitMs[unit!]!;
  }
  return total;
}

function readHeader(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name) ?? undefined;
  }
  const value = (headers as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

export function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
