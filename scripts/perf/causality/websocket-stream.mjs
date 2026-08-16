import { checksumText } from "./benchmark-lib.mjs";
import {
  calculateDueBatchEnd,
  calculateNextDelayMs,
  DEFAULT_CATCH_UP_BATCH_LIMIT,
} from "./rate-scheduler.mjs";

function encodeFrame(message, opcode = 0x1) {
  const payload = Buffer.from(message, "utf8");
  let header;

  if (payload.length <= 125) {
    header = Buffer.from([0x80 | opcode, payload.length]);
  } else if (payload.length <= 65_535) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    throw new Error("Benchmark payload exceeds 65535 bytes");
  }

  return Buffer.concat([header, payload]);
}

function closeFrame() {
  const frame = Buffer.alloc(4);
  frame[0] = 0x88;
  frame[1] = 2;
  frame.writeUInt16BE(1000, 2);
  return frame;
}

function writeMessage(socket, sequence) {
  const payload = `sequence:${sequence}:browse-sent-event`;
  const message = JSON.stringify({
    checksum: checksumText(payload),
    payload,
    sentAtEpochMs: Date.now(),
    sequence,
  });
  return socket.write(encodeFrame(message));
}

export const systemStreamScheduler = Object.freeze({
  immediate(callback) {
    const handle = setImmediate(() => callback());
    return () => clearImmediate(handle);
  },
  timeout(callback, delayMs) {
    const handle = setTimeout(() => callback(), delayMs);
    return () => clearTimeout(handle);
  },
});

export function streamMessages(
  socket,
  { count, ratePerSecond },
  scheduler = systemStreamScheduler,
) {
  let sequence = 0;
  let stopped = false;
  let cancelScheduled;
  let drainListener;

  const cancelPendingWork = () => {
    cancelScheduled?.();
    cancelScheduled = undefined;

    if (drainListener) {
      socket.off("drain", drainListener);
      drainListener = undefined;
    }
  };

  const stop = ({ closeSocket = false } = {}) => {
    if (stopped) return;
    stopped = true;
    cancelPendingWork();

    if (closeSocket && !socket.destroyed) {
      socket.end(closeFrame());
    }
  };

  const finish = () => {
    stop({ closeSocket: true });
  };

  const scheduleTimeout = (callback, delayMs) => {
    cancelScheduled = scheduler.timeout(() => {
      cancelScheduled = undefined;
      callback();
    }, delayMs);
  };

  const scheduleImmediate = (callback) => {
    cancelScheduled = scheduler.immediate(() => {
      cancelScheduled = undefined;
      callback();
    });
  };

  const waitForDrain = (callback) => {
    drainListener = () => {
      drainListener = undefined;
      callback();
    };
    socket.once("drain", drainListener);
  };

  socket.once("close", () => {
    stop();
  });
  socket.on("error", () => {
    stop();
  });

  if (count === 0) {
    finish();
    return { stop: finish };
  }

  if (ratePerSecond > 0) {
    const intervalMs = 1_000 / ratePerSecond;
    const initialDelayMs = 25;
    const startedAt = performance.now() + initialDelayMs;
    const sendNext = () => {
      if (stopped) return;
      const nowMs = performance.now();
      const batchEnd = calculateDueBatchEnd({
        batchLimit: DEFAULT_CATCH_UP_BATCH_LIMIT,
        intervalMs,
        nextSequence: sequence,
        nowMs,
        startedAtMs: startedAt,
        totalCount: count,
      });

      while (sequence < batchEnd) {
        const writable = writeMessage(socket, sequence);
        sequence += 1;
        if (sequence >= count) {
          finish();
          return;
        }
        if (!writable) {
          waitForDrain(sendNext);
          return;
        }
      }

      const nextDelayMs = calculateNextDelayMs({
        intervalMs,
        nextSequence: sequence,
        nowMs: performance.now(),
        startedAtMs: startedAt,
      });
      if (nextDelayMs === 0) {
        scheduleImmediate(sendNext);
      } else {
        scheduleTimeout(sendNext, nextDelayMs);
      }
    };
    scheduleTimeout(sendNext, initialDelayMs);
    return { stop: finish };
  }

  const sendChunk = () => {
    if (stopped) return;
    const end = Math.min(sequence + 250, count);
    while (sequence < end) {
      const writable = writeMessage(socket, sequence);
      sequence += 1;
      if (!writable) {
        waitForDrain(sendChunk);
        return;
      }
    }
    if (sequence >= count) {
      finish();
    } else {
      scheduleImmediate(sendChunk);
    }
  };
  scheduleTimeout(sendChunk, 25);
  return { stop: finish };
}
