function checksumText(value) {
  let hash = 2_166_136_261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  return hash >>> 0;
}

function aggregateChecksum(current, checksum) {
  return (current + checksum) >>> 0;
}

let runtime;

window.prepareBenchmark = async ({ capacity, mode }) => {
  runtime?.uninstall();
  runtime = undefined;

  if (mode === "phase1") {
    const { installBrowseSentEvent } = await import("@browse-sent-event/core");
    runtime = installBrowseSentEvent({
      capacity,
      panel: { autoOpen: false },
    });
  }

  const panel = document.querySelector("bse-devtools-panel");
  return {
    instrumented: Boolean(runtime?.installed),
    panelMounted: panel !== null,
    panelOpen: panel?.hasAttribute("open") ?? false,
  };
};

window.runSocketWorkload = ({ expectedCount, url }) =>
  new Promise((resolve, reject) => {
    const sequences = [];
    const expectedChecksums = [];
    const receivedChecksums = [];
    const latencySamples = [];
    const longTaskDurations = [];
    const lifecycle = { open: 0, message: 0, close: 0, error: 0 };
    let userHandlerCount = 0;
    let userHandlerAggregateChecksum = 0;
    const startedAtEpochMs = Date.now();
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTaskDurations.push(entry.duration);
      }
    });

    try {
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      // Chromium benchmark runs support Long Tasks; keep the oracle functional if disabled.
    }

    const socket = new WebSocket(url);
    const timeout = window.setTimeout(
      () => {
        observer.disconnect();
        socket.close();
        reject(
          new Error(`Timed out after receiving ${sequences.length}/${expectedCount} messages`),
        );
      },
      Math.max(15_000, expectedCount * 100 + 5_000),
    );

    socket.addEventListener("open", () => {
      lifecycle.open += 1;
    });
    socket.addEventListener("message", (event) => {
      lifecycle.message += 1;
      const receivedAtEpochMs = Date.now();
      const message = JSON.parse(event.data);
      const calculatedChecksum = checksumText(message.payload);
      sequences.push(message.sequence);
      expectedChecksums.push(message.checksum);
      receivedChecksums.push(calculatedChecksum);
      latencySamples.push({
        latencyMs: Math.max(0, receivedAtEpochMs - message.sentAtEpochMs),
        receivedAtEpochMs,
      });

      // This is the application handler whose native observable behavior is the oracle.
      userHandlerCount += 1;
      userHandlerAggregateChecksum = aggregateChecksum(
        userHandlerAggregateChecksum,
        calculatedChecksum,
      );
    });
    socket.addEventListener("error", () => {
      lifecycle.error += 1;
    });
    socket.addEventListener("close", () => {
      lifecycle.close += 1;
      window.clearTimeout(timeout);
      observer.disconnect();
      const completedAtEpochMs = Date.now();
      const snapshot = runtime?.engine.getSnapshot();
      resolve({
        bseCapture: runtime
          ? {
              connectionCount: snapshot.connections.length,
              messageCount: snapshot.messages.length,
              panelClosed:
                document.querySelector("bse-devtools-panel") !== null &&
                !document.querySelector("bse-devtools-panel").hasAttribute("open"),
            }
          : null,
        expectedChecksums,
        completedAtEpochMs,
        latencySamples,
        lifecycle,
        longTaskDurations,
        receivedChecksums,
        sequences,
        startedAtEpochMs,
        userHandlerAggregateChecksum,
        userHandlerCount,
      });
    });
  });

window.getRuntimeRetention = () => {
  const snapshot = runtime?.engine.getSnapshot();
  return snapshot
    ? { connections: snapshot.connections.length, messages: snapshot.messages.length }
    : null;
};

window.resetRuntimeCapture = () => {
  runtime?.engine.clear();
};

window.benchmarkReady = true;
