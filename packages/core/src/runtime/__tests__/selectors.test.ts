import { describe, expect, it } from "vitest";
import type { BrowseSentEventConnection, BrowseSentEventMessage } from "../events.js";
import { calculateMetrics, filterMessages, searchMessages } from "../selectors.js";

const connections: BrowseSentEventConnection[] = [
  {
    id: "conn-1",
    protocol: "fetch-stream",
    url: "https://example.test/stream",
    state: "open",
    openedAt: 1,
    reconnectCount: 0,
    metadata: {},
  },
  {
    id: "conn-2",
    protocol: "websocket",
    url: "wss://example.test/socket",
    state: "closed",
    openedAt: 2,
    reconnectCount: 0,
    metadata: {},
  },
];

const messages: BrowseSentEventMessage[] = [
  {
    id: "msg-1",
    connectionId: "conn-1",
    timestamp: 10,
    direction: "in",
    protocol: "fetch-stream",
    size: 11,
    payload: "First Token",
    payloadPreview: "First Token",
    metadata: {},
  },
  {
    id: "msg-2",
    connectionId: "conn-1",
    timestamp: 20,
    direction: "out",
    protocol: "fetch-stream",
    size: 12,
    payload: "Client Chunk",
    payloadPreview: "Client Chunk",
    metadata: {},
  },
  {
    id: "msg-3",
    connectionId: "conn-2",
    timestamp: 30,
    direction: "in",
    protocol: "websocket",
    size: 13,
    payload: "Socket Token",
    payloadPreview: "Socket Token",
    metadata: {},
  },
];

describe("runtime selectors", () => {
  it("filters messages by connection, protocol, direction, url, and timestamp range", () => {
    expect(
      filterMessages(messages, connections, {
        direction: "in",
        fromTimestamp: 5,
        protocol: "fetch-stream",
        toTimestamp: 15,
        urlIncludes: "/stream",
      }),
    ).toEqual([messages[0]]);
  });

  it("searches text after applying the structured message filter", () => {
    expect(searchMessages(messages, connections, { protocol: "websocket", text: "token" })).toEqual(
      [messages[2]],
    );
  });

  it("calculates aggregate and connection-scoped metrics", () => {
    expect(calculateMetrics(messages, connections, 4)).toEqual({
      activeConnectionCount: 1,
      connectionCount: 2,
      droppedMessageCount: 4,
      incomingCount: 2,
      messageCount: 3,
      outgoingCount: 1,
      totalBytes: 36,
    });
    expect(calculateMetrics(messages, connections, 4, "conn-1")).toEqual({
      activeConnectionCount: 1,
      connectionCount: 1,
      droppedMessageCount: 4,
      incomingCount: 1,
      messageCount: 2,
      outgoingCount: 1,
      totalBytes: 23,
    });
  });
});
