import type { BrowseSentEventPayload } from "../runtime/events.js";
import type { CausalityContext } from "../causality/model.js";
import type {
  BrowseSentEventInterceptorContext,
  InstalledBrowseSentEventInterceptor,
} from "./types.js";
import { isUrlExcluded } from "./types.js";
import { installGlobalPatch } from "./global-patch.js";

type MessageListener = EventListenerOrEventListenerObject;

interface WebSocketInstallation {
  active: boolean;
}

type PropertyAccessor = (...args: never[]) => unknown;

function isPropertyAccessor(value: unknown): value is PropertyAccessor {
  return typeof value === "function";
}

interface WebSocketInstrumentationState {
  readonly connectionId: string;
  readonly context: BrowseSentEventInterceptorContext;
  readonly eventContexts: WeakMap<Event, CausalityContext>;
  readonly installation: WebSocketInstallation;
  readonly listenerWrappers: WeakMap<MessageListener, EventListener>;
  readonly nativeAddEventListener: EventTarget["addEventListener"];
  readonly nativeOnMessageDescriptor?: PropertyDescriptor;
  readonly nativeRemoveEventListener: EventTarget["removeEventListener"];
  onMessageOriginal?: (this: WebSocket, event: MessageEvent) => unknown;
  onMessageWrapped: boolean;
}

const instrumentedSockets = new WeakMap<object, WebSocketInstrumentationState>();

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

function findPropertyDescriptor(value: object, key: PropertyKey): PropertyDescriptor | undefined {
  let current: object | null = value;

  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);

    if (descriptor) {
      return descriptor;
    }

    current = Object.getPrototypeOf(current);
  }

  return undefined;
}

function isNativeAddEventListener(value: unknown): value is EventTarget["addEventListener"] {
  return typeof value === "function";
}

function isNativeRemoveEventListener(value: unknown): value is EventTarget["removeEventListener"] {
  return typeof value === "function";
}

function findNativeEventTargetMethod(
  value: object,
  key: "addEventListener",
  fallback: EventTarget["addEventListener"],
): EventTarget["addEventListener"];
function findNativeEventTargetMethod(
  value: object,
  key: "removeEventListener",
  fallback: EventTarget["removeEventListener"],
): EventTarget["removeEventListener"];
function findNativeEventTargetMethod(
  value: object,
  key: "addEventListener" | "removeEventListener",
  fallback: EventTarget["addEventListener"] | EventTarget["removeEventListener"],
): EventTarget["addEventListener"] | EventTarget["removeEventListener"] {
  let current: object | null = value;

  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);

    if (descriptor) {
      const method: unknown = Reflect.get(descriptor, "value");

      if (key === "addEventListener" && isNativeAddEventListener(method)) {
        return method;
      }

      if (key === "removeEventListener" && isNativeRemoveEventListener(method)) {
        return method;
      }

      return fallback;
    }

    current = Object.getPrototypeOf(current);
  }

  return fallback;
}

function getDescriptorAccessor(
  descriptor: PropertyDescriptor | undefined,
  kind: "get" | "set",
): PropertyAccessor | undefined {
  const accessor: unknown = descriptor ? Reflect.get(descriptor, kind) : undefined;

  if (!isPropertyAccessor(accessor)) {
    return undefined;
  }

  return accessor;
}

function isMessageListener(value: unknown): value is MessageListener {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function isOnMessageListener(
  value: unknown,
): value is (this: WebSocket, event: MessageEvent) => unknown {
  return typeof value === "function";
}

function invokeMessageListener(
  listener: MessageListener,
  receiver: EventTarget,
  event: Event,
): unknown {
  if (typeof listener === "function") {
    return Reflect.apply(listener, receiver, [event]);
  }

  const handleEvent: unknown = Reflect.get(listener, "handleEvent");

  if (typeof handleEvent !== "function") {
    throw new TypeError("Event listener object does not provide handleEvent().");
  }

  return Reflect.apply(handleEvent, listener, [event]);
}

function recordHandlerEvidence(
  state: WebSocketInstrumentationState,
  event: Event,
  invoke: () => unknown,
): unknown {
  const activeContext = state.eventContexts.get(event);

  if (!activeContext || !state.installation.active) {
    return invoke();
  }

  let startedNodeId: string;

  try {
    if (!state.context.engine.causality.getTrace(activeContext.messageId)) {
      return invoke();
    }

    const started = state.context.engine.causality.recordNode({
      kind: "handler.started",
      source: { adapter: "websocket", instanceId: state.connectionId },
    });
    state.context.engine.causality.recordEdge({
      fromNodeId: activeContext.activeNodeId,
      toNodeId: started.id,
      confidence: "definitive",
      correlationMethod: "same-native-event",
      reason: "listener received the same native MessageEvent",
    });
    startedNodeId = started.id;
  } catch {
    return invoke();
  }

  let invoked = false;

  try {
    return state.context.engine.causality.runWithContext(
      { messageId: activeContext.messageId, activeNodeId: startedNodeId },
      () => {
        invoked = true;

        try {
          return invoke();
        } finally {
          try {
            const trace = state.context.engine.causality.getTrace(activeContext.messageId);

            if (trace?.nodes.some((node) => node.id === startedNodeId)) {
              const returned = state.context.engine.causality.recordNode({
                kind: "handler.returned",
                source: { adapter: "websocket", instanceId: state.connectionId },
              });
              state.context.engine.causality.recordEdge({
                fromNodeId: startedNodeId,
                toNodeId: returned.id,
                confidence: "definitive",
                correlationMethod: "same-call-stack",
                reason: "listener returned on the same synchronous call stack",
              });
            }
          } catch {
            // Evidence recording must not replace application return values or exceptions.
          }
        }
      },
    );
  } catch (error) {
    if (!invoked) {
      return invoke();
    }

    throw error;
  }
}

function getListenerWrapper(
  state: WebSocketInstrumentationState,
  listener: MessageListener,
): EventListener {
  const existing = state.listenerWrappers.get(listener);

  if (existing) {
    return existing;
  }

  const wrapper: EventListener = function (this: EventTarget, event) {
    recordHandlerEvidence(state, event, () => invokeMessageListener(listener, this, event));
  };
  state.listenerWrappers.set(listener, wrapper);
  return wrapper;
}

function applyNativeAdd(
  state: WebSocketInstrumentationState,
  receiver: EventTarget,
  type: string,
  listener: EventListenerOrEventListenerObject | null,
  options?: boolean | AddEventListenerOptions,
): void {
  Reflect.apply(state.nativeAddEventListener, receiver, [type, listener, options]);
}

function applyNativeRemove(
  state: WebSocketInstrumentationState,
  receiver: EventTarget,
  type: string,
  listener: EventListenerOrEventListenerObject | null,
  options?: boolean | EventListenerOptions,
): void {
  Reflect.apply(state.nativeRemoveEventListener, receiver, [type, listener, options]);
}

function installMessageListenerBoundary(
  socket: WebSocket,
  state: WebSocketInstrumentationState,
): boolean {
  const fallbackState = state;
  const addDescriptor = Object.getOwnPropertyDescriptor(socket, "addEventListener");
  const removeDescriptor = Object.getOwnPropertyDescriptor(socket, "removeEventListener");

  if (addDescriptor?.configurable === false || removeDescriptor?.configurable === false) {
    return false;
  }

  const addEventListener = function (
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    const receiverState = instrumentedSockets.get(this);

    if (!receiverState) {
      applyNativeAdd(fallbackState, this, type, listener, options);
      return;
    }

    const registeredListener =
      type === "message" && isMessageListener(listener)
        ? getListenerWrapper(receiverState, listener)
        : listener;
    applyNativeAdd(receiverState, this, type, registeredListener, options);
  };

  const removeEventListener = function (
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    const receiverState = instrumentedSockets.get(this);

    if (!receiverState) {
      applyNativeRemove(fallbackState, this, type, listener, options);
      return;
    }

    const registeredListener =
      type === "message" && isMessageListener(listener)
        ? (receiverState.listenerWrappers.get(listener) ?? listener)
        : listener;
    applyNativeRemove(receiverState, this, type, registeredListener, options);
  };

  try {
    Object.defineProperty(socket, "addEventListener", {
      configurable: true,
      enumerable: addDescriptor?.enumerable ?? true,
      value: addEventListener,
      writable: true,
    });
    Object.defineProperty(socket, "removeEventListener", {
      configurable: true,
      enumerable: removeDescriptor?.enumerable ?? true,
      value: removeEventListener,
      writable: true,
    });
    return true;
  } catch {
    if (addDescriptor) {
      Object.defineProperty(socket, "addEventListener", addDescriptor);
    } else {
      Reflect.deleteProperty(socket, "addEventListener");
    }

    if (removeDescriptor) {
      Object.defineProperty(socket, "removeEventListener", removeDescriptor);
    } else {
      Reflect.deleteProperty(socket, "removeEventListener");
    }

    return false;
  }
}

function callOnMessageGetter(state: WebSocketInstrumentationState, receiver: WebSocket): unknown {
  const getter = getDescriptorAccessor(state.nativeOnMessageDescriptor, "get");
  return getter ? Reflect.apply(getter, receiver, []) : undefined;
}

function callOnMessageSetter(
  state: WebSocketInstrumentationState,
  receiver: WebSocket,
  value: unknown,
): void {
  const setter = getDescriptorAccessor(state.nativeOnMessageDescriptor, "set");

  if (setter) {
    Reflect.apply(setter, receiver, [value]);
  }
}

function installOnMessageBoundary(socket: WebSocket, state: WebSocketInstrumentationState): void {
  const descriptor = state.nativeOnMessageDescriptor;

  if (
    !descriptor ||
    !getDescriptorAccessor(descriptor, "get") ||
    !getDescriptorAccessor(descriptor, "set")
  ) {
    return;
  }

  const wrapper = function (this: WebSocket, event: MessageEvent): void {
    const receiverState = instrumentedSockets.get(this) ?? state;
    const listener = receiverState.onMessageOriginal;

    if (listener) {
      recordHandlerEvidence(receiverState, event, () => Reflect.apply(listener, this, [event]));
    }
  };

  Object.defineProperty(socket, "onmessage", {
    configurable: true,
    enumerable: descriptor.enumerable ?? true,
    get(this: WebSocket): unknown {
      const receiverState = instrumentedSockets.get(this);

      if (!receiverState) {
        return callOnMessageGetter(state, this);
      }

      return receiverState.onMessageWrapped
        ? receiverState.onMessageOriginal
        : callOnMessageGetter(receiverState, this);
    },
    set(this: WebSocket, value: unknown) {
      const receiverState = instrumentedSockets.get(this);

      if (!receiverState) {
        callOnMessageSetter(state, this, value);
        return;
      }

      if (isOnMessageListener(value)) {
        callOnMessageSetter(receiverState, this, wrapper);
        receiverState.onMessageOriginal = value;
        receiverState.onMessageWrapped = true;
      } else {
        callOnMessageSetter(receiverState, this, value);
        receiverState.onMessageOriginal = undefined;
        receiverState.onMessageWrapped = false;
      }
    },
  });
}

export function installWebSocketInterceptor(
  context: BrowseSentEventInterceptorContext,
): InstalledBrowseSentEventInterceptor | undefined {
  const OriginalWebSocket = context.target.WebSocket;

  if (!OriginalWebSocket) {
    return undefined;
  }

  const eventTargetPrototype = context.target.EventTarget.prototype;
  const intrinsicAddValue: unknown = Reflect.get(eventTargetPrototype, "addEventListener");
  const intrinsicRemoveValue: unknown = Reflect.get(eventTargetPrototype, "removeEventListener");

  if (
    !isNativeAddEventListener(intrinsicAddValue) ||
    !isNativeRemoveEventListener(intrinsicRemoveValue)
  ) {
    return undefined;
  }

  const installation: WebSocketInstallation = { active: true };
  const ProxiedWebSocket = new Proxy(OriginalWebSocket, {
    construct(target, args, newTarget) {
      const socket: unknown = Reflect.construct(target, args, newTarget);

      if (!isInstrumentableWebSocket(socket)) {
        throw new TypeError("Expected WebSocket instance.");
      }

      if (!installation.active) {
        return socket;
      }

      if (!(socket instanceof context.target.EventTarget)) {
        return socket;
      }

      if (instrumentedSockets.has(socket)) {
        return socket;
      }

      const url = socket.url;

      if (isUrlExcluded(context, url)) {
        return socket;
      }

      const nativeAddEventListener = findNativeEventTargetMethod(
        socket,
        "addEventListener",
        intrinsicAddValue,
      );
      const nativeRemoveEventListener = findNativeEventTargetMethod(
        socket,
        "removeEventListener",
        intrinsicRemoveValue,
      );
      let state: WebSocketInstrumentationState | undefined;

      const openObserver: EventListener = () => {
        if (!state?.installation.active) return;

        try {
          state.context.engine.updateConnection(state.connectionId, { state: "open" });
        } catch {
          // Lifecycle observation is best-effort.
        }
      };
      const closeObserver: EventListener = (event) => {
        if (!state?.installation.active) return;

        if (!(event instanceof context.target.CloseEvent)) {
          return;
        }

        try {
          state.context.engine.updateConnection(state.connectionId, {
            state: "closed",
            closedAt: globalThis.performance?.now() ?? Date.now(),
            closeCode: event.code,
          });
        } catch {
          // Lifecycle observation is best-effort.
        }
      };
      const messageObserver: EventListener = (event) => {
        if (!state?.installation.active || !(event instanceof context.target.MessageEvent)) {
          return;
        }

        try {
          const message = state.context.engine.recordMessage({
            connectionId: state.connectionId,
            direction: "in",
            protocol: "websocket",
            payload: toPayload(event.data),
            metadata: { url },
          });
          const root = state.context.engine.causality.recordNode({
            kind: "transport.received",
            messageId: message.id,
            source: { adapter: "websocket", instanceId: state.connectionId },
            attributes: { direction: "in" },
          });
          state.eventContexts.set(event, {
            messageId: message.id,
            activeNodeId: root.id,
          });
        } catch {
          // Transport capture remains useful even when causality evidence cannot be recorded.
        }
      };
      const installedObservers: Array<{
        readonly listener: EventListener;
        readonly options?: boolean | AddEventListenerOptions;
        readonly type: string;
      }> = [];

      const rollbackObservers = (): void => {
        for (const observer of installedObservers.toReversed()) {
          try {
            Reflect.apply(intrinsicRemoveValue, socket, [
              observer.type,
              observer.listener,
              observer.options,
            ]);
          } catch {
            // Rollback is best-effort and must never break WebSocket construction.
          }
        }
        installedObservers.length = 0;
      };

      try {
        for (const observer of [
          { listener: openObserver, type: "open" },
          { listener: closeObserver, type: "close" },
          { listener: messageObserver, options: { capture: true }, type: "message" },
        ]) {
          Reflect.apply(intrinsicAddValue, socket, [
            observer.type,
            observer.listener,
            observer.options,
          ]);
          installedObservers.push(observer);
        }
      } catch {
        rollbackObservers();
        return socket;
      }

      let connection;

      try {
        connection = context.engine.recordConnection({
          protocol: "websocket",
          url,
          state: "connecting",
        });
      } catch {
        rollbackObservers();
        return socket;
      }

      state = {
        connectionId: connection.id,
        context,
        eventContexts: new WeakMap(),
        installation,
        listenerWrappers: new WeakMap(),
        nativeAddEventListener,
        nativeOnMessageDescriptor: findPropertyDescriptor(socket, "onmessage"),
        nativeRemoveEventListener,
        onMessageWrapped: false,
      };
      instrumentedSockets.set(socket, state);

      try {
        installMessageListenerBoundary(socket, state);
      } catch {
        // A non-extensible or exotic socket still keeps native EventTarget behavior.
      }

      try {
        installOnMessageBoundary(socket, state);
      } catch {
        // A non-configurable event handler property remains native-only.
      }

      try {
        const originalSend = socket.send.bind(socket);

        Reflect.set(socket, "send", (data: Parameters<WebSocket["send"]>[0]) => {
          if (installation.active) {
            try {
              context.engine.recordMessage({
                connectionId: connection.id,
                direction: "out",
                protocol: "websocket",
                payload: toPayload(data),
                metadata: { url },
              });
            } catch {
              // Outbound observation is best-effort.
            }
          }

          originalSend(data);
        });
      } catch {
        // A non-writable or exotic send method remains native-only.
      }

      return socket;
    },
  });

  const patch = installGlobalPatch(context.target, "WebSocket", () => ProxiedWebSocket);

  return {
    name: "websocket",
    uninstall() {
      installation.active = false;
      patch.uninstall();
    },
  };
}
