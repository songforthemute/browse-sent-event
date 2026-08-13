import { createHash } from "node:crypto";
import { createServer } from "node:http";

import { checksumText } from "./benchmark-lib.mjs";

const webSocketGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function createAcceptKey(key) {
  return createHash("sha1").update(`${key}${webSocketGuid}`).digest("base64");
}

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

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
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

function streamMessages(socket, { count, ratePerSecond }) {
  let sequence = 0;
  let stopped = false;

  const finish = () => {
    if (stopped) return;
    stopped = true;
    socket.write(closeFrame());
    setTimeout(() => socket.end(), 25).unref();
  };

  socket.once("close", () => {
    stopped = true;
  });
  socket.on("error", () => {
    stopped = true;
  });

  if (count === 0) {
    finish();
    return;
  }

  if (ratePerSecond > 0) {
    const intervalMs = 1_000 / ratePerSecond;
    const startedAt = performance.now();
    const sendNext = () => {
      if (stopped) return;
      const writable = writeMessage(socket, sequence);
      sequence += 1;
      if (sequence >= count) {
        finish();
        return;
      }
      const target = startedAt + sequence * intervalMs;
      const schedule = () => setTimeout(sendNext, Math.max(0, target - performance.now()));
      if (writable) schedule();
      else socket.once("drain", schedule);
    };
    setTimeout(sendNext, 25);
    return;
  }

  const sendChunk = () => {
    if (stopped) return;
    const end = Math.min(sequence + 250, count);
    while (sequence < end) {
      const writable = writeMessage(socket, sequence);
      sequence += 1;
      if (!writable) {
        socket.once("drain", sendChunk);
        return;
      }
    }
    if (sequence >= count) {
      finish();
    } else {
      setImmediate(sendChunk);
    }
  };
  setTimeout(sendChunk, 25);
}

export async function createBenchmarkWebSocketServer() {
  const server = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
      return;
    }
    response.writeHead(404);
    response.end();
  });

  server.on("upgrade", (request, socket) => {
    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.destroy();
      return;
    }
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${createAcceptKey(key)}`,
        "",
        "",
      ].join("\r\n"),
    );
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    streamMessages(socket, {
      count: parsePositiveInteger(url.searchParams.get("count"), 1),
      ratePerSecond: parsePositiveInteger(url.searchParams.get("rate"), 0),
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") throw new Error("WebSocket server has no TCP port");

  return {
    url: `ws://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
