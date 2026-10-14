import { sleep } from "../shared/retry";

/**
 * Spaces calls out evenly so we stay under a requests-per-minute quota, even when several
 * records are being processed at once. Cheaper than hitting 429s and backing off.
 */
export function createRateLimiter(requestsPerMinute: number) {
  const gapMs = 60_000 / requestsPerMinute;
  let nextFreeSlot = 0;

  return async function waitForTurn(): Promise<void> {
    const now = Date.now();
    const mySlot = Math.max(now, nextFreeSlot);
    nextFreeSlot = mySlot + gapMs;
    if (mySlot > now) await sleep(mySlot - now);
  };
}
