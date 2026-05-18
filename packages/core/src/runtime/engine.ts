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
import { createPayloadSummary, serializePayloadForExport } from "./payload.js";
import { RingBuffer } from "./ring-buffer.js";

export interface BrowseSentEventEngineOptions {
  readonly capacity: number;
}

export interface BrowseSentEventEngineSnapshot {
  readonly connections: readonly BrowseSentEventConnection[];
  readonly messages: readonly BrowseSentEventMessage[];
  readonly metrics: BrowseSentEventMetrics;
}

export type BrowseSentEventEngineSubscriber = (
  snapshot: BrowseSentEventEngineSnapshot,
) => void;

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
  recordConnection(input: BrowseSentEventConnectionInput): BrowseSentEventConnection;
  updateConnection(
    id: string,
    patch: BrowseSentEventConnectionPatch,
  ): BrowseSentEventConnection | undefined;
  recordMessage(input: BrowseSentEventMessageInput): BrowseSentEventMessage;
  getSnapshot(): BrowseSentEventEngineSnapshot;
  subscribe(subscriber: BrowseSentEventEngineSubscriber): BrowseSentEventUnsubscribe;
  getConnections(): BrowseSentEventConnection[];
  getMessages(filter?: BrowseSentEventMessageFilter): BrowseSentEventMessage[];
  getMetrics(connectionId?: string): BrowseSentEventMetrics;
  search(query: BrowseSentEventSearchQuery): BrowseSentEventMessage[];
  exportJsonl(filter?: BrowseSentEventMessageFilter): string;
  exportLog(filter?: BrowseSentEventMessageFilter): string;
  clear(): void;
}

let sequence = 0;

function now(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function createId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

function formatDirection(direction: "in" | "out"): string {
  return direction === "in" ? "IN" : "OUT";
}

export function createDevtoolsEngine(options: BrowseSentEventEngineOptions): BrowseSentEventEngine {
  const messages = new RingBuffer<BrowseSentEventMessage>(options.capacity);
  const connections = new Map<string, BrowseSentEventConnection>();
  const subscribers = new Set<BrowseSentEventEngineSubscriber>();

  function getConnectionForMessage(
    message: BrowseSentEventMessage,
  ): BrowseSentEventConnection | undefined {
    return connections.get(message.connectionId);
  }

  function matchesFilter(
    message: BrowseSentEventMessage,
    filter: BrowseSentEventMessageFilter = {},
  ): boolean {
    const connection = getConnectionForMessage(message);

    if (filter.connectionId && message.connectionId !== filter.connectionId) {
      return false;
    }

    if (filter.protocol && message.protocol !== filter.protocol) {
      return false;
    }

    if (filter.direction && message.direction !== filter.direction) {
      return false;
    }

    if (filter.urlIncludes && !connection?.url.includes(filter.urlIncludes)) {
      return false;
    }

    if (filter.fromTimestamp !== undefined && message.timestamp < filter.fromTimestamp) {
      return false;
    }

    if (filter.toTimestamp !== undefined && message.timestamp > filter.toTimestamp) {
      return false;
    }

    return true;
  }

  function getConnections(): BrowseSentEventConnection[] {
    return [...connections.values()];
  }

  function getMessages(filter?: BrowseSentEventMessageFilter): BrowseSentEventMessage[] {
    return messages.toArray().filter((message) => matchesFilter(message, filter));
  }

  function getSnapshot(): BrowseSentEventEngineSnapshot {
    return {
      connections: getConnections(),
      messages: getMessages(),
      metrics: getMetrics(),
    };
  }

  function notify(): void {
    const snapshot = getSnapshot();

    for (const subscriber of subscribers) {
      subscriber(snapshot);
    }
  }

  function subscribe(subscriber: BrowseSentEventEngineSubscriber): BrowseSentEventUnsubscribe {
    subscribers.add(subscriber);

    return () => {
      subscribers.delete(subscriber);
    };
  }

  function recordConnection(input: BrowseSentEventConnectionInput): BrowseSentEventConnection {
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

    messages.push(message);
    notify();

    return message;
  }

  function getMetrics(connectionId?: string): BrowseSentEventMetrics {
    const selectedMessages = getMessages(connectionId ? { connectionId } : undefined);
    const selectedConnections = connectionId
      ? getConnections().filter((connection) => connection.id === connectionId)
      : getConnections();

    return {
      activeConnectionCount: selectedConnections.filter(
        (connection) => connection.state !== "closed",
      ).length,
      connectionCount: selectedConnections.length,
      messageCount: selectedMessages.length,
      incomingCount: selectedMessages.filter((message) => message.direction === "in").length,
      outgoingCount: selectedMessages.filter((message) => message.direction === "out").length,
      droppedMessageCount: messages.droppedCount,
      totalBytes: selectedMessages.reduce((total, message) => total + message.size, 0),
    };
  }

  function search(query: BrowseSentEventSearchQuery): BrowseSentEventMessage[] {
    const normalizedText = query.text?.toLowerCase();

    return getMessages(query).filter((message) => {
      if (!normalizedText) {
        return true;
      }

      const payloadText =
        typeof message.payload === "string" ? message.payload : message.payloadPreview;

      return payloadText.toLowerCase().includes(normalizedText);
    });
  }

  function exportJsonl(filter?: BrowseSentEventMessageFilter): string {
    return getMessages(filter)
      .map((message) =>
        JSON.stringify({
          ...message,
          payload: serializePayloadForExport(message.payload),
        }),
      )
      .join("\n");
  }

  function exportLog(filter?: BrowseSentEventMessageFilter): string {
    return getMessages(filter)
      .map((message) => {
        const timestamp = message.timestamp.toFixed(3);

        return `${timestamp} ${formatDirection(message.direction)} [${message.protocol}] ${message.type ?? "message"} - ${message.payloadPreview}`;
      })
      .join("\n");
  }

  function clear(): void {
    messages.clear();
    connections.clear();
    notify();
  }

  return {
    capacity: options.capacity,
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
}
