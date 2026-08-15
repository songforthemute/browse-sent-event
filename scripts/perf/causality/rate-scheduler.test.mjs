import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateDueBatchEnd,
  calculateNextDelayMs,
  DEFAULT_CATCH_UP_BATCH_LIMIT,
} from "./rate-scheduler.mjs";

void test("returns every sequence due at the current deadline", () => {
  assert.equal(
    calculateDueBatchEnd({
      intervalMs: 10,
      nextSequence: 0,
      nowMs: 1_035,
      startedAtMs: 1_000,
      totalCount: 1_000,
    }),
    4,
  );
});

void test("caps a delayed catch-up tick so the event loop can yield", () => {
  assert.equal(
    calculateDueBatchEnd({
      intervalMs: 10,
      nextSequence: 0,
      nowMs: 11_000,
      startedAtMs: 1_000,
      totalCount: 2_000,
    }),
    DEFAULT_CATCH_UP_BATCH_LIMIT,
  );
  assert.equal(
    calculateDueBatchEnd({
      intervalMs: 10,
      nextSequence: DEFAULT_CATCH_UP_BATCH_LIMIT,
      nowMs: 11_000,
      startedAtMs: 1_000,
      totalCount: 2_000,
    }),
    DEFAULT_CATCH_UP_BATCH_LIMIT * 2,
  );
});

void test("does not send early or exceed the requested count", () => {
  const input = {
    intervalMs: 10,
    nextSequence: 4,
    startedAtMs: 1_000,
    totalCount: 5,
  };
  assert.equal(calculateDueBatchEnd({ ...input, nowMs: 1_039 }), 4);
  assert.equal(calculateDueBatchEnd({ ...input, nowMs: 2_000 }), 5);
});

void test("preserves sequence and count across delayed bounded ticks", () => {
  const emitted = [];
  let nextSequence = 0;

  while (nextSequence < 257) {
    const batchEnd = calculateDueBatchEnd({
      batchLimit: 32,
      intervalMs: 10,
      nextSequence,
      nowMs: 10_000,
      startedAtMs: 0,
      totalCount: 257,
    });
    while (nextSequence < batchEnd) {
      emitted.push(nextSequence);
      nextSequence += 1;
    }
  }

  assert.deepEqual(
    emitted,
    Array.from({ length: 257 }, (_, index) => index),
  );
});

void test("computes the next deadline delay without returning a negative timeout", () => {
  assert.equal(
    calculateNextDelayMs({ intervalMs: 10, nextSequence: 4, nowMs: 1_025, startedAtMs: 1_000 }),
    15,
  );
  assert.equal(
    calculateNextDelayMs({ intervalMs: 10, nextSequence: 4, nowMs: 1_050, startedAtMs: 1_000 }),
    0,
  );
});

void test("rejects invalid interval and batch limits", () => {
  assert.throws(
    () =>
      calculateDueBatchEnd({
        intervalMs: 0,
        nextSequence: 0,
        nowMs: 0,
        startedAtMs: 0,
        totalCount: 1,
      }),
    /intervalMs must be positive/,
  );
  assert.throws(
    () =>
      calculateDueBatchEnd({
        batchLimit: 0,
        intervalMs: 10,
        nextSequence: 0,
        nowMs: 0,
        startedAtMs: 0,
        totalCount: 1,
      }),
    /batchLimit must be a positive integer/,
  );
});
