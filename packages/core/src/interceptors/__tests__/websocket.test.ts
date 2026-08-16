import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDevtoolsEngine, disposeDevtoolsEngine } from "../../runtime/engine.js";
import { installWebSocketInterceptor } from "../websocket.js";

const originalWebSocket = globalThis.window.WebSocket;
const openIdentityListener = () => undefined;
const messageIdentityListener = () => undefined;
const nativeIdentityListener = () => undefined;

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
  #onMessage: WebSocket["onmessage"] = null;
  readonly #onMessageDispatcher = (event: Event): void => {
    if (this.#onMessage && event instanceof globalThis.MessageEvent) {
      Reflect.apply(this.#onMessage, this, [event]);
    }
  };

  constructor(url: string | URL) {
    super();
    this.url = String(url);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this.sent.push(data);
  }

  get onmessage(): WebSocket["onmessage"] {
    return this.#onMessage;
  }

  set onmessage(listener: WebSocket["onmessage"]) {
    const hadListener = this.#onMessage !== null;
    this.#onMessage = typeof listener === "function" ? listener : null;

    if (!hadListener && this.#onMessage) {
      super.addEventListener("message", this.#onMessageDispatcher);
    } else if (hadListener && !this.#onMessage) {
      super.removeEventListener("message", this.#onMessageDispatcher);
    }
  }

  close(code?: number): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new globalThis.CloseEvent("close", { code }));
  }
}

function dispatchMessage(socket: EventTarget, data: string): MessageEvent {
  const event = new globalThis.MessageEvent("message", { data });
  socket.dispatchEvent(event);
  return event;
}

function normalizeHappyDomOnMessage(phase: readonly string[]): string[] {
  let sawOnMessage = false;

  return phase.filter((call) => {
    if (!call.startsWith("onmessage-")) {
      return true;
    }

    if (sawOnMessage) {
      return false;
    }

    sawOnMessage = true;
    return true;
  });
}

function getInboundTrace(engine: ReturnType<typeof createDevtoolsEngine>, payload: string) {
  const message = engine
    .getMessages()
    .find((candidate) => candidate.direction === "in" && candidate.payloadPreview === payload);

  if (!message) {
    throw new Error(`Expected retained inbound message ${payload}.`);
  }

  return engine.causality.getTrace(message.id);
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

  it("leaves excluded WebSocket instances uninstrumented", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });

    installWebSocketInterceptor({
      engine,
      shouldExcludeUrl: (url) => url.includes("/ignored"),
      target: globalThis.window,
    });

    const socket = new globalThis.window.WebSocket("wss://example.test/ignored");

    socket.send("native message");

    expect(Reflect.get(socket, "sent")).toEqual(["native message"]);
    expect(Object.hasOwn(socket, "send")).toBe(false);
    expect(engine.getConnections()).toEqual([]);
    expect(engine.getMessages()).toEqual([]);
  });

  it("links parallel function handlers to the same native MessageEvent root", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });
    installWebSocketInterceptor({ engine, target: globalThis.window });
    const socket = new globalThis.window.WebSocket("wss://example.test/socket");
    const seenEvents: Event[] = [];
    const seenReceivers: unknown[] = [];
    const activeNodeIds: string[] = [];

    function listener(this: WebSocket, event: MessageEvent): void {
      seenEvents.push(event);
      seenReceivers.push(this);
      const active = engine.causality.getActiveContext();

      if (active) {
        activeNodeIds.push(active.activeNodeId);
      }
    }

    socket.addEventListener("message", listener);
    socket.addEventListener("message", (event) => listener.call(socket, event));
    const event = dispatchMessage(socket, "parallel");
    const trace = getInboundTrace(engine, "parallel");

    expect(seenEvents).toEqual([event, event]);
    expect(seenReceivers).toEqual([socket, socket]);
    expect(engine.causality.getActiveContext()).toBeUndefined();
    expect(trace?.nodes.map((node) => node.kind)).toEqual([
      "transport.received",
      "handler.started",
      "handler.returned",
      "handler.started",
      "handler.returned",
    ]);
    expect(activeNodeIds).toEqual([trace?.nodes[1]?.id, trace?.nodes[3]?.id]);
    expect(
      trace?.edges.map((edge) => [edge.fromNodeId, edge.toNodeId, edge.correlationMethod]),
    ).toEqual([
      [trace?.rootNodeId, trace?.nodes[1]?.id, "same-native-event"],
      [trace?.nodes[1]?.id, trace?.nodes[2]?.id, "same-call-stack"],
      [trace?.rootNodeId, trace?.nodes[3]?.id, "same-native-event"],
      [trace?.nodes[3]?.id, trace?.nodes[4]?.id, "same-call-stack"],
    ]);
    expect(trace?.edges.every((edge) => edge.confidence === "definitive")).toBe(true);
  });

  it("preserves object listener lookup, capture removal, duplicate, once, and signal semantics", () => {
    const runScenario = (socket: EventTarget): string[] => {
      const calls: string[] = [];
      const listener = {
        handleEvent() {
          calls.push("initial");
        },
      };
      const controller = new globalThis.window.AbortController();

      socket.addEventListener("message", listener, { capture: true, passive: true });
      socket.addEventListener("message", listener, { capture: true, passive: false });
      listener.handleEvent = () => calls.push("dynamic");
      socket.removeEventListener("message", listener, { capture: false });
      dispatchMessage(socket, "first");
      socket.removeEventListener("message", listener, { capture: true });
      dispatchMessage(socket, "second");

      socket.addEventListener("message", () => calls.push("once"), { once: true });
      const aborted = () => calls.push("aborted");
      socket.addEventListener("message", aborted, { signal: controller.signal });
      controller.abort();
      dispatchMessage(socket, "third");
      dispatchMessage(socket, "fourth");
      return calls;
    };
    const nativeCalls = runScenario(new FakeWebSocket("wss://example.test/native"));
    const engine = createDevtoolsEngine({ capacity: 20 });
    installWebSocketInterceptor({ engine, target: globalThis.window });
    const socket = new globalThis.window.WebSocket("wss://example.test/socket");
    const instrumentedCalls = runScenario(socket);

    expect(instrumentedCalls).toEqual(nativeCalls);
    expect(instrumentedCalls.filter((call) => call === "once")).toHaveLength(1);
    expect(instrumentedCalls).not.toContain("initial");
    expect(instrumentedCalls).not.toContain("aborted");
  });

  it("preserves onmessage getter, reassignment order, null removal, and tail re-add", () => {
    const runScenario = (socket: EventTarget & { onmessage: WebSocket["onmessage"] }) => {
      const calls: string[] = [];
      const phases: string[][] = [];
      const first = () => calls.push("onmessage-first");
      const second = () => calls.push("onmessage-second");

      socket.addEventListener("message", () => calls.push("before"));
      // oxlint-disable-next-line unicorn/prefer-add-event-listener -- onmessage is the contract under test.
      socket.onmessage = first;
      socket.addEventListener("message", () => calls.push("after"));
      const firstGetter = socket.onmessage;
      // oxlint-disable-next-line unicorn/prefer-add-event-listener -- reassignment order is under test.
      socket.onmessage = second;
      const secondGetter = socket.onmessage;
      dispatchMessage(socket, "reassigned");
      phases.push(calls.splice(0));
      // oxlint-disable-next-line unicorn/prefer-add-event-listener -- null removal is under test.
      socket.onmessage = null;
      const nullGetter = socket.onmessage;
      Reflect.set(socket, "onmessage", { handleEvent: first });
      const nonCallableGetter = socket.onmessage;
      dispatchMessage(socket, "removed");
      phases.push(calls.splice(0));
      // oxlint-disable-next-line unicorn/prefer-add-event-listener -- tail re-add is under test.
      socket.onmessage = first;
      dispatchMessage(socket, "re-added");
      phases.push(calls.splice(0));

      return {
        phases,
        getters: [
          firstGetter === first,
          secondGetter === second,
          nullGetter === null,
          nonCallableGetter === null,
        ],
      };
    };
    const native = runScenario(new FakeWebSocket("wss://example.test/native"));
    const engine = createDevtoolsEngine({ capacity: 10 });
    installWebSocketInterceptor({ engine, target: globalThis.window });
    const socket = new globalThis.window.WebSocket("wss://example.test/socket");
    const instrumented = runScenario(socket);

    expect(instrumented.phases.map(normalizeHappyDomOnMessage)).toEqual(native.phases);
    expect(instrumented.getters).toEqual([true, true, true, true]);
  });

  it("pops synchronous context immediately for Promise-returning handlers", async () => {
    const engine = createDevtoolsEngine({ capacity: 10 });
    installWebSocketInterceptor({ engine, target: globalThis.window });
    const socket = new globalThis.window.WebSocket("wss://example.test/socket");
    let beforeAwait: string | undefined;
    let afterAwait: string | undefined;

    socket.addEventListener("message", async () => {
      beforeAwait = engine.causality.getActiveContext()?.activeNodeId;
      await Promise.resolve();
      afterAwait = engine.causality.getActiveContext()?.activeNodeId;
    });
    dispatchMessage(socket, "async");
    const trace = getInboundTrace(engine, "async");

    expect(beforeAwait).toBe(trace?.nodes[1]?.id);
    expect(engine.causality.getActiveContext()).toBeUndefined();
    await Promise.resolve();
    expect(afterAwait).toBeUndefined();
    expect(trace?.nodes.map((node) => node.kind)).toEqual([
      "transport.received",
      "handler.started",
      "handler.returned",
    ]);
  });

  it("preserves listener exception behavior while recording synchronous return-boundary evidence", () => {
    const observeException = (socket: EventTarget): Error | undefined => {
      const failure = new Error("listener failed");
      socket.addEventListener("message", () => {
        throw failure;
      });

      try {
        dispatchMessage(socket, "failure");
      } catch (error) {
        return error instanceof Error ? error : new Error(String(error));
      }

      return undefined;
    };
    const nativeError = observeException(new FakeWebSocket("wss://example.test/native"));
    const engine = createDevtoolsEngine({ capacity: 10 });
    installWebSocketInterceptor({ engine, target: globalThis.window });
    const socket = new globalThis.window.WebSocket("wss://example.test/socket");
    const instrumentedError = observeException(socket);

    expect(instrumentedError?.message).toBe(nativeError?.message);
    expect(getInboundTrace(engine, "failure")?.nodes.map((node) => node.kind)).toEqual([
      "transport.received",
      "handler.started",
      "handler.returned",
    ]);
  });

  it("does not attach later outer handlers after a nested capacity eviction", () => {
    const engine = createDevtoolsEngine({ capacity: 1 });
    installWebSocketInterceptor({ engine, target: globalThis.window });
    const socket = new globalThis.window.WebSocket("wss://example.test/socket");
    const calls: string[] = [];
    let nested = false;

    socket.addEventListener("message", () => {
      calls.push(nested ? "inner-first" : "outer-first");

      if (!nested) {
        nested = true;
        dispatchMessage(socket, "inner");
      }
    });
    socket.addEventListener("message", () => {
      calls.push(nested ? "later" : "unexpected");
    });

    dispatchMessage(socket, "outer");
    const trace = getInboundTrace(engine, "inner");

    expect(calls).toEqual(["outer-first", "inner-first", "later", "later"]);
    expect(engine.getMessages()).toHaveLength(1);
    expect(trace?.nodes.map((node) => node.kind)).toEqual([
      "transport.received",
      "handler.started",
      "handler.returned",
      "handler.started",
      "handler.returned",
    ]);
    expect(engine.causality.getActiveContext()).toBeUndefined();
  });

  it("leaves EventTarget prototype bypass listeners outside handler causality", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });
    installWebSocketInterceptor({ engine, target: globalThis.window });
    const socket = new globalThis.window.WebSocket("wss://example.test/socket");
    let calls = 0;

    globalThis.EventTarget.prototype.addEventListener.call(socket, "message", () => {
      calls += 1;
    });
    dispatchMessage(socket, "bypassed");

    expect(calls).toBe(1);
    expect(getInboundTrace(engine, "bypassed")?.nodes.map((node) => node.kind)).toEqual([
      "transport.received",
    ]);
  });

  it("makes existing socket wrappers native-only after uninstall", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });
    const installed = installWebSocketInterceptor({ engine, target: globalThis.window });
    const socket = new globalThis.window.WebSocket("wss://example.test/socket");
    let calls = 0;
    socket.addEventListener("message", () => {
      calls += 1;
    });

    installed?.uninstall();
    socket.send("after-uninstall");
    dispatchMessage(socket, "after-uninstall");

    expect(calls).toBe(1);
    expect(engine.getMessages()).toEqual([]);
  });

  it("preserves borrowed receivers and does not instrument an unrelated EventTarget", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });
    installWebSocketInterceptor({ engine, target: globalThis.window });
    const first = new globalThis.window.WebSocket("wss://example.test/first");
    const second = new globalThis.window.WebSocket("wss://example.test/second");
    const unrelated = new globalThis.EventTarget();
    const borrowedAdd: unknown = Reflect.get(first, "addEventListener");
    const borrowedRemove: unknown = Reflect.get(first, "removeEventListener");
    const receivers: unknown[] = [];
    const listener = function (this: EventTarget): void {
      receivers.push(this);
    };

    if (typeof borrowedAdd !== "function" || typeof borrowedRemove !== "function") {
      throw new Error("Expected borrowed EventTarget methods.");
    }

    Reflect.apply(borrowedAdd, second, ["message", listener]);
    Reflect.apply(borrowedAdd, unrelated, ["message", listener]);
    dispatchMessage(second, "borrowed");
    unrelated.dispatchEvent(new globalThis.MessageEvent("message", { data: "unrelated" }));
    Reflect.apply(borrowedRemove, second, ["message", listener]);
    dispatchMessage(second, "removed");

    expect(receivers).toEqual([second, unrelated]);
    expect(getInboundTrace(engine, "borrowed")?.nodes.map((node) => node.kind)).toEqual([
      "transport.received",
      "handler.started",
      "handler.returned",
    ]);
  });

  it("supports subclass overrides without calling private-field code before initialization", () => {
    let addCalls = 0;

    class SubclassWebSocket extends FakeWebSocket {
      #initialized = false;

      constructor(url: string | URL) {
        super(url);
        this.#initialized = true;
      }

      override addEventListener(
        type: string,
        callback: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
      ): void {
        if (!this.#initialized) {
          throw new Error("Subclass listener override ran before private field initialization.");
        }

        addCalls += 1;
        super.addEventListener(type, callback, options);
      }
    }

    Reflect.set(globalThis.window, "WebSocket", SubclassWebSocket);
    const engine = createDevtoolsEngine({ capacity: 10 });
    installWebSocketInterceptor({ engine, target: globalThis.window });
    const socket = new globalThis.window.WebSocket("wss://example.test/subclass");
    let calls = 0;
    socket.addEventListener("message", () => {
      calls += 1;
    });
    dispatchMessage(socket, "subclass");

    expect(addCalls).toBe(1);
    expect(calls).toBe(1);
    expect(getInboundTrace(engine, "subclass")?.nodes.map((node) => node.kind)).toEqual([
      "transport.received",
      "handler.started",
      "handler.returned",
    ]);
  });

  it("does not nest transport or handler instrumentation on direct double install", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });
    const first = installWebSocketInterceptor({ engine, target: globalThis.window });
    const second = installWebSocketInterceptor({ engine, target: globalThis.window });
    const socket = new globalThis.window.WebSocket("wss://example.test/double");
    let calls = 0;
    socket.addEventListener("message", () => {
      calls += 1;
    });
    dispatchMessage(socket, "double");

    expect(calls).toBe(1);
    expect(engine.getConnections()).toHaveLength(1);
    expect(engine.getMessages()).toHaveLength(1);
    expect(getInboundTrace(engine, "double")?.nodes.map((node) => node.kind)).toEqual([
      "transport.received",
      "handler.started",
      "handler.returned",
    ]);

    second?.uninstall();
    first?.uninstall();
  });

  it("lets the active outer install own new sockets after a stale inner uninstall", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });
    const first = installWebSocketInterceptor({ engine, target: globalThis.window });
    const second = installWebSocketInterceptor({ engine, target: globalThis.window });

    first?.uninstall();
    const socket = new globalThis.window.WebSocket("wss://example.test/active-owner");
    let calls = 0;
    socket.addEventListener("message", () => {
      calls += 1;
    });
    dispatchMessage(socket, "active-owner");

    expect(calls).toBe(1);
    expect(engine.getConnections()).toHaveLength(1);
    expect(getInboundTrace(engine, "active-owner")?.nodes.map((node) => node.kind)).toEqual([
      "transport.received",
      "handler.started",
      "handler.returned",
    ]);

    second?.uninstall();
  });

  it("only substitutes message listeners and leaves other event callbacks exact", () => {
    const registrations: Array<{ listener: unknown; type: string }> = [];

    class InspectableWebSocket extends FakeWebSocket {
      override addEventListener(
        type: string,
        callback: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
      ): void {
        registrations.push({ listener: callback, type });
        super.addEventListener(type, callback, options);
      }
    }

    Reflect.set(globalThis.window, "WebSocket", InspectableWebSocket);
    const engine = createDevtoolsEngine({ capacity: 10 });
    installWebSocketInterceptor({ engine, target: globalThis.window });
    const socket = new globalThis.window.WebSocket("wss://example.test/exact-types");
    socket.addEventListener("open", openIdentityListener);
    socket.addEventListener("message", messageIdentityListener);

    expect(registrations.map((registration) => registration.type)).toEqual(["open", "message"]);
    expect(registrations[0]?.listener).toBe(openIdentityListener);
    expect(registrations[1]?.listener).not.toBe(messageIdentityListener);
  });

  it("keeps listener methods native when an own non-configurable method prevents atomic patching", () => {
    class NonConfigurableRemoveWebSocket extends FakeWebSocket {
      constructor(url: string | URL) {
        super(url);
        const nativeRemove = super.removeEventListener.bind(this);
        Object.defineProperty(this, "removeEventListener", {
          configurable: false,
          value: nativeRemove,
          writable: false,
        });
      }
    }

    Reflect.set(globalThis.window, "WebSocket", NonConfigurableRemoveWebSocket);
    const engine = createDevtoolsEngine({ capacity: 10 });
    installWebSocketInterceptor({ engine, target: globalThis.window });
    const socket = new globalThis.window.WebSocket("wss://example.test/non-configurable");
    let calls = 0;
    const listener = () => {
      calls += 1;
    };
    socket.addEventListener("message", listener);
    socket.removeEventListener("message", listener);
    dispatchMessage(socket, "removed-native");

    expect(calls).toBe(0);
    expect(Object.hasOwn(socket, "addEventListener")).toBe(false);
    expect(getInboundTrace(engine, "removed-native")?.nodes.map((node) => node.kind)).toEqual([
      "transport.received",
    ]);
  });

  it("returns a native-only exotic socket when intrinsic observer registration fails", () => {
    class NonEventTargetWebSocket {
      readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
      readonly sent: unknown[] = [];
      readonly url: string;

      constructor(url: string | URL) {
        this.url = String(url);
      }

      addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
        if (listener) {
          const listeners = this.listeners.get(type) ?? new Set();
          listeners.add(listener);
          this.listeners.set(type, listeners);
        }
      }

      removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
        if (listener) {
          this.listeners.get(type)?.delete(listener);
        }
      }

      send(data: unknown): void {
        this.sent.push(data);
      }
    }

    Reflect.set(globalThis.window, "WebSocket", NonEventTargetWebSocket);
    const engine = createDevtoolsEngine({ capacity: 10 });
    installWebSocketInterceptor({ engine, target: globalThis.window });
    const socket: unknown = Reflect.construct(globalThis.window.WebSocket, [
      "wss://example.test/exotic",
    ]);

    expect(socket).toBeInstanceOf(NonEventTargetWebSocket);

    if (typeof socket !== "object" || socket === null) {
      throw new Error("Expected an exotic socket object.");
    }

    const addEventListener: unknown = Reflect.get(socket, "addEventListener");
    const send: unknown = Reflect.get(socket, "send");

    if (typeof addEventListener !== "function" || typeof send !== "function") {
      throw new Error("Expected native exotic socket methods.");
    }

    Reflect.apply(addEventListener, socket, ["message", nativeIdentityListener]);
    Reflect.apply(send, socket, ["native-send"]);
    expect(Object.hasOwn(socket, "addEventListener")).toBe(false);
    expect(Object.hasOwn(socket, "send")).toBe(false);
    expect(Reflect.get(socket, "listeners")).toEqual(
      new Map([["message", new Set([nativeIdentityListener])]]),
    );
    expect(Reflect.get(socket, "sent")).toEqual(["native-send"]);
    expect(engine.getConnections()).toEqual([]);
    expect(engine.getMessages()).toEqual([]);
  });

  it("rolls back earlier observers when a later intrinsic registration fails", () => {
    const prototype = globalThis.window.EventTarget.prototype;
    const originalAdd: unknown = Reflect.get(prototype, "addEventListener");

    if (typeof originalAdd !== "function") {
      throw new Error("Expected the native EventTarget addEventListener.");
    }

    let registrations = 0;
    const failingAdd = function (
      this: EventTarget,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ): void {
      registrations += 1;

      if (registrations === 2) {
        throw new Error("observer registration failed");
      }

      Reflect.apply(originalAdd, this, [type, listener, options]);
    };
    Reflect.set(prototype, "addEventListener", failingAdd);

    try {
      const engine = createDevtoolsEngine({ capacity: 10 });
      installWebSocketInterceptor({ engine, target: globalThis.window });
      const socket = new globalThis.window.WebSocket("wss://example.test/observer-rollback");
      let calls = 0;
      socket.addEventListener("open", () => {
        calls += 1;
      });
      socket.dispatchEvent(new globalThis.Event("open"));

      expect(calls).toBe(1);
      expect(engine.getConnections()).toEqual([]);
      expect(Object.hasOwn(socket, "addEventListener")).toBe(false);
      expect(Object.hasOwn(socket, "send")).toBe(false);
    } finally {
      Reflect.set(prototype, "addEventListener", originalAdd);
    }
  });

  it("falls back to a fully native socket when connection observation is unavailable", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });
    installWebSocketInterceptor({ engine, target: globalThis.window });
    disposeDevtoolsEngine(engine);

    const socket = new globalThis.window.WebSocket("wss://example.test/disposed");
    let calls = 0;
    socket.addEventListener("message", () => {
      calls += 1;
    });
    socket.send("native-send");
    dispatchMessage(socket, "native-message");

    expect(calls).toBe(1);
    expect(Object.hasOwn(socket, "addEventListener")).toBe(false);
    expect(Object.hasOwn(socket, "removeEventListener")).toBe(false);
    expect(Object.hasOwn(socket, "send")).toBe(false);
    expect(Reflect.get(socket, "sent")).toEqual(["native-send"]);
  });

  it("preserves native URL coercion count by using the constructed socket URL", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });
    installWebSocketInterceptor({ engine, target: globalThis.window });
    let coercions = 0;
    const url = {
      toString() {
        coercions += 1;
        return "wss://example.test/coercion";
      },
    };

    Reflect.construct(globalThis.window.WebSocket, [url]);

    expect(coercions).toBe(1);
    expect(engine.getConnections()[0]?.url).toBe("wss://example.test/coercion");
  });
});
