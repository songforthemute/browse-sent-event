export const DEFAULT_CATCH_UP_BATCH_LIMIT = 100;

export function calculateDueBatchEnd({
  batchLimit = DEFAULT_CATCH_UP_BATCH_LIMIT,
  intervalMs,
  nextSequence,
  nowMs,
  startedAtMs,
  totalCount,
}) {
  if (!(intervalMs > 0)) {
    throw new RangeError("intervalMs must be positive");
  }

  if (!Number.isInteger(batchLimit) || batchLimit <= 0) {
    throw new RangeError("batchLimit must be a positive integer");
  }

  if (nextSequence >= totalCount || nowMs < startedAtMs) {
    return nextSequence;
  }

  const dueEnd = Math.floor((nowMs - startedAtMs) / intervalMs) + 1;
  return Math.min(totalCount, dueEnd, nextSequence + batchLimit);
}

export function calculateNextDelayMs({ intervalMs, nextSequence, nowMs, startedAtMs }) {
  return Math.max(0, startedAtMs + nextSequence * intervalMs - nowMs);
}
