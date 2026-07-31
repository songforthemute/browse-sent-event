import type { BrowseSentEventPayload } from "../runtime/events.js";
import type {
  BrowseSentEventInterceptorContext,
  InstalledBrowseSentEventInterceptor,
} from "./types.js";
import { isUrlExcluded } from "./types.js";
import { installGlobalPatch } from "./global-patch.js";

function copyArrayBuffer(
  buffer: ArrayBufferLike,
  byteOffset = 0,
  byteLength = buffer.byteLength,
): ArrayBuffer {
  return Uint8Array.from(new Uint8Array(buffer, byteOffset, byteLength)).buffer;
}

function toPayload(data: unknown): BrowseSentEventPayload {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return data;
  }

  if (ArrayBuffer.isView(data)) {
    return copyArrayBuffer(data.buffer, data.byteOffset, data.byteLength);
  }

  return String(data);
}

function isInstrumentableWebSocket(value: unknown): value is WebSocket {
  return (
    typeof value === "object" && value !== null && "addEventListener" in value && "send" in value
  );
}

export function installWebSocketInterceptor(
  context: BrowseSentEventInterceptorContext,
): InstalledBrowseSentEventInterceptor | undefined {
  const OriginalWebSocket = context.target.WebSocket;

  if (!OriginalWebSocket) {
    return undefined;
  }

  const ProxiedWebSocket = new Proxy(OriginalWebSocket, {
    construct(target, args, newTarget) {
      const socket: unknown = Reflect.construct(target, args, newTarget);

      if (!isInstrumentableWebSocket(socket)) {
        throw new TypeError("Expected WebSocket instance.");
      }

      const url = String(args[0]);

      if (isUrlExcluded(context, url)) {
        return socket;
      }

      const connection = context.engine.recordConnection({
        protocol: "websocket",
        url,
        state: "connecting",
      });

      socket.addEventListener("open", () => {
        context.engine.updateConnection(connection.id, { state: "open" });
      });
      socket.addEventListener("close", (event) => {
        context.engine.updateConnection(connection.id, {
          state: "closed",
          closedAt: globalThis.performance?.now() ?? Date.now(),
          closeCode: event.code,
        });
      });
      socket.addEventListener("message", (event) => {
        context.engine.recordMessage({
          connectionId: connection.id,
          direction: "in",
          protocol: "websocket",
          payload: toPayload(event.data),
          metadata: { url },
        });
      });

      const originalSend = socket.send.bind(socket);

      Reflect.set(socket, "send", (data: Parameters<WebSocket["send"]>[0]) => {
        context.engine.recordMessage({
          connectionId: connection.id,
          direction: "out",
          protocol: "websocket",
          payload: toPayload(data),
          metadata: { url },
        });

        originalSend(data);
      });

      return socket;
    },
  });

  const patch = installGlobalPatch(context.target, "WebSocket", () => ProxiedWebSocket);

  return {
    name: "websocket",
    uninstall() {
      patch.uninstall();
    },
  };
}
