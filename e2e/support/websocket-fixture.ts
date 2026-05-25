import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { fileURLToPath } from "node:url";

const webSocketGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export interface WebSocketFixtureServer {
  readonly port: number;
  readonly url: string;
  close(): Promise<void>;
}

function createAcceptKey(key: string): string {
  return createHash("sha1").update(`${key}${webSocketGuid}`).digest("base64");
}

function getPort(args: readonly string[]): number {
  const portFlagIndex = args.indexOf("--port");
  const rawPort = portFlagIndex >= 0 ? args.at(portFlagIndex + 1) : undefined;
  const port = rawPort ? Number.parseInt(rawPort, 10) : 4175;

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid WebSocket fixture port: ${rawPort ?? ""}`);
  }

  return port;
}

function writeHealthResponse(res: ServerResponse): void {
  res.statusCode = 200;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end("ok");
}

function readMaskedTextFrame(data: Buffer): string | undefined {
  const firstByte = data.at(0);
  const secondByte = data.at(1);

  if (firstByte === undefined || secondByte === undefined) {
    return undefined;
  }

  const opcode = firstByte & 0x0f;
  const isMasked = (secondByte & 0x80) === 0x80;
  let payloadLength = secondByte & 0x7f;
  let offset = 2;

  if (opcode === 0x8 || !isMasked) {
    return undefined;
  }

  if (payloadLength === 126) {
    if (data.length < 4) {
      return undefined;
    }

    payloadLength = data.readUInt16BE(2);
    offset = 4;
  }

  if (payloadLength > 125) {
    return undefined;
  }

  if (data.length < offset + 4 + payloadLength) {
    return undefined;
  }

  const mask = data.subarray(offset, offset + 4);
  offset += 4;
  const payload = Buffer.alloc(payloadLength);

  for (let index = 0; index < payloadLength; index += 1) {
    const source = data.at(offset + index);
    const key = mask.at(index % 4);

    if (source === undefined || key === undefined) {
      return undefined;
    }

    payload[index] = source ^ key;
  }

  return payload.toString("utf8");
}

function writeTextFrame(socket: Socket, message: string): void {
  const payload = Buffer.from(message, "utf8");

  if (payload.length > 125) {
    throw new Error("WebSocket fixture only supports short text frames");
  }

  const frame = Buffer.alloc(2 + payload.length);
  frame[0] = 0x81;
  frame[1] = payload.length;
  payload.copy(frame, 2);
  socket.write(frame);
}

function handleUpgrade(req: IncomingMessage, socket: Socket): void {
  const key = req.headers["sec-websocket-key"];

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

  socket.on("data", (data) => {
    if (!Buffer.isBuffer(data)) {
      return;
    }

    const message = readMaskedTextFrame(data);

    if (message) {
      writeTextFrame(socket, `echo: ${message}`);
    }
  });
}

export async function createWebSocketFixtureServer(port = 4175): Promise<WebSocketFixtureServer> {
  const server: Server = createServer((req, res) => {
    if (req.url === "/health") {
      writeHealthResponse(res);
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  server.on("upgrade", handleUpgrade);

  return await new Promise<WebSocketFixtureServer>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve({
        port,
        url: `ws://127.0.0.1:${port}`,
        async close() {
          await new Promise<void>((resolveClose, rejectClose) => {
            server.close((error) => {
              if (error) {
                rejectClose(error);
                return;
              }

              resolveClose();
            });
          });
        },
      });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const fixture = await createWebSocketFixtureServer(getPort(process.argv));
  const close = (): void => {
    void fixture.close().then(() => {
      process.exitCode = 0;
    });
  };

  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}
