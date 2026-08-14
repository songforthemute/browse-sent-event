import assert from "node:assert/strict";
import test from "node:test";
import {
  BENCHMARK_SCHEMA_VERSION,
  calculateLongTaskMetrics,
  checksumText,
  evaluateNativeSemantics,
  median,
  percentile,
  summarizeLatencyBuckets,
  summarizeRuns,
  validateBenchmarkResult,
} from "./benchmark-lib.mjs";

void test("percentile and median use deterministic nearest-rank math", () => {
  assert.equal(percentile([9, 1, 5, 3], 50), 3);
  assert.equal(percentile([9, 1, 5, 3], 95), 9);
  assert.equal(median([9, 1, 5, 3]), 4);
  assert.equal(percentile([], 95), 0);
});

void test("latency samples are summarized into one-second receive buckets", () => {
  assert.deepEqual(
    summarizeLatencyBuckets(
      [
        { receivedAtEpochMs: 1_100, latencyMs: 4 },
        { receivedAtEpochMs: 1_900, latencyMs: 8 },
        { receivedAtEpochMs: 2_100, latencyMs: 2 },
      ],
      1_000,
    ),
    [
      { second: 0, count: 2, p50Ms: 4, p95Ms: 8 },
      { second: 1, count: 1, p50Ms: 2, p95Ms: 2 },
    ],
  );
});

void test("long-task metrics use the 50ms blocking threshold", () => {
  assert.deepEqual(calculateLongTaskMetrics([50, 75, 120]), {
    count: 3,
    maxMs: 120,
    totalBlockingTimeMs: 95,
  });
});

void test("FNV-1a checksum has a browser-portable fixed vector", () => {
  assert.equal(checksumText("sequence:0:browse-sent-event"), 831_191_002);
});

void test("native semantics oracle catches gaps, duplicates, checksum, handler, and lifecycle drift", () => {
  const healthy = {
    sequences: [0, 1, 2],
    expectedChecksums: [10, 20, 30],
    receivedChecksums: [10, 20, 30],
    userHandlerCount: 3,
    userHandlerAggregateChecksum: 60,
    lifecycle: { open: 1, message: 3, close: 1, error: 0 },
  };
  assert.equal(evaluateNativeSemantics(healthy, 3).pass, true);

  const broken = {
    ...healthy,
    sequences: [0, 2, 2],
    userHandlerCount: 2,
    lifecycle: { open: 1, message: 3, close: 0, error: 1 },
  };
  const result = evaluateNativeSemantics(broken, 3);
  assert.equal(result.pass, false);
  assert.equal(result.gaps, 1);
  assert.equal(result.duplicates, 1);
  assert.equal(result.checks.userHandler, false);
  assert.equal(result.checks.socketLifecycle, false);
});

void test("machine result schema rejects an invalid semantics oracle", () => {
  const result = {
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    protocol: "smoke",
    git: { sha: "test-sha", dirty: false },
    environment: {
      chromiumVersion: "Chromium 1",
      platform: "test-os",
      arch: "test-arch",
      cpuModel: "test-cpu",
      logicalCores: 1,
      nodeVersion: "v1",
      pnpmVersion: "v1",
      playwrightVersion: "v1",
      viteVersion: "v1",
    },
    configuration: {
      ratePerSecond: 100,
      warmupSeconds: 0,
      measureSeconds: 1,
      pairs: 1,
      memoryCapacity: 10,
    },
    runs: [
      {
        mode: "native",
        actualReceiveCount: 10,
        elapsedMs: 100,
        achievedRatePerSecond: 100,
        rateDriftPercent: 0,
        cpu: { taskDurationMs: 1, taskDurationMsPerMessage: 0.1, oneSecondBuckets: [] },
        deliveryLatency: { oneSecondBuckets: [] },
        longTasks: { count: 0, maxMs: 0, totalBlockingTimeMs: 0 },
        nativeSemantics: { pass: true },
      },
      {
        mode: "phase1",
        actualReceiveCount: 10,
        elapsedMs: 100,
        achievedRatePerSecond: 100,
        rateDriftPercent: 0,
        cpu: { taskDurationMs: 2, taskDurationMsPerMessage: 0.2, oneSecondBuckets: [] },
        deliveryLatency: { oneSecondBuckets: [] },
        longTasks: { count: 0, maxMs: 0, totalBlockingTimeMs: 0 },
        nativeSemantics: { pass: true },
        bseCapture: { panelClosed: true, messageCount: 10 },
      },
    ],
    memory: [
      {
        mode: "native",
        capacity: 10,
        atCapacity: { postGcUsedHeapBytes: 1 },
        afterAdditional: { postGcUsedHeapBytes: 1 },
        nativeSemanticsPass: true,
      },
      {
        mode: "phase1",
        capacity: 10,
        atCapacity: { postGcUsedHeapBytes: 1, retention: { messages: 10 } },
        afterAdditional: { postGcUsedHeapBytes: 1, retention: { messages: 10 } },
        nativeSemanticsPass: true,
      },
    ],
  };
  result.summary = summarizeRuns(result.runs);
  assert.deepEqual(validateBenchmarkResult(result), []);
  result.runs[0].nativeSemantics.pass = false;
  assert.deepEqual(validateBenchmarkResult(result), [
    "runs[0].nativeSemantics must pass",
    "summary must match the raw runs",
  ]);
});

void test("machine result schema rejects missing modes and failed memory semantics", () => {
  const result = {
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    protocol: "smoke",
    git: { sha: "test-sha", dirty: false },
    environment: {
      chromiumVersion: "Chromium 1",
      platform: "test-os",
      arch: "test-arch",
      cpuModel: "test-cpu",
      logicalCores: 1,
      nodeVersion: "v1",
      pnpmVersion: "v1",
      playwrightVersion: "v1",
      viteVersion: "v1",
    },
    configuration: {
      ratePerSecond: 100,
      warmupSeconds: 0,
      measureSeconds: 1,
      pairs: 1,
      memoryCapacity: 10,
    },
    runs: [],
    memory: [
      {
        mode: "native",
        capacity: 10,
        atCapacity: { postGcUsedHeapBytes: 1 },
        afterAdditional: { postGcUsedHeapBytes: 1 },
        nativeSemanticsPass: false,
      },
      {
        mode: "native",
        capacity: 10,
        atCapacity: { postGcUsedHeapBytes: 1 },
        afterAdditional: { postGcUsedHeapBytes: 1 },
        nativeSemanticsPass: true,
      },
    ],
    summary: summarizeRuns([]),
  };
  const errors = validateBenchmarkResult(result);
  assert.ok(errors.includes("runs must contain exactly configuration.pairs native results"));
  assert.ok(errors.includes("runs must contain exactly configuration.pairs phase1 results"));
  assert.ok(errors.includes("memory must contain exactly one native result"));
  assert.ok(errors.includes("memory must contain exactly one phase1 result"));
  assert.ok(errors.includes("memory[0].nativeSemanticsPass must pass"));
});
