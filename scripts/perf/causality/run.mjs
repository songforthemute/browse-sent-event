import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { arch, cpus, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { createServer as createViteServer } from "vite";

import {
  BENCHMARK_SCHEMA_VERSION,
  calculateLongTaskMetrics,
  evaluateNativeSemantics,
  percentile,
  renderHumanSummary,
  summarizeLatencyBuckets,
  summarizeRuns,
  validateBenchmarkResult,
} from "./benchmark-lib.mjs";
import { createBenchmarkWebSocketServer } from "./websocket-server.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../..");
const fixtureRoot = join(scriptDirectory, "fixture");
const outputDirectory = join(repositoryRoot, ".tmp-causality-benchmark");
const require = createRequire(import.meta.url);
const playwrightVersion = require("@playwright/test/package.json").version;
const viteVersion = require("vite/package.json").version;

const protocols = {
  smoke: {
    ratePerSecond: 100,
    warmupSeconds: 0.2,
    measureSeconds: 1,
    pairs: 1,
    memoryCapacity: 100,
    memoryAdditionalMessages: 300,
  },
  full: {
    ratePerSecond: 100,
    warmupSeconds: 10,
    measureSeconds: 60,
    pairs: 5,
    memoryCapacity: 10_000,
    memoryAdditionalMessages: 50_000,
  },
};

function readMetric(metrics, name) {
  return metrics.metrics.find((metric) => metric.name === name)?.value ?? 0;
}

async function getTaskDurationSeconds(cdp) {
  return readMetric(await cdp.send("Performance.getMetrics"), "TaskDuration");
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function collectCpuTimeline(cdp, workloadPromise) {
  const samples = [
    { atEpochMs: Date.now(), taskDurationSeconds: await getTaskDurationSeconds(cdp) },
  ];
  let complete = false;
  const poll = (async () => {
    while (true) {
      await delay(1_000);
      if (complete) break;
      samples.push({
        atEpochMs: Date.now(),
        taskDurationSeconds: await getTaskDurationSeconds(cdp),
      });
    }
  })();
  const observation = await workloadPromise;
  complete = true;
  samples.push({ atEpochMs: Date.now(), taskDurationSeconds: await getTaskDurationSeconds(cdp) });
  await poll;
  return { observation, samples };
}

function createCpuBuckets(samples, latencyBuckets) {
  const buckets = [];
  for (let index = 1; index < samples.length; index += 1) {
    const taskDurationMs =
      (samples[index].taskDurationSeconds - samples[index - 1].taskDurationSeconds) * 1_000;
    const received = latencyBuckets[index - 1]?.count ?? 0;
    buckets.push({
      second: index - 1,
      actualReceiveCount: received,
      taskDurationMs,
      taskDurationMsPerMessage: received === 0 ? 0 : taskDurationMs / received,
    });
  }
  return buckets;
}

async function createPage(browser, fixtureUrl, mode, capacity) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(fixtureUrl);
  await page.waitForFunction(() => globalThis.benchmarkReady === true);
  const setup = await page.evaluate((input) => globalThis.prepareBenchmark(input), {
    capacity,
    mode,
  });

  if (mode === "phase1" && (!setup.instrumented || !setup.panelMounted || setup.panelOpen)) {
    throw new Error(`Phase 1 setup did not mount an actual closed panel: ${JSON.stringify(setup)}`);
  }
  if (mode === "native" && (setup.instrumented || setup.panelMounted)) {
    throw new Error(`Native setup unexpectedly installed BSE: ${JSON.stringify(setup)}`);
  }
  return { context, page };
}

function workloadUrl(webSocketUrl, count, ratePerSecond) {
  return `${webSocketUrl}/workload?count=${count}&rate=${ratePerSecond}`;
}

async function runTrial(browser, fixtureUrl, webSocketUrl, mode, config, pair, order) {
  const { context, page } = await createPage(browser, fixtureUrl, mode, config.memoryCapacity);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  try {
    const prefill = await page.evaluate((input) => globalThis.runSocketWorkload(input), {
      expectedCount: config.memoryCapacity,
      url: workloadUrl(webSocketUrl, config.memoryCapacity, 0),
    });
    const prefillOracle = evaluateNativeSemantics(prefill, config.memoryCapacity);
    if (!prefillOracle.pass) throw new Error(`${mode} prefill changed native semantics`);
    if (
      mode === "phase1" &&
      (prefill.bseCapture?.messageCount !== config.memoryCapacity ||
        !prefill.bseCapture.panelClosed)
    ) {
      throw new Error(
        `Phase 1 prefill did not reach closed-panel capacity: ${JSON.stringify(prefill.bseCapture)}`,
      );
    }
    await collectPostGcUsedHeapBytes(cdp);
    await delay(250);

    const warmupCount = Math.round(config.ratePerSecond * config.warmupSeconds);
    if (warmupCount > 0) {
      const warmup = await page.evaluate((input) => globalThis.runSocketWorkload(input), {
        expectedCount: warmupCount,
        url: workloadUrl(webSocketUrl, warmupCount, config.ratePerSecond),
      });
      const warmupOracle = evaluateNativeSemantics(warmup, warmupCount);
      if (!warmupOracle.pass) throw new Error(`${mode} warmup changed native semantics`);
    }

    const expectedCount = Math.round(config.ratePerSecond * config.measureSeconds);
    const startTaskDuration = await getTaskDurationSeconds(cdp);
    const { observation, samples } = await collectCpuTimeline(
      cdp,
      page.evaluate((input) => globalThis.runSocketWorkload(input), {
        expectedCount,
        url: workloadUrl(webSocketUrl, expectedCount, config.ratePerSecond),
      }),
    );
    const endTaskDuration = await getTaskDurationSeconds(cdp);
    const actualReceiveCount = observation.sequences.length;
    const taskDurationMs = (endTaskDuration - startTaskDuration) * 1_000;
    const latencyValues = observation.latencySamples.map((sample) => sample.latencyMs);
    const interArrivalValues = observation.latencySamples
      .slice(1)
      .map(
        (sample, index) =>
          sample.receivedAtEpochMs - observation.latencySamples[index].receivedAtEpochMs,
      );
    const elapsedMs = observation.completedAtEpochMs - observation.startedAtEpochMs;
    const achievedRatePerSecond = actualReceiveCount / (elapsedMs / 1_000);
    const rateDriftPercent =
      (Math.abs(achievedRatePerSecond - config.ratePerSecond) / config.ratePerSecond) * 100;
    if (rateDriftPercent > 5) {
      throw new Error(
        `${mode} trial ${pair} rate drifted ${rateDriftPercent.toFixed(2)}%: ${achievedRatePerSecond.toFixed(2)} msg/s`,
      );
    }
    const latencyBuckets = summarizeLatencyBuckets(
      observation.latencySamples,
      observation.startedAtEpochMs,
    );
    const nativeSemantics = evaluateNativeSemantics(observation, expectedCount);
    if (!nativeSemantics.pass) {
      throw new Error(
        `${mode} trial ${pair} changed native semantics: ${JSON.stringify(nativeSemantics)}`,
      );
    }
    const expectedRetainedCount = Math.min(
      config.memoryCapacity,
      config.memoryCapacity + warmupCount + expectedCount,
    );
    if (
      mode === "phase1" &&
      (!observation.bseCapture?.panelClosed ||
        observation.bseCapture.messageCount !== expectedRetainedCount)
    ) {
      throw new Error(
        `Phase 1 capture did not preserve closed-panel capacity: ${JSON.stringify(observation.bseCapture)}`,
      );
    }

    return {
      mode,
      pair,
      order,
      expectedReceiveCount: expectedCount,
      actualReceiveCount,
      elapsedMs,
      achievedRatePerSecond,
      rateDriftPercent,
      cpu: {
        taskDurationMs,
        taskDurationMsPerMessage: taskDurationMs / actualReceiveCount,
        oneSecondBuckets: createCpuBuckets(samples, latencyBuckets),
      },
      deliveryLatency: {
        p50Ms: percentile(latencyValues, 50),
        p95Ms: percentile(latencyValues, 95),
        interArrivalP50Ms: percentile(interArrivalValues, 50),
        interArrivalP95Ms: percentile(interArrivalValues, 95),
        oneSecondBuckets: latencyBuckets,
      },
      longTasks: calculateLongTaskMetrics(observation.longTaskDurations),
      nativeSemantics,
      bseCapture: observation.bseCapture,
    };
  } finally {
    await context.close();
  }
}

async function collectPostGcUsedHeapBytes(cdp) {
  await cdp.send("HeapProfiler.enable");
  const samples = [];
  for (let index = 0; index < 3; index += 1) {
    await cdp.send("HeapProfiler.collectGarbage");
    await delay(50);
    samples.push(readMetric(await cdp.send("Performance.getMetrics"), "JSHeapUsedSize"));
  }
  return Math.min(...samples);
}

function readGitMetadata() {
  return {
    sha: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).trim(),
    dirty:
      execFileSync("git", ["status", "--porcelain"], {
        cwd: repositoryRoot,
        encoding: "utf8",
      }).trim().length > 0,
  };
}

async function runMemoryTrial(browser, fixtureUrl, webSocketUrl, mode, config) {
  const { context, page } = await createPage(browser, fixtureUrl, mode, config.memoryCapacity);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  try {
    const first = await page.evaluate((input) => globalThis.runSocketWorkload(input), {
      expectedCount: config.memoryCapacity,
      url: workloadUrl(webSocketUrl, config.memoryCapacity, 0),
    });
    const firstOracle = evaluateNativeSemantics(first, config.memoryCapacity);
    const atCapacity = {
      postGcUsedHeapBytes: await collectPostGcUsedHeapBytes(cdp),
      retention: await page.evaluate(() => globalThis.getRuntimeRetention()),
    };
    const second = await page.evaluate((input) => globalThis.runSocketWorkload(input), {
      expectedCount: config.memoryAdditionalMessages,
      url: workloadUrl(webSocketUrl, config.memoryAdditionalMessages, 0),
    });
    const secondOracle = evaluateNativeSemantics(second, config.memoryAdditionalMessages);
    const afterAdditional = {
      postGcUsedHeapBytes: await collectPostGcUsedHeapBytes(cdp),
      retention: await page.evaluate(() => globalThis.getRuntimeRetention()),
    };
    return {
      mode,
      capacity: config.memoryCapacity,
      additionalMessages: config.memoryAdditionalMessages,
      atCapacity,
      afterAdditional,
      plateauDeltaBytes: afterAdditional.postGcUsedHeapBytes - atCapacity.postGcUsedHeapBytes,
      plateauBytesPerAdditionalMessage:
        (afterAdditional.postGcUsedHeapBytes - atCapacity.postGcUsedHeapBytes) /
        config.memoryAdditionalMessages,
      nativeSemanticsPass: firstOracle.pass && secondOracle.pass,
    };
  } finally {
    await context.close();
  }
}

async function main() {
  const protocol = process.argv.includes("--full") ? "full" : "smoke";
  const config = protocols[protocol];
  const vite = await createViteServer({
    root: fixtureRoot,
    logLevel: "error",
    resolve: {
      alias: {
        "@browse-sent-event/core": join(repositoryRoot, "packages/core/src/index.ts"),
      },
    },
    server: { host: "127.0.0.1", port: 0 },
  });
  await vite.listen();
  const address = vite.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Vite server has no TCP port");
  const fixtureUrl = `http://127.0.0.1:${address.port}`;
  const webSocket = await createBenchmarkWebSocketServer();
  const browser = await chromium.launch({ headless: true });

  try {
    const runs = [];
    for (let pair = 0; pair < config.pairs; pair += 1) {
      const modes = pair % 2 === 0 ? ["native", "phase1"] : ["phase1", "native"];
      for (const [order, mode] of modes.entries()) {
        process.stdout.write(`Running ${protocol} pair ${pair + 1}/${config.pairs} ${mode}...\n`);
        runs.push(await runTrial(browser, fixtureUrl, webSocket.url, mode, config, pair, order));
      }
    }

    const memory = [];
    for (const mode of ["native", "phase1"]) {
      process.stdout.write(`Running ${protocol} memory ${mode}...\n`);
      memory.push(await runMemoryTrial(browser, fixtureUrl, webSocket.url, mode, config));
    }

    const result = {
      schemaVersion: BENCHMARK_SCHEMA_VERSION,
      protocol,
      generatedAt: new Date().toISOString(),
      git: readGitMetadata(),
      environment: {
        chromiumVersion: browser.version(),
        platform: platform(),
        arch: arch(),
        cpuModel: cpus()[0]?.model ?? "unknown",
        logicalCores: cpus().length,
        nodeVersion: process.version,
        pnpmVersion: execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim(),
        playwrightVersion,
        viteVersion,
        headless: true,
        launchArgs: [],
      },
      configuration: config,
      ordering:
        "Alternating pair order: native→phase1, then phase1→native; every mode uses a fresh context and page.",
      runs,
      memory,
      summary: summarizeRuns(runs),
    };
    const validationErrors = validateBenchmarkResult(result);
    if (validationErrors.length > 0) throw new Error(validationErrors.join("\n"));
    const humanSummary = renderHumanSummary(result);
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(
      join(outputDirectory, "causality-benchmark.json"),
      `${JSON.stringify(result, null, 2)}\n`,
    );
    await writeFile(join(outputDirectory, "causality-benchmark.md"), humanSummary);
    process.stdout.write(
      `\n${humanSummary}\nMachine JSON: ${join(outputDirectory, "causality-benchmark.json")}\n`,
    );
  } finally {
    await browser.close();
    await webSocket.close();
    await vite.close();
  }
}

await main();
