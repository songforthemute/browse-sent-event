import { createHash } from "node:crypto";
import { createServer } from "node:http";

import { streamMessages } from "./websocket-stream.mjs";

const webSocketGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const socketShutdownGraceMs = 500;

function createAcceptKey(key) {
  return createHash("sha1").update(`${key}${webSocketGuid}`).digest("base64");
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function createBenchmarkWebSocketServer() {
  const activeSockets = new Set();
  const activeStreams = new Map();
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
    // The benchmark is server-to-browser only. Drain the peer's masked close acknowledgement so
    // the TCP readable side can finish instead of leaving an upgraded socket half-open.
    socket.resume();
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    activeSockets.add(socket);
    socket.once("close", () => {
      activeSockets.delete(socket);
      activeStreams.delete(socket);
    });
    const stream = streamMessages(socket, {
      count: parsePositiveInteger(url.searchParams.get("count"), 1),
      ratePerSecond: parsePositiveInteger(url.searchParams.get("rate"), 0),
    });
    activeStreams.set(socket, stream);
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
  let closePromise;

  return {
    url: `ws://127.0.0.1:${address.port}`,
    async close() {
      closePromise ??= (async () => {
        const sockets = [...activeSockets];
        const socketClosures = sockets.map(
          (socket) =>
            new Promise((resolve) => {
              if (socket.destroyed) {
                resolve();
                return;
              }
              socket.once("close", resolve);
            }),
        );
        const serverClosed = new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });

        for (const stream of activeStreams.values()) {
          stream.stop();
        }

        server.closeAllConnections();
        const forceClose = setTimeout(() => {
          for (const socket of activeSockets) {
            socket.destroy();
          }
        }, socketShutdownGraceMs);

        try {
          await Promise.all([serverClosed, ...socketClosures]);
        } finally {
          clearTimeout(forceClose);
          for (const socket of activeSockets) {
            socket.destroy();
          }
        }
      })();

      await closePromise;
    },
  };
}
