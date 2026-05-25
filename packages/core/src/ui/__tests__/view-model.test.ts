import { describe, expect, it } from "vitest";
import type { BrowseSentEventEngineSnapshot } from "../../runtime/engine.js";
import { getPanelViewModel } from "../view-model.js";

const snapshot: BrowseSentEventEngineSnapshot = {
  connections: [
    {
      id: "conn-1",
      protocol: "websocket",
      url: "wss://example.test/socket",
      state: "open",
      openedAt: 1_000,
      reconnectCount: 0,
      metadata: {},
    },
  ],
  messages: [
    {
      id: "msg-1",
      connectionId: "conn-1",
      timestamp: 2_000,
      direction: "in",
      protocol: "websocket",
      size: 5,
      payload: "hello",
      payloadPreview: "hello",
      metadata: {},
    },
    {
      id: "msg-2",
      connectionId: "conn-1",
      timestamp: 3_000,
      direction: "out",
      protocol: "websocket",
      size: 4,
      payload: "ping",
      payloadPreview: "ping",
      metadata: {},
    },
  ],
  metrics: {
    activeConnectionCount: 1,
    connectionCount: 1,
    droppedMessageCount: 0,
    incomingCount: 1,
    messageCount: 2,
    outgoingCount: 1,
    totalBytes: 9,
  },
};

describe("getPanelViewModel", () => {
  it("sorts messages newest first and applies filters", () => {
    const model = getPanelViewModel(snapshot, {
      direction: "out",
      query: "pin",
      selectedConnectionId: "conn-1",
    });

    expect(model.messages).toEqual([
      expect.objectContaining({
        id: "msg-2",
        directionLabel: "OUT",
        payloadPreview: "ping",
      }),
    ]);
    expect(model.connections[0]).toEqual(
      expect.objectContaining({
        id: "conn-1",
        label: "wss://example.test/socket",
      }),
    );
  });

  it("marks the selected connection", () => {
    const model = getPanelViewModel(snapshot, {
      selectedConnectionId: "conn-1",
    });

    expect(model.connections[0]).toEqual(expect.objectContaining({ selected: true }));
  });

  it("returns selected message detail", () => {
    const model = getPanelViewModel(snapshot, {
      selectedMessageId: "msg-1",
    });

    expect(model.selectedMessage).toEqual(
      expect.objectContaining({
        id: "msg-1",
        payloadPreview: "hello",
      }),
    );
  });
});
