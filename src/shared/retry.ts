import { logger } from "./logger";

type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  shouldRetry?: (error: unknown) => boolean;
};

/**
 * Exponential backoff with jitter. Every failed attempt is logged so retries are visible in the
 * run output instead of happening silently inside a library.
 */
export async function withRetry<T>(
  label: string,
  task: (attempt: number) => Promise<T>,
  { attempts = 3, baseDelayMs = 500, shouldRetry = isTemporaryFailure }: RetryOptions = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await task(attempt);
    } catch (error) {
      const isLastAttempt = attempt >= attempts;
      if (isLastAttempt || !shouldRetry(error)) throw error;

      const delayMs = baseDelayMs * 2 ** (attempt - 1) + Math.random() * baseDelayMs;
      logger.warn(
        { label, attempt, nextAttemptInMs: Math.round(delayMs), error: describeError(error) },
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

  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && (status === 408 || status === 429 || status >= 500);
}

export function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
