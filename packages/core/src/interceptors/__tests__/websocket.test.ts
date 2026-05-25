import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDevtoolsEngine } from "../../runtime/engine.js";
import { installWebSocketInterceptor } from "../websocket.js";

const originalWebSocket = globalThis.window.WebSocket;

class FakeWebSocket extends globalThis.EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readonly protocol = "";
  readyState = FakeWebSocket.CONNECTING;
  binaryType: BinaryType = "blob";
  readonly sent: unknown[] = [];

  constructor(url: string | URL) {
    super();
    this.url = String(url);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this.sent.push(data);
  }

  close(code?: number): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new globalThis.CloseEvent("close", { code }));
  }
}

describe("installWebSocketInterceptor", () => {
  beforeEach(() => {
    Reflect.set(globalThis.window, "WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    Reflect.set(globalThis.window, "WebSocket", originalWebSocket);
  });

  it("records connection lifecycle and in/out messages", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });
    const installed = installWebSocketInterceptor({
      engine,
      target: globalThis.window,
    });
    const socket = new globalThis.window.WebSocket("wss://example.test/socket");

    socket.dispatchEvent(new globalThis.Event("open"));
    socket.send("client-message");
    socket.dispatchEvent(new globalThis.MessageEvent("message", { data: "server-message" }));
    socket.close(1000);

    expect(installed?.name).toBe("websocket");
    expect(engine.getConnections()).toEqual([
      expect.objectContaining({
        protocol: "websocket",
        state: "closed",
        url: "wss://example.test/socket",
        closeCode: 1000,
      }),
    ]);
    expect(engine.getMessages()).toEqual([
      expect.objectContaining({ direction: "out", payloadPreview: "client-message" }),
      expect.objectContaining({ direction: "in", payloadPreview: "server-message" }),
    ]);

    installed?.uninstall();
    expect(globalThis.window.WebSocket).toBe(FakeWebSocket);
  });
});
