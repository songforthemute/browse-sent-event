import { describe, expect, expectTypeOf, it, vi } from "vitest";
import * as selectors from "../selectors.js";
import { createDevtoolsEngine, disposeDevtoolsEngine } from "../engine.js";

vi.mock("../selectors.js", { spy: true });

describe("createDevtoolsEngine", () => {
  it("records connections and messages", () => {
    const engine = createDevtoolsEngine({ capacity: 2 });
    const connection = engine.recordConnection({
      protocol: "websocket",
      url: "wss://example.test/socket",
    });

    const message = engine.recordMessage({
      connectionId: connection.id,
      direction: "in",
      protocol: "websocket",
      payload: "hello",
    });

    expect(engine.getConnections()).toEqual([
      expect.objectContaining({
        id: connection.id,
        protocol: "websocket",
        state: "connecting",
        url: "wss://example.test/socket",
      }),
    ]);
    expect(engine.getMessages()).toEqual([
      expect.objectContaining({
        id: message.id,
        connectionId: connection.id,
        payloadPreview: "hello",
        size: 5,
      }),
    ]);
  });

  it("filters, searches, and exports messages", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });
    const connection = engine.recordConnection({
      protocol: "fetch-stream",
      url: "https://example.test/stream",
    });

    engine.recordMessage({
      connectionId: connection.id,
      direction: "in",
      protocol: "fetch-stream",
      payload: "First Token",
    });
    engine.recordMessage({
      connectionId: connection.id,
      direction: "in",
      protocol: "fetch-stream",
      payload: "Ignored Chunk",
    });

    expect(engine.search({ text: "token" })).toHaveLength(1);
    expect(engine.exportJsonl()).toContain('"payload":"First Token"');
    expect(engine.exportLog()).toContain("IN [fetch-stream]");
    expect(engine.exportJsonl({ text: "token" })).toContain('"payload":"First Token"');
    expect(engine.exportJsonl({ text: "token" })).not.toContain('"payload":"Ignored Chunk"');
    expect(engine.exportLog({ text: "token" })).toContain("First Token");
    expect(engine.exportLog({ text: "token" })).not.toContain("Ignored Chunk");
  });

  it("reports metrics and dropped messages", () => {
    const engine = createDevtoolsEngine({ capacity: 1 });
    const connection = engine.recordConnection({
      protocol: "websocket",
      url: "wss://example.test/socket",
    });

    engine.recordMessage({
      connectionId: connection.id,
      direction: "in",
      protocol: "websocket",
      payload: "one",
    });
    engine.recordMessage({
      connectionId: connection.id,
      direction: "out",
      protocol: "websocket",
      payload: "two",
    });

    expect(engine.getMessages()).toHaveLength(1);
    expect(engine.getMetrics()).toEqual(
      expect.objectContaining({
        droppedMessageCount: 1,
        incomingCount: 0,
        messageCount: 1,
        outgoingCount: 1,
      }),
    );
  });

  it("notifies subscribers when the snapshot changes", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });
    const snapshots: unknown[] = [];
    const unsubscribe = engine.subscribe((snapshot) => {
      snapshots.push(snapshot);
    });

    const connection = engine.recordConnection({
      protocol: "websocket",
      url: "wss://example.test/socket",
    });
    engine.recordMessage({
      connectionId: connection.id,
      direction: "in",
      protocol: "websocket",
      payload: "hello",
    });

    unsubscribe();
    engine.clear();

    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]).toEqual(
      expect.objectContaining({
        connections: [expect.objectContaining({ id: connection.id })],
        messages: [expect.objectContaining({ payloadPreview: "hello" })],
      }),
    );
  });

  it("skips snapshot calculation until a subscriber exists", () => {
    const calculateMetrics = vi.mocked(selectors.calculateMetrics);
    calculateMetrics.mockClear();
    const engine = createDevtoolsEngine({ capacity: 10 });

    const connection = engine.recordConnection({
      protocol: "websocket",
      url: "wss://example.test/socket",
    });

    expect(calculateMetrics).not.toHaveBeenCalled();

    const snapshots: unknown[] = [];
    engine.subscribe((snapshot) => {
      snapshots.push(snapshot);
    });
    engine.recordMessage({
      connectionId: connection.id,
      direction: "in",
      protocol: "websocket",
      payload: "hello",
    });

    expect(calculateMetrics).toHaveBeenCalledOnce();
    expect(snapshots).toHaveLength(1);
  });

  it("evicts causality evidence with retained messages and clears it with the engine", () => {
    const engine = createDevtoolsEngine({ capacity: 1 });
    const connection = engine.recordConnection({
      protocol: "websocket",
      url: "wss://example.test/socket",
    });
    const firstMessage = engine.recordMessage({
      connectionId: connection.id,
      direction: "in",
      protocol: "websocket",
      payload: "first",
    });
    engine.causality.recordNode({
      kind: "transport.received",
      messageId: firstMessage.id,
      source: { adapter: "websocket" },
    });

    engine.recordMessage({
      connectionId: connection.id,
      direction: "in",
      protocol: "websocket",
      payload: "second",
    });
    expect(engine.causality.getTrace(firstMessage.id)).toBeUndefined();

    const retainedMessage = engine.getMessages()[0];

    if (!retainedMessage) {
      throw new Error("Expected one retained message.");
    }

    engine.causality.recordNode({
      kind: "transport.received",
      messageId: retainedMessage.id,
      source: { adapter: "websocket" },
    });
    engine.clear();
    expect(engine.causality.getTrace(retainedMessage.id)).toBeUndefined();
  });

  it("disposes evidence subscriptions with the engine", () => {
    const engine = createDevtoolsEngine({ capacity: 1 });
    const deltas: unknown[] = [];
    const connection = engine.recordConnection({
      protocol: "websocket",
      url: "wss://example.test/socket",
    });
    engine.causality.subscribeEvidence((delta) => deltas.push(delta));
    expectTypeOf(engine).not.toHaveProperty("dispose");
    expect("dispose" in engine).toBe(false);
    expect("dispose" in engine.causality).toBe(false);
    expect("retainMessage" in engine.causality).toBe(false);
    disposeDevtoolsEngine(engine);

    expect(deltas).toEqual([{ type: "disposed" }]);
    expect(() => disposeDevtoolsEngine(engine)).not.toThrow();
    expect(() => engine.subscribe(() => undefined)).toThrow("BrowseSentEvent engine is disposed.");
    expect(() =>
      engine.recordConnection({ protocol: "websocket", url: "wss://next.example.test" }),
    ).toThrow("BrowseSentEvent engine is disposed.");
    expect(() => engine.updateConnection(connection.id, { state: "closed" })).toThrow(
      "BrowseSentEvent engine is disposed.",
    );
    expect(() =>
      engine.recordMessage({
        connectionId: connection.id,
        direction: "in",
        protocol: "websocket",
        payload: "after dispose",
      }),
    ).toThrow("BrowseSentEvent engine is disposed.");
    expect(() => engine.clear()).toThrow("BrowseSentEvent engine is disposed.");
    expect(engine.getConnections()).toEqual([]);
    expect(engine.getMessages()).toEqual([]);
    expect(() =>
      engine.causality.recordNode({
        kind: "transport.received",
        messageId: "message-1",
        source: { adapter: "websocket" },
      }),
    ).toThrow("Causality trace store is disposed.");
  });
});
