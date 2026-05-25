import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDevtoolsEngine } from "../../runtime/engine.js";
import { installEventSourceInterceptor } from "../eventsource.js";

const originalEventSource = globalThis.window.EventSource;

class FakeEventSource extends globalThis.EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readonly url: string;
  readonly withCredentials = false;
  readyState = FakeEventSource.CONNECTING;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }
}

describe("installEventSourceInterceptor", () => {
  beforeEach(() => {
    Reflect.set(globalThis.window, "EventSource", FakeEventSource);
  });

  afterEach(() => {
    Reflect.set(globalThis.window, "EventSource", originalEventSource);
  });

  it("records EventSource lifecycle and message events", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });

    installEventSourceInterceptor({
      engine,
      target: globalThis.window,
    });

    const source = new globalThis.window.EventSource("https://example.test/events");

    source.dispatchEvent(new globalThis.Event("open"));
    source.dispatchEvent(
      new globalThis.MessageEvent("message", {
        data: "server-event",
        lastEventId: "event-1",
      }),
    );
    source.close();

    expect(engine.getConnections()).toEqual([
      expect.objectContaining({
        protocol: "eventsource",
        state: "closed",
        url: "https://example.test/events",
      }),
    ]);
    expect(engine.getMessages()).toEqual([
      expect.objectContaining({
        payloadPreview: "server-event",
        type: "message",
        metadata: expect.objectContaining({
          lastEventId: "event-1",
        }),
      }),
    ]);
  });
});
