import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { connect } from "node:net";
import test from "node:test";

import { checksumText } from "./benchmark-lib.mjs";
import { createBenchmarkWebSocketServer } from "./websocket-server.mjs";
import { streamMessages } from "./websocket-stream.mjs";

const testTimeoutMs = 5_000;
const operationTimeoutMs = 2_500;

function withTimeout(promise, label, timeoutMs = operationTimeoutMs) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

function waitForEvent(target, type, timeoutMs = operationTimeoutMs) {
  return new Promise((resolve, reject) => {
    const onEvent = (event) => {
      clearTimeout(timeout);
      resolve(event);
    };
    const timeout = setTimeout(() => {
      target.removeEventListener(type, onEvent);
      reject(new Error(`Waiting for WebSocket ${type} timed out.`));
    }, timeoutMs);
    target.addEventListener(type, onEvent, { once: true });
  });
}

function closeClientSocket(socket) {
  if (socket?.readyState === WebSocket.CONNECTING || socket?.readyState === WebSocket.OPEN) {
    try {
      socket.close();
    } catch {
      // The bounded server teardown below remains responsible for the underlying TCP socket.
    }
  }
}

function closeServerBounded(server) {
  return withTimeout(server.close(), "Benchmark WebSocket server close");
}

async function openRawUpgrade(serverUrl) {
  const url = new URL(serverUrl);
  const socket = connect({
    allowHalfOpen: true,
    host: url.hostname,
    port: Number(url.port),
  });
  socket.on("error", () => {
    // A force-destroyed peer may reset this deliberately half-open fixture.
  });

  try {
    const handshakeResponse = await withTimeout(
      new Promise((resolve, reject) => {
        let response = "";
        const onError = (error) => reject(error);
        socket.once("error", onError);
        socket.once("connect", () => {
          socket.write(
            [
              "GET /workload?count=10000&rate=1 HTTP/1.1",
              `Host: ${url.host}`,
              "Upgrade: websocket",
              "Connection: Upgrade",
              "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
              "Sec-WebSocket-Version: 13",
              "",
              "",
            ].join("\r\n"),
          );
        });
        socket.on("data", (chunk) => {
          response += chunk.toString("latin1");

          if (response.includes("\r\n\r\n")) {
            socket.off("error", onError);
            resolve(response);
          }
        });
      }),
      "Raw WebSocket upgrade",
    );
    assert.match(handshakeResponse, /^HTTP\/1\.1 101 Switching Protocols/);
    return socket;
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

function createManualScheduler() {
  const jobs = [];

  function schedule(callback) {
    const job = { callback, cancelled: false };
    jobs.push(job);
    return () => {
      job.cancelled = true;
    };
  }

  return {
    immediate: schedule,
    timeout: schedule,
    get pendingCount() {
      return jobs.filter((job) => !job.cancelled).length;
    },
    runNext() {
      const job = jobs.shift();

      if (job && !job.cancelled) {
        job.callback();
      }
    },
    runAll() {
      while (jobs.length > 0) {
        this.runNext();
      }
    },
  };
}

class BackpressuredSocket extends EventEmitter {
  destroyed = false;
  endedFrames = [];
  writtenFrames = [];

  end(frame) {
    this.endedFrames.push(frame);
  }

  write(frame) {
    this.writtenFrames.push(frame);
    return false;
  }
}

void test(
  "preserves message order, checksum, and normal close semantics",
  { timeout: testTimeoutMs },
  async () => {
    const server = await createBenchmarkWebSocketServer();
    let socket;

    try {
      socket = new WebSocket(`${server.url}/workload?count=3&rate=0`);
      const messages = [];
      socket.addEventListener("message", (event) => {
        messages.push(JSON.parse(String(event.data)));
      });
      const closeEvent = await waitForEvent(socket, "close");
      assert.deepEqual(
        messages.map((message) => message.sequence),
        [0, 1, 2],
      );
      assert.equal(
        messages.every((message) => message.checksum === checksumText(message.payload)),
        true,
      );
      assert.equal(closeEvent.code, 1000);
    } finally {
      closeClientSocket(socket);
      await closeServerBounded(server);
    }
  },
);

void test(
  "cancels paced work and closes active upgraded sockets during teardown",
  { timeout: testTimeoutMs },
  async () => {
    const server = await createBenchmarkWebSocketServer();
    let socket;

    try {
      socket = new WebSocket(`${server.url}/workload?count=10000&rate=1`);
      await waitForEvent(socket, "open");
      const socketClosed = waitForEvent(socket, "close");

      await closeServerBounded(server);
      const closeEvent = await socketClosed;

      assert.equal(closeEvent.code, 1000);
      await closeServerBounded(server);
    } finally {
      closeClientSocket(socket);
      await closeServerBounded(server);
    }
  },
);

void test(
  "force-destroys a raw upgraded socket that never sends a close acknowledgement",
  { timeout: testTimeoutMs },
  async () => {
    const server = await createBenchmarkWebSocketServer();
    let socket;

    try {
      socket = await openRawUpgrade(server.url);
      const startedAt = performance.now();
      await closeServerBounded(server);
      const elapsedMs = performance.now() - startedAt;

      assert.ok(elapsedMs >= 400, `Expected force-close grace period, received ${elapsedMs}ms.`);
      assert.ok(elapsedMs < operationTimeoutMs);
    } finally {
      socket?.destroy();
      await closeServerBounded(server);
    }
  },
);

void test(
  "removes scheduled work and a backpressure drain listener without further writes",
  { timeout: testTimeoutMs },
  () => {
    const scheduledSocket = new BackpressuredSocket();
    const scheduled = createManualScheduler();
    const scheduledStream = streamMessages(
      scheduledSocket,
      { count: 10, ratePerSecond: 0 },
      scheduled,
    );

    assert.equal(scheduled.pendingCount, 1);
    scheduledStream.stop();
    assert.equal(scheduled.pendingCount, 0);
    scheduled.runAll();
    assert.equal(scheduledSocket.writtenFrames.length, 0);

    const backpressuredSocket = new BackpressuredSocket();
    const backpressured = createManualScheduler();
    const backpressuredStream = streamMessages(
      backpressuredSocket,
      { count: 10, ratePerSecond: 0 },
      backpressured,
    );
    backpressured.runNext();

    assert.equal(backpressuredSocket.writtenFrames.length, 1);
    assert.equal(backpressuredSocket.listenerCount("drain"), 1);
    backpressuredStream.stop();
    assert.equal(backpressuredSocket.listenerCount("drain"), 0);
    assert.equal(backpressured.pendingCount, 0);

    backpressuredSocket.emit("drain");
    backpressured.runAll();
    assert.equal(backpressuredSocket.writtenFrames.length, 1);
    assert.equal(backpressuredSocket.endedFrames.length, 1);
  },
);
