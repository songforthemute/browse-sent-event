import type {
  BrowseSentEventConnection,
  BrowseSentEventConnectionState,
  BrowseSentEventMessage,
  BrowseSentEventMessageFilter,
  BrowseSentEventMetrics,
  BrowseSentEventPayload,
  BrowseSentEventProtocol,
  BrowseSentEventSearchQuery,
} from "./events.js";
import {
  createBrowseSentEventCausalityBridge,
  createCausalityBridgeView,
  type BrowseSentEventCausalityBridge,
} from "../causality/bridge.js";
import {
  notifyObserver,
  type SynchronousObserver,
  type SynchronousObserverInput,
} from "../observer.js";
import { exportMessagesAsJsonl, exportMessagesAsLog } from "./export.js";
import { createPayloadSummary } from "./payload.js";
import { RingBuffer } from "./ring-buffer.js";
import { calculateMetrics, filterMessages, searchMessages } from "./selectors.js";

export interface BrowseSentEventEngineOptions {
  readonly capacity: number;
}

export interface BrowseSentEventEngineSnapshot {
  readonly connections: readonly BrowseSentEventConnection[];
  readonly messages: readonly BrowseSentEventMessage[];
  readonly metrics: BrowseSentEventMetrics;
}

export type BrowseSentEventEngineSubscriber = SynchronousObserver<BrowseSentEventEngineSnapshot>;

export type BrowseSentEventUnsubscribe = () => void;

export interface BrowseSentEventConnectionInput {
  readonly protocol: BrowseSentEventProtocol;
  readonly url: string;
  readonly state?: BrowseSentEventConnectionState;
  readonly openedAt?: number;
  readonly metadata?: Record<string, unknown>;
}

export interface BrowseSentEventConnectionPatch {
  readonly state?: BrowseSentEventConnectionState;
  readonly closedAt?: number;
  readonly closeCode?: number;
  readonly metadata?: Record<string, unknown>;
}

export interface BrowseSentEventMessageInput {
  readonly connectionId: string;
  readonly direction: "in" | "out";
  readonly protocol: BrowseSentEventProtocol;
  readonly payload: BrowseSentEventPayload;
  readonly type?: string;
  readonly timestamp?: number;
  readonly metadata?: Record<string, unknown>;
}

export interface BrowseSentEventEngine {
  readonly capacity: number;
  readonly causality: BrowseSentEventCausalityBridge;
  recordConnection(input: BrowseSentEventConnectionInput): BrowseSentEventConnection;
  updateConnection(
    id: string,
    patch: BrowseSentEventConnectionPatch,
  ): BrowseSentEventConnection | undefined;
  recordMessage(input: BrowseSentEventMessageInput): BrowseSentEventMessage;
  getSnapshot(): BrowseSentEventEngineSnapshot;
  subscribe<Subscriber extends BrowseSentEventEngineSubscriber>(
    subscriber: SynchronousObserverInput<BrowseSentEventEngineSnapshot, Subscriber>,
  ): BrowseSentEventUnsubscribe;
  getConnections(): BrowseSentEventConnection[];
  getMessages(filter?: BrowseSentEventMessageFilter): BrowseSentEventMessage[];
  getMetrics(connectionId?: string): BrowseSentEventMetrics;
  search(query: BrowseSentEventSearchQuery): BrowseSentEventMessage[];
  exportJsonl(query?: BrowseSentEventSearchQuery): string;
  exportLog(query?: BrowseSentEventSearchQuery): string;
  clear(): void;
}

let sequence = 0;
const engineDisposers = new WeakMap<BrowseSentEventEngine, () => void>();

function now(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function createId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

export function createDevtoolsEngine(options: BrowseSentEventEngineOptions): BrowseSentEventEngine {
  const messages = new RingBuffer<BrowseSentEventMessage>(options.capacity);
  const connections = new Map<string, BrowseSentEventConnection>();
  const subscribers = new Set<BrowseSentEventEngineSubscriber>();
  const causalityController = createBrowseSentEventCausalityBridge({
    compactAfterEvictions: options.capacity,
  });
  const causality: BrowseSentEventCausalityBridge = createCausalityBridgeView(causalityController);
  let disposed = false;

  function assertActive(): void {
    if (disposed) {
      throw new Error("BrowseSentEvent engine is disposed.");
    }
  }

  function getConnections(): BrowseSentEventConnection[] {
    return [...connections.values()];
  }

  function getMessages(filter?: BrowseSentEventMessageFilter): BrowseSentEventMessage[] {
    return filterMessages(messages.toArray(), getConnections(), filter);
  }

  function getSnapshot(): BrowseSentEventEngineSnapshot {
    return {
      connections: getConnections(),
      messages: getMessages(),
      metrics: getMetrics(),
    };
  }

  function notify(): void {
    if (subscribers.size === 0) {
      return;
    }

    const snapshot = getSnapshot();

    for (const subscriber of subscribers) {
      notifyObserver(subscriber, snapshot);
    }
  }

  function subscribe<Subscriber extends BrowseSentEventEngineSubscriber>(
    subscriber: SynchronousObserverInput<BrowseSentEventEngineSnapshot, Subscriber>,
  ): BrowseSentEventUnsubscribe {
    assertActive();
    subscribers.add(subscriber);

    return () => {
      subscribers.delete(subscriber);
    };
  }

  function recordConnection(input: BrowseSentEventConnectionInput): BrowseSentEventConnection {
    assertActive();
    const previousReconnects = [...connections.values()].filter(
      (connection) =>
        connection.protocol === input.protocol &&
        connection.url === input.url &&
        connection.state === "closed",
    ).length;
    const connection: BrowseSentEventConnection = {
      id: createId("conn"),
      protocol: input.protocol,
      url: input.url,
      state: input.state ?? "connecting",
      openedAt: input.openedAt ?? now(),
      reconnectCount: previousReconnects,
      metadata: input.metadata ?? {},
    };

    connections.set(connection.id, connection);
    notify();

    return connection;
  }

  function updateConnection(
    id: string,
    patch: BrowseSentEventConnectionPatch,
  ): BrowseSentEventConnection | undefined {
    assertActive();
    const current = connections.get(id);

    if (!current) {
      return undefined;
    }

    const next: BrowseSentEventConnection = {
      ...current,
      ...patch,
      metadata: {
        ...current.metadata,
        ...patch.metadata,
      },
    };

    connections.set(id, next);
    notify();

    return next;
  }

  function recordMessage(input: BrowseSentEventMessageInput): BrowseSentEventMessage {
    assertActive();
    const summary = createPayloadSummary(input.payload);
    const message: BrowseSentEventMessage = {
      id: createId("msg"),
      connectionId: input.connectionId,
      timestamp: input.timestamp ?? now(),
      direction: input.direction,
      protocol: input.protocol,
      type: input.type,
      size: summary.size,
      payload: summary.payload,
      payloadPreview: summary.payloadPreview,
      metadata: input.metadata ?? {},
    };

    causalityController.retainMessage(message.id);
    const evictedMessage = messages.push(message);

    if (evictedMessage) {
      causalityController.evictMessage(evictedMessage.id);
    }

    notify();

    return message;
  }

  function getMetrics(connectionId?: string): BrowseSentEventMetrics {
    return calculateMetrics(
      messages.toArray(),
      getConnections(),
      messages.droppedCount,
      connectionId,
    );
  }

  function search(query: BrowseSentEventSearchQuery): BrowseSentEventMessage[] {
    return searchMessages(messages.toArray(), getConnections(), query);
  }

  function getExportMessages(query?: BrowseSentEventSearchQuery): BrowseSentEventMessage[] {
    return query ? search(query) : getMessages();
  }

  function exportJsonl(query?: BrowseSentEventSearchQuery): string {
    return exportMessagesAsJsonl(getExportMessages(query));
  }

  function exportLog(query?: BrowseSentEventSearchQuery): string {
    return exportMessagesAsLog(getExportMessages(query));
  }

  function clear(): void {
    assertActive();
    messages.clear();
    connections.clear();
    causalityController.clear();
    notify();
  }

  function dispose(): void {
    if (disposed) {
      return;
    }

    disposed = true;
    messages.clear();
    connections.clear();
    subscribers.clear();
    causalityController.dispose();
  }

  const engine: BrowseSentEventEngine = {
    capacity: options.capacity,
    causality,
    clear,
    exportJsonl,
    exportLog,
    getConnections,
    getSnapshot,
    getMessages,
    getMetrics,
    recordConnection,
    recordMessage,
    search,
    subscribe,
    updateConnection,
  };

  engineDisposers.set(engine, dispose);
  return engine;
}

/** @internal Runtime ownership boundary; intentionally omitted from the package entry point. */
export function disposeDevtoolsEngine(engine: BrowseSentEventEngine): void {
  engineDisposers.get(engine)?.();
}
