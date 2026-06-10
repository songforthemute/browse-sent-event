import type {
  BrowseSentEventConnection,
  BrowseSentEventMessage,
  BrowseSentEventMessageFilter,
  BrowseSentEventMetrics,
  BrowseSentEventSearchQuery,
} from "./events.js";

function getConnectionById(
  connections: readonly BrowseSentEventConnection[],
): Map<string, BrowseSentEventConnection> {
  return new Map(connections.map((connection) => [connection.id, connection]));
}

function matchesFilter(
  message: BrowseSentEventMessage,
  connectionsById: ReadonlyMap<string, BrowseSentEventConnection>,
  filter: BrowseSentEventMessageFilter,
): boolean {
  const connection = connectionsById.get(message.connectionId);

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

export function filterMessages(
  messages: readonly BrowseSentEventMessage[],
  connections: readonly BrowseSentEventConnection[],
  filter: BrowseSentEventMessageFilter = {},
): BrowseSentEventMessage[] {
  const connectionsById = getConnectionById(connections);

  return messages.filter((message) => matchesFilter(message, connectionsById, filter));
}

export function searchMessages(
  messages: readonly BrowseSentEventMessage[],
  connections: readonly BrowseSentEventConnection[],
  query: BrowseSentEventSearchQuery,
): BrowseSentEventMessage[] {
  const normalizedText = query.text?.toLowerCase();

  return filterMessages(messages, connections, query).filter((message) => {
    if (!normalizedText) {
      return true;
    }

    const payloadText =
      typeof message.payload === "string" ? message.payload : message.payloadPreview;

    return payloadText.toLowerCase().includes(normalizedText);
  });
}

export function calculateMetrics(
  messages: readonly BrowseSentEventMessage[],
  connections: readonly BrowseSentEventConnection[],
  droppedMessageCount: number,
  connectionId?: string,
): BrowseSentEventMetrics {
  const selectedMessages = connectionId
    ? filterMessages(messages, connections, { connectionId })
    : [...messages];
  const selectedConnections = connectionId
    ? connections.filter((connection) => connection.id === connectionId)
    : [...connections];

  return {
    activeConnectionCount: selectedConnections.filter((connection) => connection.state !== "closed")
      .length,
    connectionCount: selectedConnections.length,
    droppedMessageCount,
    incomingCount: selectedMessages.filter((message) => message.direction === "in").length,
    messageCount: selectedMessages.length,
    outgoingCount: selectedMessages.filter((message) => message.direction === "out").length,
    totalBytes: selectedMessages.reduce((total, message) => total + message.size, 0),
  };
}
