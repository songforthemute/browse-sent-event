export const BENCHMARK_SCHEMA_VERSION = 1;

export function percentile(values, percentileValue) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = values.toSorted((left, right) => left - right);
  const rank = Math.ceil((percentileValue / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(rank, sorted.length - 1))];
}

export function median(values) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function summarizeLatencyBuckets(samples, startedAtEpochMs) {
  const buckets = new Map();

  for (const sample of samples) {
    const bucket = Math.max(0, Math.floor((sample.receivedAtEpochMs - startedAtEpochMs) / 1_000));
    const values = buckets.get(bucket) ?? [];
    values.push(sample.latencyMs);
    buckets.set(bucket, values);
  }

  return [...buckets.entries()]
    .toSorted(([left], [right]) => left - right)
    .map(([second, values]) => ({
      second,
      count: values.length,
      p50Ms: percentile(values, 50),
      p95Ms: percentile(values, 95),
    }));
}

export function calculateLongTaskMetrics(durations) {
  return {
    count: durations.length,
    maxMs: durations.length === 0 ? 0 : Math.max(...durations),
    totalBlockingTimeMs: durations.reduce(
      (total, duration) => total + Math.max(0, duration - 50),
      0,
    ),
  };
}

export function checksumText(value) {
  let hash = 2_166_136_261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  return hash >>> 0;
}

export function aggregateChecksums(checksums) {
  return checksums.reduce((total, checksum) => (total + checksum) >>> 0, 0);
}

export function evaluateNativeSemantics(observation, expectedCount) {
  const sequences = observation.sequences;
  const unique = new Set(sequences);
  const duplicates = sequences.length - unique.size;
  let gaps = 0;

  for (let sequence = 0; sequence < expectedCount; sequence += 1) {
    if (!unique.has(sequence)) {
      gaps += 1;
    }
  }

  const expectedAggregateChecksum = aggregateChecksums(observation.expectedChecksums);
  const receivedAggregateChecksum = aggregateChecksums(observation.receivedChecksums);
  const lifecycle = observation.lifecycle;
  const checks = {
    actualReceiveCount: sequences.length === expectedCount,
    checksum: expectedAggregateChecksum === receivedAggregateChecksum,
    duplicates: duplicates === 0,
    gaps: gaps === 0,
    sequenceBounds:
      expectedCount === 0 || (sequences.at(0) === 0 && sequences.at(-1) === expectedCount - 1),
    socketLifecycle:
      lifecycle.open === 1 &&
      lifecycle.close === 1 &&
      lifecycle.error === 0 &&
      lifecycle.message === expectedCount,
    userHandler:
      observation.userHandlerCount === sequences.length &&
      observation.userHandlerAggregateChecksum === receivedAggregateChecksum,
  };

  return {
    pass: Object.values(checks).every(Boolean),
    checks,
    duplicates,
    gaps,
    expectedAggregateChecksum,
    receivedAggregateChecksum,
  };
}

export function validateBenchmarkResult(result) {
  const errors = [];

  if (result.schemaVersion !== BENCHMARK_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${BENCHMARK_SCHEMA_VERSION}`);
  }

  if (!["smoke", "full"].includes(result.protocol)) {
    errors.push("protocol must be smoke or full");
  }

  if (!Array.isArray(result.runs) || result.runs.length === 0) {
    errors.push("runs must be a non-empty array");
  }

  if (typeof result.git?.sha !== "string" || result.git.sha.length === 0) {
    errors.push("git.sha must be a non-empty string");
  }
  if (typeof result.git?.dirty !== "boolean") {
    errors.push("git.dirty must be boolean");
  }

  for (const field of [
    "chromiumVersion",
    "platform",
    "arch",
    "cpuModel",
    "nodeVersion",
    "pnpmVersion",
    "playwrightVersion",
    "viteVersion",
  ]) {
    if (typeof result.environment?.[field] !== "string" || result.environment[field].length === 0) {
      errors.push(`environment.${field} must be a non-empty string`);
    }
  }
  if (!(result.environment?.logicalCores > 0)) {
    errors.push("environment.logicalCores must be positive");
  }

  for (const field of ["ratePerSecond", "warmupSeconds", "measureSeconds", "pairs"]) {
    if (!(result.configuration?.[field] >= 0)) {
      errors.push(`configuration.${field} must be non-negative`);
    }
  }

  if (!Array.isArray(result.memory) || result.memory.length !== 2) {
    errors.push("memory must contain native and phase1 results");
  }

  for (const mode of ["native", "phase1"]) {
    const runCount = (result.runs ?? []).filter((run) => run.mode === mode).length;
    if (runCount !== result.configuration?.pairs) {
      errors.push(`runs must contain exactly configuration.pairs ${mode} results`);
    }
    const memoryCount = (result.memory ?? []).filter((memory) => memory.mode === mode).length;
    if (memoryCount !== 1) {
      errors.push(`memory must contain exactly one ${mode} result`);
    }
  }

  for (const [index, run] of (result.runs ?? []).entries()) {
    if (!["native", "phase1"].includes(run.mode)) {
      errors.push(`runs[${index}].mode must be native or phase1`);
    }

    if (!(run.actualReceiveCount > 0)) {
      errors.push(`runs[${index}].actualReceiveCount must be positive`);
    }
    if (!(run.elapsedMs > 0)) {
      errors.push(`runs[${index}].elapsedMs must be positive`);
    }
    if (!(run.achievedRatePerSecond > 0)) {
      errors.push(`runs[${index}].achievedRatePerSecond must be positive`);
    }
    if (!(run.rateDriftPercent >= 0 && run.rateDriftPercent <= 5)) {
      errors.push(`runs[${index}].rateDriftPercent must be between 0 and 5`);
    }

    if (!(run.cpu?.taskDurationMs >= 0)) {
      errors.push(`runs[${index}].cpu.taskDurationMs must be non-negative`);
    }

    if (!Array.isArray(run.cpu?.oneSecondBuckets)) {
      errors.push(`runs[${index}].cpu.oneSecondBuckets must be an array`);
    }

    for (const field of ["count", "maxMs", "totalBlockingTimeMs"]) {
      if (!(run.longTasks?.[field] >= 0)) {
        errors.push(`runs[${index}].longTasks.${field} must be non-negative`);
      }
    }

    if (!Array.isArray(run.deliveryLatency?.oneSecondBuckets)) {
      errors.push(`runs[${index}].deliveryLatency.oneSecondBuckets must be an array`);
    }

    if (!run.nativeSemantics?.pass) {
      errors.push(`runs[${index}].nativeSemantics must pass`);
    }
    if (
      run.mode === "phase1" &&
      (!run.bseCapture?.panelClosed ||
        run.bseCapture.messageCount !== result.configuration?.memoryCapacity)
    ) {
      errors.push(`runs[${index}].bseCapture must preserve closed-panel capacity`);
    }
  }

  for (const [index, memory] of (result.memory ?? []).entries()) {
    if (!["native", "phase1"].includes(memory.mode)) {
      errors.push(`memory[${index}].mode must be native or phase1`);
    }
    if (!(memory.atCapacity?.postGcUsedHeapBytes > 0)) {
      errors.push(`memory[${index}].atCapacity.postGcUsedHeapBytes must be positive`);
    }
    if (!(memory.afterAdditional?.postGcUsedHeapBytes > 0)) {
      errors.push(`memory[${index}].afterAdditional.postGcUsedHeapBytes must be positive`);
    }
    if (memory.nativeSemanticsPass !== true) {
      errors.push(`memory[${index}].nativeSemanticsPass must pass`);
    }
    if (
      memory.mode === "phase1" &&
      (memory.atCapacity?.retention?.messages !== memory.capacity ||
        memory.afterAdditional?.retention?.messages !== memory.capacity)
    ) {
      errors.push(`memory[${index}] must retain exactly capacity messages`);
    }
  }

  if (result.summary === undefined) {
    errors.push("summary must be present");
  } else if (JSON.stringify(result.summary) !== JSON.stringify(summarizeRuns(result.runs ?? []))) {
    errors.push("summary must match the raw runs");
  }

  return errors;
}

export function summarizeRuns(runs) {
  const byMode = {};

  for (const mode of ["native", "phase1"]) {
    const selected = runs.filter((run) => run.mode === mode);
    const cpuPerMessage = selected.map((run) => run.cpu.taskDurationMsPerMessage);
    const bucketCpuPerMessage = selected.flatMap((run) =>
      run.cpu.oneSecondBuckets.map((bucket) => bucket.taskDurationMsPerMessage),
    );
    byMode[mode] = {
      runCount: selected.length,
      actualReceiveCount: selected.reduce((sum, run) => sum + run.actualReceiveCount, 0),
      medianTaskDurationMsPerMessage: median(cpuPerMessage),
      minTaskDurationMsPerMessage: cpuPerMessage.length === 0 ? 0 : Math.min(...cpuPerMessage),
      maxTaskDurationMsPerMessage: cpuPerMessage.length === 0 ? 0 : Math.max(...cpuPerMessage),
      p50OneSecondBucketTaskDurationMsPerMessage: percentile(bucketCpuPerMessage, 50),
      p95OneSecondBucketTaskDurationMsPerMessage: percentile(bucketCpuPerMessage, 95),
      longTaskCount: selected.reduce((sum, run) => sum + run.longTasks.count, 0),
      maxLongTaskMs:
        selected.length === 0 ? 0 : Math.max(...selected.map((run) => run.longTasks.maxMs)),
      totalBlockingTimeMs: selected.reduce(
        (sum, run) => sum + run.longTasks.totalBlockingTimeMs,
        0,
      ),
      nativeSemanticsPass: selected.every((run) => run.nativeSemantics.pass),
      medianAchievedRatePerSecond: median(selected.map((run) => run.achievedRatePerSecond)),
    };
  }

  const nativeMedian = byMode.native.medianTaskDurationMsPerMessage;
  const phase1Median = byMode.phase1.medianTaskDurationMsPerMessage;
  const overheadPercent =
    nativeMedian === 0 ? null : ((phase1Median - nativeMedian) / nativeMedian) * 100;

  return { byMode, phase1CpuOverheadPercent: overheadPercent };
}

export function renderHumanSummary(result) {
  const lines = [
    "# Causality benchmark summary",
    "",
    `- Protocol: ${result.protocol}`,
    `- Chromium: ${result.environment.chromiumVersion}`,
    `- Host: ${result.environment.platform} ${result.environment.arch}`,
    `- Workload: ${result.configuration.ratePerSecond} msg/s, ${result.configuration.measureSeconds}s measure, ${result.configuration.pairs} pair(s)`,
    "",
    "| mode | runs | received | achieved msg/s | median CPU ms/msg | min–max trial CPU | p50/p95 1s-bucket CPU | long tasks | max long task ms | TBT ms | semantics |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];

  for (const mode of ["native", "phase1"]) {
    const value = result.summary.byMode[mode];
    lines.push(
      `| ${mode} | ${value.runCount} | ${value.actualReceiveCount} | ${value.medianAchievedRatePerSecond.toFixed(2)} | ${value.medianTaskDurationMsPerMessage.toFixed(4)} | ${value.minTaskDurationMsPerMessage.toFixed(4)}–${value.maxTaskDurationMsPerMessage.toFixed(4)} | ${value.p50OneSecondBucketTaskDurationMsPerMessage.toFixed(4)}/${value.p95OneSecondBucketTaskDurationMsPerMessage.toFixed(4)} | ${value.longTaskCount} | ${value.maxLongTaskMs.toFixed(2)} | ${value.totalBlockingTimeMs.toFixed(2)} | ${value.nativeSemanticsPass ? "pass" : "FAIL"} |`,
    );
  }

  const overhead = result.summary.phase1CpuOverheadPercent;
  lines.push(
    "",
    `Phase 1 median CPU overhead: ${overhead === null ? "n/a" : `${overhead.toFixed(2)}%`}`,
    "",
    "Memory values are post-GC CDP `JSHeapUsedSize` readings and are reported as `postGcUsedHeapBytes`.",
  );

  for (const memory of result.memory) {
    lines.push(
      `- ${memory.mode}: at capacity ${memory.atCapacity.postGcUsedHeapBytes} bytes; after +${memory.additionalMessages} messages ${memory.afterAdditional.postGcUsedHeapBytes} bytes; delta ${memory.plateauDeltaBytes} bytes (${memory.plateauBytesPerAdditionalMessage.toFixed(3)} bytes/message)`,
    );
  }

  return `${lines.join("\n")}\n`;
}
