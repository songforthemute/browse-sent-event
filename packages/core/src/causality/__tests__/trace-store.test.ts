import { describe, expect, it } from "vitest";
import { createBrowseSentEventCausalityBridge } from "../bridge.js";
import { deriveCausalityLifecycle, getWeakestCausalityConfidence } from "../lifecycle.js";
import type {
  CausalityGraphDelta,
  CausalityLinkedEvidenceGraphDelta,
  CausalityLinkedNodeInput,
  CausalityNodeInput,
} from "../model.js";
import { createCausalityTraceStore } from "../trace-store.js";
import type { CausalityTraceStore } from "../trace-store.js";

const coreSource = { adapter: "core" as const };
const websocketSource = { adapter: "websocket" as const };
const reactSource = { adapter: "react" as const };
const noop = () => {};

function transportNode(messageId: string): CausalityNodeInput {
  return {
    kind: "transport.received",
    messageId,
    source: websocketSource,
    attributes: { direction: "in" },
  };
}

function recordTransport(store: CausalityTraceStore, messageId: string) {
  store.retainMessage(messageId);
  return store.recordNode(transportNode(messageId));
}

describe("createCausalityTraceStore", () => {
  it("projects separate message traces onto one batched commit node", () => {
    let timestamp = 0;
    const store = createCausalityTraceStore({ now: () => (timestamp += 1) });
    const firstRoot = recordTransport(store, "message-1");
    const secondRoot = recordTransport(store, "message-2");
    const firstHandler = store.recordNode({
      kind: "handler.started",
      source: websocketSource,
    });
    const secondHandler = store.recordNode({
      kind: "handler.started",
      source: websocketSource,
    });
    const sharedCommit = store.recordNode({
      kind: "react.commit-observed",
      source: reactSource,
      attributes: { rendererId: 1 },
    });

    store.recordEdge({
      fromNodeId: firstRoot.id,
      toNodeId: firstHandler.id,
      confidence: "definitive",
      correlationMethod: "same-native-event",
      reason: "same MessageEvent",
    });
    store.recordEdge({
      fromNodeId: secondRoot.id,
      toNodeId: secondHandler.id,
      confidence: "definitive",
      correlationMethod: "same-native-event",
      reason: "same MessageEvent",
    });
    store.recordEdge({
      fromNodeId: firstHandler.id,
      toNodeId: sharedCommit.id,
      confidence: "adapter-backed",
      correlationMethod: "pending-react-commit",
      reason: "next adapter-observed commit",
    });
    store.recordEdge({
      fromNodeId: secondHandler.id,
      toNodeId: sharedCommit.id,
      confidence: "heuristic",
      correlationMethod: "time-window",
      reason: "fixture heuristic",
    });

    const firstTrace = store.getTrace("message-1");
    const secondTrace = store.getTrace("message-2");

    if (!firstTrace || !secondTrace) {
      throw new Error("Expected both message traces.");
    }

    expect(firstTrace.nodes.map((node) => node.id)).toEqual([
      firstRoot.id,
      firstHandler.id,
      sharedCommit.id,
    ]);
    expect(secondTrace.nodes.map((node) => node.id)).toEqual([
      secondRoot.id,
      secondHandler.id,
      sharedCommit.id,
    ]);
    expect(firstTrace.confidence).toBe("adapter-backed");
    expect(secondTrace.confidence).toBe("heuristic");
    expect(firstTrace.paths).toEqual([
      {
        nodeIds: [firstRoot.id, firstHandler.id, sharedCommit.id],
        edgeIds: firstTrace.edges.map((edge) => edge.id),
        confidence: "adapter-backed",
      },
    ]);
    expect(deriveCausalityLifecycle(firstTrace)).toEqual({
      status: "commit-candidate-observed",
      confidence: "adapter-backed",
    });
  });

  it("emits append deltas without producing a full graph snapshot", () => {
    const store = createCausalityTraceStore();
    const deltas: CausalityGraphDelta[] = [];
    const unsubscribe = store.subscribe((delta) => deltas.push(delta));
    const root = recordTransport(store, "message-1");
    const handler = store.recordNode({ kind: "handler.started", source: websocketSource });
    const edge = store.recordEdge({
      fromNodeId: root.id,
      toNodeId: handler.id,
      confidence: "definitive",
      correlationMethod: "same-native-event",
      reason: "same MessageEvent",
    });

    expect(deltas).toEqual([
      { type: "node-recorded", node: root },
      { type: "node-recorded", node: handler },
      { type: "edge-recorded", edge },
    ]);

    unsubscribe();
    store.recordNode({ kind: "adapter.diagnostic", source: coreSource });
    expect(deltas).toHaveLength(3);
  });

  it("projects linked evidence for base subscribers and preserves it atomically for extensions", () => {
    const store = createCausalityTraceStore({ maxPendingNodes: 1 });
    const baseDeltas: CausalityGraphDelta[] = [];
    const linkedDeltas: CausalityLinkedEvidenceGraphDelta[] = [];
    store.subscribe((delta) => baseDeltas.push(delta));
    store.subscribeLinkedEvidence((delta) => linkedDeltas.push(delta));
    const root = recordTransport(store, "message-1");

    const linked = store.recordLinkedNode(
      {
        node: { kind: "handler.started", source: websocketSource },
        edge: {
          confidence: "definitive",
          correlationMethod: "same-native-event",
          reason: "same MessageEvent",
        },
      },
      { messageId: "message-1", activeNodeId: root.id },
    );

    expect(baseDeltas).toEqual([
      { type: "node-recorded", node: root },
      { type: "node-recorded", node: linked.node },
      { type: "edge-recorded", edge: linked.edge },
    ]);
    expect(linkedDeltas).toEqual([
      { type: "node-recorded", node: root },
      { type: "linked-evidence-recorded", node: linked.node, edge: linked.edge },
    ]);
    expect(store.getTrace("message-1")?.nodes).toEqual([root, linked.node]);
    expect(store.getTrace("message-1")?.edges).toEqual([linked.edge]);

    store.recordNode({ kind: "adapter.diagnostic", source: coreSource });
    store.recordNode({ kind: "adapter.diagnostic", source: coreSource });

    expect(baseDeltas.filter((delta) => delta.type === "evidence-removed")).toHaveLength(1);
    expect(store.getTrace("message-1")?.nodes).toEqual([root, linked.node]);
  });

  it("attributes a linked child to every trace that already owns its parent", () => {
    const store = createCausalityTraceStore();
    const firstRoot = recordTransport(store, "message-1");
    const secondRoot = recordTransport(store, "message-2");
    const sharedCommit = store.recordNode({
      kind: "react.commit-observed",
      source: reactSource,
    });
    store.recordEdge({
      fromNodeId: firstRoot.id,
      toNodeId: sharedCommit.id,
      confidence: "adapter-backed",
      correlationMethod: "pending-react-commit",
      reason: "shared commit",
    });
    store.recordEdge({
      fromNodeId: secondRoot.id,
      toNodeId: sharedCommit.id,
      confidence: "adapter-backed",
      correlationMethod: "pending-react-commit",
      reason: "shared commit",
    });

    const linked = store.recordLinkedNode(
      {
        node: { kind: "state.root-changed", source: coreSource },
        edge: {
          confidence: "adapter-backed",
          correlationMethod: "same-call-stack",
          reason: "same state transition",
        },
      },
      { messageId: "message-1", activeNodeId: sharedCommit.id },
    );

    for (const messageId of ["message-1", "message-2"]) {
      const trace = store.getTrace(messageId);
      expect(trace?.nodes).toContain(linked.node);
      expect(trace?.edges).toContain(linked.edge);
    }
  });

  it("does not consume evidence ids or publish a delta when linked evidence is invalid", () => {
    const store = createCausalityTraceStore();
    const deltas: CausalityGraphDelta[] = [];
    store.subscribe((delta) => deltas.push(delta));
    const root = recordTransport(store, "message-1");
    const invalidInput: CausalityLinkedNodeInput = {
      node: { kind: "handler.started", source: websocketSource },
      edge: {
        confidence: "definitive",
        correlationMethod: "same-native-event",
        reason: "invalid root",
      },
    };
    Reflect.set(invalidInput.node, "kind", "transport.received");

    expect(() =>
      store.recordLinkedNode(invalidInput, { messageId: "message-1", activeNodeId: root.id }),
    ).toThrow("Linked causality evidence must not create a transport root.");

    const pending = store.recordNode({ kind: "handler.started", source: websocketSource });
    expect(pending.id).toBe("causality-node-2");
    expect(deltas).toEqual([
      { type: "node-recorded", node: root },
      { type: "node-recorded", node: pending },
    ]);
  });

  it("keeps legacy projections adjacent and extension evidence atomic during reentrant eviction", () => {
    const store = createCausalityTraceStore();
    const root = recordTransport(store, "message-1");
    const observedBySecondBaseListener: string[] = [];
    const observedBySecondLinkedListener: string[] = [];
    let secondLinkedListenerSawCompleteEvidence = false;

    store.subscribe((delta) => {
      if (delta.type === "node-recorded" && delta.node.kind === "handler.started") {
        store.evictMessage("message-1");
      }
    });
    store.subscribe((delta) => {
      observedBySecondBaseListener.push(delta.type);
    });
    store.subscribeLinkedEvidence((delta) => {
      observedBySecondLinkedListener.push(delta.type);

      if (delta.type === "linked-evidence-recorded") {
        secondLinkedListenerSawCompleteEvidence =
          delta.edge.fromNodeId === root.id && delta.edge.toNodeId === delta.node.id;
      }
    });

    store.recordLinkedNode(
      {
        node: { kind: "handler.started", source: websocketSource },
        edge: {
          confidence: "definitive",
          correlationMethod: "same-native-event",
          reason: "same MessageEvent",
        },
      },
      { messageId: "message-1", activeNodeId: root.id },
    );

    expect(secondLinkedListenerSawCompleteEvidence).toBe(true);
    expect(observedBySecondBaseListener).toEqual([
      "node-recorded",
      "edge-recorded",
      "message-evicted",
    ]);
    expect(observedBySecondLinkedListener).toEqual(["linked-evidence-recorded", "message-evicted"]);
  });

  it("keeps base and extension listener snapshots stable for a full notification", () => {
    const store = createCausalityTraceStore();
    const root = recordTransport(store, "message-1");
    const secondBaseListener: string[] = [];
    const secondLinkedListener: string[] = [];
    let unsubscribeSecondBase = noop;
    let unsubscribeSecondLinked = noop;

    store.subscribe((delta) => {
      if (delta.type === "node-recorded" && delta.node.kind === "handler.started") {
        unsubscribeSecondBase();
      }
    });
    unsubscribeSecondBase = store.subscribe((delta) => {
      secondBaseListener.push(delta.type);
    });
    store.subscribeLinkedEvidence((delta) => {
      if (delta.type === "linked-evidence-recorded") {
        unsubscribeSecondLinked();
      }
    });
    unsubscribeSecondLinked = store.subscribeLinkedEvidence((delta) => {
      secondLinkedListener.push(delta.type);
    });

    store.recordLinkedNode(
      {
        node: { kind: "handler.started", source: websocketSource },
        edge: {
          confidence: "definitive",
          correlationMethod: "same-native-event",
          reason: "same MessageEvent",
        },
      },
      { messageId: "message-1", activeNodeId: root.id },
    );
    store.recordNode({ kind: "adapter.diagnostic", source: coreSource });

    expect(secondBaseListener).toEqual(["node-recorded", "edge-recorded"]);
    expect(secondLinkedListener).toEqual(["linked-evidence-recorded"]);
  });

  it("allocates linked evidence identifiers after a reentrant clock callback", () => {
    let reenterClock = false;
    let store: CausalityTraceStore;
    const deltas: CausalityGraphDelta[] = [];
    store = createCausalityTraceStore({
      maxPendingNodes: 1,
      now: () => {
        if (reenterClock) {
          reenterClock = false;
          store.recordNode({ kind: "adapter.diagnostic", source: coreSource });
        }

        return 1;
      },
    });
    store.subscribe((delta) => deltas.push(delta));
    const root = recordTransport(store, "message-1");
    reenterClock = true;

    const linked = store.recordLinkedNode(
      {
        node: { kind: "handler.started", source: websocketSource },
        edge: {
          confidence: "definitive",
          correlationMethod: "same-native-event",
          reason: "same MessageEvent",
        },
      },
      { messageId: "message-1", activeNodeId: root.id },
    );
    const laterPending = store.recordNode({ kind: "adapter.diagnostic", source: coreSource });

    expect(linked.node.id).toBe("causality-node-3");
    expect(linked.edge.id).toBe("causality-edge-1");
    expect(laterPending.id).toBe("causality-node-4");
    expect(store.getTrace("message-1")?.nodes.map((node) => node.id)).toEqual([
      root.id,
      linked.node.id,
    ]);
    expect(deltas).toContainEqual(
      expect.objectContaining({
        type: "evidence-removed",
        removedNodeIds: ["causality-node-2"],
      }),
    );
  });

  it("revalidates the active message after a reentrant clock evicts it", () => {
    let evictDuringClock = false;
    let store: CausalityTraceStore;
    const deltas: CausalityGraphDelta[] = [];
    store = createCausalityTraceStore({
      now: () => {
        if (evictDuringClock) {
          evictDuringClock = false;
          store.evictMessage("message-1");
        }

        return 1;
      },
    });
    store.subscribe((delta) => deltas.push(delta));
    const root = recordTransport(store, "message-1");
    evictDuringClock = true;

    expect(() =>
      store.recordLinkedNode(
        {
          node: { kind: "handler.started", source: websocketSource },
          edge: {
            confidence: "definitive",
            correlationMethod: "same-native-event",
            reason: "same MessageEvent",
          },
        },
        { messageId: "message-1", activeNodeId: root.id },
      ),
    ).toThrow("Message message-1 is not retained.");

    const pending = store.recordNode({ kind: "adapter.diagnostic", source: coreSource });
    expect(pending.id).toBe("causality-node-2");
    expect(deltas.map((delta) => delta.type)).toEqual([
      "node-recorded",
      "message-evicted",
      "node-recorded",
    ]);
  });

  it("delivers reentrant recordNode deltas in FIFO order to every listener", () => {
    const store = createCausalityTraceStore();
    const observedBySecondListener: string[] = [];

    store.subscribe((delta) => {
      if (delta.type === "node-recorded" && delta.node.kind === "transport.received") {
        store.recordNode({ kind: "adapter.diagnostic", source: coreSource });
      }
    });
    store.subscribe((delta) => {
      if (delta.type === "node-recorded") {
        observedBySecondListener.push(delta.node.kind);
      }
    });

    recordTransport(store, "message-1");

    expect(observedBySecondListener).toEqual(["transport.received", "adapter.diagnostic"]);
  });

  it("delivers the current and queued disposed deltas after a listener disposes the store", () => {
    const store = createCausalityTraceStore();
    const observedBySecondBaseListener: string[] = [];
    const observedBySecondLinkedListener: string[] = [];

    store.subscribe((delta) => {
      if (delta.type === "node-recorded") {
        store.dispose();
      }
    });
    store.subscribe((delta) => {
      observedBySecondBaseListener.push(delta.type);
    });
    store.subscribeLinkedEvidence((delta) => {
      observedBySecondLinkedListener.push(delta.type);
    });

    recordTransport(store, "message-1");

    expect(observedBySecondBaseListener).toEqual(["node-recorded", "disposed"]);
    expect(observedBySecondLinkedListener).toEqual(["node-recorded", "disposed"]);
  });

  it("isolates listener failures and preserves later subscribers", () => {
    const store = createCausalityTraceStore();
    const deltas: CausalityGraphDelta[] = [];
    store.subscribe(() => {
      throw new Error("consumer failed");
    });
    store.subscribe((delta) => deltas.push(delta));

    const node = recordTransport(store, "message-1");
    expect(deltas).toEqual([{ type: "node-recorded", node }]);
  });

  it("continues base and linked notifications after async listener rejections", async () => {
    const store = createCausalityTraceStore();
    const baseDeltas: CausalityGraphDelta[] = [];
    const linkedDeltas: CausalityLinkedEvidenceGraphDelta[] = [];
    const root = recordTransport(store, "message-1");

    store.subscribe(async () => {
      throw new Error("async base listener failed");
    });
    store.subscribe((delta) => baseDeltas.push(delta));
    store.subscribeLinkedEvidence(async () => {
      throw new Error("async linked listener failed");
    });
    store.subscribeLinkedEvidence((delta) => linkedDeltas.push(delta));

    store.recordLinkedNode(
      {
        node: { kind: "handler.started", source: websocketSource },
        edge: {
          confidence: "definitive",
          correlationMethod: "same-native-event",
          reason: "message handler began",
        },
      },
      { messageId: "message-1", activeNodeId: root.id },
    );

    await Promise.resolve();

    expect(baseDeltas.map((delta) => delta.type)).toEqual(["node-recorded", "edge-recorded"]);
    expect(linkedDeltas).toHaveLength(1);
    expect(linkedDeltas[0]).toMatchObject({ type: "linked-evidence-recorded" });
  });

  it("evicts exclusive evidence while retaining a shared batched node", () => {
    const store = createCausalityTraceStore();
    const deltas: CausalityGraphDelta[] = [];
    store.subscribe((delta) => deltas.push(delta));
    const firstRoot = recordTransport(store, "message-1");
    const secondRoot = recordTransport(store, "message-2");
    const firstHandler = store.recordNode({ kind: "handler.started", source: websocketSource });
    const sharedCommit = store.recordNode({
      kind: "react.commit-observed",
      source: reactSource,
    });
    store.recordEdge({
      fromNodeId: firstRoot.id,
      toNodeId: firstHandler.id,
      confidence: "definitive",
      correlationMethod: "same-native-event",
      reason: "first handler",
    });
    store.recordEdge({
      fromNodeId: firstHandler.id,
      toNodeId: sharedCommit.id,
      confidence: "adapter-backed",
      correlationMethod: "pending-react-commit",
      reason: "shared commit",
    });
    store.recordEdge({
      fromNodeId: secondRoot.id,
      toNodeId: sharedCommit.id,
      confidence: "adapter-backed",
      correlationMethod: "pending-react-commit",
      reason: "shared commit",
    });

    store.evictMessage("message-1");

    expect(store.getTrace("message-1")).toBeUndefined();
    expect(store.getTrace("message-2")?.nodes.map((node) => node.id)).toEqual([
      secondRoot.id,
      sharedCommit.id,
    ]);
    expect(store.getTrace("message-2")?.edges).toHaveLength(1);
    expect(deltas.at(-1)).toEqual(
      expect.objectContaining({
        type: "message-evicted",
        messageId: "message-1",
        removedNodeIds: expect.arrayContaining([firstRoot.id, firstHandler.id]),
        removedNodes: expect.arrayContaining([firstRoot, firstHandler]),
      }),
    );
    const firstEviction = deltas.at(-1);

    if (firstEviction?.type !== "message-evicted") {
      throw new Error("Expected the first eviction delta.");
    }

    expect(firstEviction.removedNodeIds).not.toContain(sharedCommit.id);

    store.evictMessage("message-2");
    const secondEviction = deltas.at(-1);

    if (secondEviction?.type !== "message-evicted") {
      throw new Error("Expected the second eviction delta.");
    }

    expect(secondEviction.removedNodeIds).toContain(sharedCommit.id);
  });

  it("evicts only the target reference set among many unrelated retained traces", () => {
    const store = createCausalityTraceStore();
    const deltas: CausalityGraphDelta[] = [];
    store.subscribe((delta) => deltas.push(delta));
    const targetRoot = recordTransport(store, "target-message");
    const targetHandler = store.recordNode({
      kind: "handler.started",
      source: websocketSource,
    });
    const targetEdge = store.recordEdge({
      fromNodeId: targetRoot.id,
      toNodeId: targetHandler.id,
      confidence: "definitive",
      correlationMethod: "same-native-event",
      reason: "target handler",
    });
    const unrelatedRootIds: string[] = [];

    for (let index = 0; index < 100; index += 1) {
      const root = recordTransport(store, `unrelated-message-${index}`);
      const handler = store.recordNode({
        kind: "handler.started",
        source: websocketSource,
      });
      store.recordEdge({
        fromNodeId: root.id,
        toNodeId: handler.id,
        confidence: "definitive",
        correlationMethod: "same-native-event",
        reason: "unrelated handler",
      });
      unrelatedRootIds.push(root.id);
    }

    expect(store.getTrace("target-message")?.nodes.map((node) => node.id)).toEqual([
      targetRoot.id,
      targetHandler.id,
    ]);
    expect(store.getTrace("target-message")?.edges.map((edge) => edge.id)).toEqual([targetEdge.id]);

    store.evictMessage("target-message");
    const eviction = deltas.at(-1);

    if (eviction?.type !== "message-evicted") {
      throw new Error("Expected the target eviction delta.");
    }

    expect(eviction.removedNodeIds).toEqual([targetRoot.id, targetHandler.id]);
    expect(eviction.removedEdgeIds).toEqual([targetEdge.id]);
    expect(eviction.removedNodeIds).not.toEqual(expect.arrayContaining(unrelatedRootIds));
    expect(store.getTrace("unrelated-message-99")?.rootNodeId).toBe(unrelatedRootIds.at(-1));
  });

  it("includes incident pending edges removed as part of message eviction", () => {
    const store = createCausalityTraceStore();
    const deltas: CausalityGraphDelta[] = [];
    store.subscribe((delta) => deltas.push(delta));
    const root = recordTransport(store, "message-1");
    const handler = store.recordNode({ kind: "handler.started", source: websocketSource });
    const pending = store.recordNode({ kind: "adapter.diagnostic", source: coreSource });
    const attachedEdge = store.recordEdge({
      fromNodeId: root.id,
      toNodeId: handler.id,
      confidence: "definitive",
      correlationMethod: "same-native-event",
      reason: "attached handler",
    });
    const incidentPendingEdge = store.recordEdge({
      fromNodeId: pending.id,
      toNodeId: handler.id,
      confidence: "heuristic",
      correlationMethod: "time-window",
      reason: "pending diagnostic association",
    });

    store.evictMessage("message-1");
    const eviction = deltas.at(-1);

    if (eviction?.type !== "message-evicted") {
      throw new Error("Expected a message eviction delta.");
    }

    expect(eviction.removedEdgeIds).toEqual([attachedEdge.id, incidentPendingEdge.id]);
    expect(eviction.removedEdges).toEqual([attachedEdge, incidentPendingEdge]);
    expect(new Set(eviction.removedEdgeIds).size).toBe(eviction.removedEdgeIds.length);
  });

  it("clears reusable state and disposes terminal state", () => {
    const bridge = createBrowseSentEventCausalityBridge();
    const deltas: CausalityGraphDelta[] = [];
    const linkedDeltas: CausalityLinkedEvidenceGraphDelta[] = [];
    bridge.subscribeEvidence((delta) => deltas.push(delta));
    bridge.subscribeLinkedEvidence((delta) => linkedDeltas.push(delta));
    bridge.retainMessage("message-1");
    const root = bridge.recordNode(transportNode("message-1"));

    bridge.runWithContext({ messageId: "message-1", activeNodeId: root.id }, () => {
      expect(bridge.getActiveContext()?.activeNodeId).toBe(root.id);
      bridge.clear();
      expect(bridge.getActiveContext()).toBeUndefined();
    });
    expect(bridge.getTrace("message-1")).toBeUndefined();
    expect(deltas.at(-1)).toEqual({ type: "cleared" });
    expect(linkedDeltas.at(-1)).toEqual({ type: "cleared" });

    bridge.retainMessage("message-2");
    bridge.recordNode(transportNode("message-2"));
    bridge.dispose();
    expect(bridge.getTrace("message-2")).toBeUndefined();
    expect(deltas.at(-1)).toEqual({ type: "disposed" });
    expect(linkedDeltas.at(-1)).toEqual({ type: "disposed" });
    expect(() => bridge.recordNode(transportNode("message-3"))).toThrow(
      "Causality trace store is disposed.",
    );
    expect(() =>
      bridge.runWithContext({ messageId: "message-3", activeNodeId: "node-3" }, () => undefined),
    ).toThrow("Causality context stack is disposed.");
  });

  it("validates message roots and active-node reachability before entering context", () => {
    const bridge = createBrowseSentEventCausalityBridge();
    bridge.retainMessage("message-1");
    const root = bridge.recordNode(transportNode("message-1"));
    const pending = bridge.recordNode({ kind: "handler.started", source: websocketSource });
    let called = false;
    const callback = () => {
      called = true;
    };

    expect(() => bridge.runWithContext({ messageId: "", activeNodeId: root.id }, callback)).toThrow(
      "Causality context must reference a retained message trace node.",
    );
    expect(() =>
      bridge.runWithContext({ messageId: "message-1", activeNodeId: "" }, callback),
    ).toThrow("Causality context must reference a retained message trace node.");
    expect(() =>
      bridge.runWithContext({ messageId: "message-1", activeNodeId: pending.id }, callback),
    ).toThrow("Causality context must reference a retained message trace node.");
    expect(called).toBe(false);
  });

  it("uses the active context as the only parent for linked evidence", () => {
    const bridge = createBrowseSentEventCausalityBridge();
    bridge.retainMessage("message-1");
    const root = bridge.recordNode(transportNode("message-1"));

    expect(() =>
      bridge.recordLinkedNode({
        node: { kind: "handler.started", source: websocketSource },
        edge: {
          confidence: "definitive",
          correlationMethod: "same-native-event",
          reason: "same MessageEvent",
        },
      }),
    ).toThrow("Linked causality evidence requires an active context.");

    const linked = bridge.runWithContext({ messageId: "message-1", activeNodeId: root.id }, () =>
      bridge.recordLinkedNode({
        node: { kind: "handler.started", source: websocketSource },
        edge: {
          confidence: "definitive",
          correlationMethod: "same-native-event",
          reason: "same MessageEvent",
        },
      }),
    );

    expect(linked.edge).toMatchObject({ fromNodeId: root.id, toNodeId: linked.node.id });
  });

  it("uses unavailable as the empty or weakest confidence", () => {
    expect(getWeakestCausalityConfidence([])).toBe("unavailable");
    expect(getWeakestCausalityConfidence(["definitive", "adapter-backed", "unavailable"])).toBe(
      "unavailable",
    );
  });

  it("derives only positive lifecycle stages from recorded evidence", () => {
    const store = createCausalityTraceStore();
    const root = recordTransport(store, "message-1");
    const getTrace = () => {
      const trace = store.getTrace("message-1");

      if (!trace) {
        throw new Error("Expected the message trace.");
      }

      return trace;
    };

    expect(deriveCausalityLifecycle(getTrace()).status).toBe("awaiting-handler");
    const handler = store.recordNode({ kind: "handler.started", source: websocketSource });
    store.recordEdge({
      fromNodeId: root.id,
      toNodeId: handler.id,
      confidence: "definitive",
      correlationMethod: "same-native-event",
      reason: "handler called",
    });
    expect(deriveCausalityLifecycle(getTrace()).status).toBe("handler-observed");
    const state = store.recordNode({ kind: "state.root-changed", source: coreSource });
    store.recordEdge({
      fromNodeId: handler.id,
      toNodeId: state.id,
      confidence: "definitive",
      correlationMethod: "same-call-stack",
      reason: "root identity changed",
    });
    expect(deriveCausalityLifecycle(getTrace()).status).toBe("state-observed");
  });

  it("rejects message ownership outside transport roots", () => {
    const store = createCausalityTraceStore();
    expect(() =>
      store.recordNode({
        kind: "handler.started",
        messageId: "message-1",
        source: websocketSource,
      }),
    ).toThrow("Only transport.received nodes may own a messageId.");
  });

  it("rejects duplicate roots, unknown endpoints, and graph cycles", () => {
    const store = createCausalityTraceStore();
    const root = recordTransport(store, "message-1");
    const handler = store.recordNode({ kind: "handler.started", source: websocketSource });

    expect(() => store.recordNode(transportNode("message-1"))).toThrow(
      "A transport node already exists for message message-1.",
    );
    expect(() =>
      store.recordEdge({
        fromNodeId: root.id,
        toNodeId: "missing-node",
        confidence: "definitive",
        correlationMethod: "same-native-event",
        reason: "invalid fixture edge",
      }),
    ).toThrow("Causality edges must reference recorded nodes.");

    store.recordEdge({
      fromNodeId: root.id,
      toNodeId: handler.id,
      confidence: "definitive",
      correlationMethod: "same-native-event",
      reason: "forward edge",
    });
    const state = store.recordNode({ kind: "state.root-changed", source: coreSource });
    store.recordEdge({
      fromNodeId: handler.id,
      toNodeId: state.id,
      confidence: "definitive",
      correlationMethod: "same-call-stack",
      reason: "second forward edge",
    });
    expect(() =>
      store.recordEdge({
        fromNodeId: state.id,
        toNodeId: handler.id,
        confidence: "definitive",
        correlationMethod: "same-call-stack",
        reason: "cycle",
      }),
    ).toThrow("Causality edges must not create a cycle.");
  });

  it("rejects unretained and empty transport message identifiers", () => {
    const store = createCausalityTraceStore();

    expect(() => store.retainMessage("")).toThrow("Retained messageId must be a non-empty string.");
    expect(() => store.recordNode(transportNode("message-1"))).toThrow(
      "Message message-1 is not retained.",
    );
    expect(() => store.recordNode(transportNode(""))).toThrow(
      "transport.received messageId must be a non-empty string.",
    );
  });

  it("preserves retained traces when eviction compacts internal indexes", () => {
    const store = createCausalityTraceStore({ compactAfterEvictions: 2 });
    const firstRoot = recordTransport(store, "message-1");
    const secondRoot = recordTransport(store, "message-2");
    const retainedRoot = recordTransport(store, "message-3");
    const retainedHandler = store.recordNode({
      kind: "handler.started",
      source: websocketSource,
    });
    const retainedEdge = store.recordEdge({
      fromNodeId: retainedRoot.id,
      toNodeId: retainedHandler.id,
      confidence: "definitive",
      correlationMethod: "same-native-event",
      reason: "same MessageEvent",
    });

    store.evictMessage("message-1");
    store.evictMessage("message-2");

    expect(store.getTrace("message-1")).toBeUndefined();
    expect(store.getTrace("message-2")).toBeUndefined();
    expect(store.getTrace("message-3")).toMatchObject({
      nodes: [retainedRoot, retainedHandler],
      edges: [retainedEdge],
    });
    expect(firstRoot.messageId).toBe("message-1");
    expect(secondRoot.messageId).toBe("message-2");
  });

  it("requires a positive eviction compaction interval", () => {
    expect(() => createCausalityTraceStore({ compactAfterEvictions: 0 })).toThrow(
      "compactAfterEvictions must be a positive integer.",
    );
  });

  it("rejects unavailable edges and edges targeting transport roots", () => {
    const store = createCausalityTraceStore();
    const firstRoot = recordTransport(store, "message-1");
    const secondRoot = recordTransport(store, "message-2");
    const handler = store.recordNode({ kind: "handler.started", source: websocketSource });

    expect(() =>
      store.recordEdge({
        fromNodeId: firstRoot.id,
        toNodeId: handler.id,
        confidence: "unavailable",
        correlationMethod: "same-native-event",
        reason: "not observed",
      }),
    ).toThrow("Causality edges require an observed confidence.");
    expect(() =>
      store.recordEdge({
        fromNodeId: firstRoot.id,
        toNodeId: secondRoot.id,
        confidence: "definitive",
        correlationMethod: "same-native-event",
        reason: "backward root edge",
      }),
    ).toThrow("Causality edges must not target a transport root.");
  });

  it("bounds unattached evidence and emits a removal delta", () => {
    const store = createCausalityTraceStore({ maxPendingNodes: 2 });
    const deltas: CausalityGraphDelta[] = [];
    store.subscribe((delta) => deltas.push(delta));
    const first = store.recordNode({ kind: "adapter.diagnostic", source: coreSource });
    store.recordNode({ kind: "adapter.diagnostic", source: coreSource });
    store.recordNode({ kind: "adapter.diagnostic", source: coreSource });
    const removal = deltas.find((delta) => delta.type === "evidence-removed");

    expect(removal).toEqual({
      type: "evidence-removed",
      reason: "pending-capacity",
      removedNodeIds: [first.id],
      removedEdgeIds: [],
      removedNodes: [first],
      removedEdges: [],
    });
  });

  it("rejects duplicate edges between pending nodes", () => {
    const store = createCausalityTraceStore({ maxPendingNodes: 2 });
    const first = store.recordNode({ kind: "handler.started", source: websocketSource });
    const second = store.recordNode({ kind: "handler.returned", source: websocketSource });
    const input = {
      fromNodeId: first.id,
      toNodeId: second.id,
      confidence: "definitive" as const,
      correlationMethod: "same-call-stack" as const,
      reason: "pending handler pair",
    };
    store.recordEdge(input);

    expect(() => store.recordEdge(input)).toThrow("Causality edges must not duplicate endpoints.");
  });

  it("retains unattached nodes until clear or until their attached message is evicted", () => {
    const store = createCausalityTraceStore();
    const unattached = store.recordNode({
      kind: "adapter.diagnostic",
      source: coreSource,
      attributes: { code: "waiting-for-runtime" },
    });
    const firstRoot = recordTransport(store, "message-1");
    store.evictMessage("message-1");

    const secondRoot = recordTransport(store, "message-2");
    expect(() =>
      store.recordEdge({
        fromNodeId: secondRoot.id,
        toNodeId: unattached.id,
        confidence: "heuristic",
        correlationMethod: "time-window",
        reason: "attach retained diagnostic",
      }),
    ).not.toThrow();

    store.evictMessage("message-2");
    const thirdRoot = recordTransport(store, "message-3");
    expect(() =>
      store.recordEdge({
        fromNodeId: thirdRoot.id,
        toNodeId: unattached.id,
        confidence: "heuristic",
        correlationMethod: "time-window",
        reason: "removed diagnostic",
      }),
    ).toThrow("Causality edges must reference recorded nodes.");
    expect(firstRoot.messageId).toBe("message-1");
  });

  it("keeps path confidence separately and orders evidence by append sequence", () => {
    const store = createCausalityTraceStore();
    const root = recordTransport(store, "message-1");
    const definitiveLeaf = store.recordNode({
      kind: "handler.returned",
      source: websocketSource,
    });
    const heuristicLeaf = store.recordNode({
      kind: "react.commit-observed",
      source: reactSource,
    });
    const firstEdge = store.recordEdge({
      fromNodeId: root.id,
      toNodeId: definitiveLeaf.id,
      confidence: "definitive",
      correlationMethod: "same-native-event",
      reason: "definitive branch",
    });
    const secondEdge = store.recordEdge({
      fromNodeId: root.id,
      toNodeId: heuristicLeaf.id,
      confidence: "heuristic",
      correlationMethod: "time-window",
      reason: "heuristic branch",
    });
    const trace = store.getTrace("message-1");

    expect(trace?.nodes.map((node) => node.id)).toEqual([
      root.id,
      definitiveLeaf.id,
      heuristicLeaf.id,
    ]);
    expect(trace?.edges.map((edge) => edge.id)).toEqual([firstEdge.id, secondEdge.id]);
    expect(trace?.paths.map((path) => path.confidence)).toEqual(["definitive", "heuristic"]);
    expect(trace?.confidence).toBe("heuristic");
  });

  it("projects a deep chain iteratively", () => {
    const store = createCausalityTraceStore();
    const root = recordTransport(store, "message-1");
    let previous = root;

    for (let index = 0; index < 2_000; index += 1) {
      const next = store.recordNode({ kind: "handler.started", source: websocketSource });
      store.recordEdge({
        fromNodeId: previous.id,
        toNodeId: next.id,
        confidence: "definitive",
        correlationMethod: "same-call-stack",
        reason: "deep fixture chain",
      });
      previous = next;
    }

    const trace = store.getTrace("message-1");
    expect(trace?.paths).toHaveLength(1);
    expect(trace?.paths[0]?.nodeIds).toHaveLength(2_001);
    expect(trace?.truncated).toBe(false);
  });

  it("bounds branch path projection while keeping conservative graph confidence", () => {
    const store = createCausalityTraceStore({ maxTracePaths: 2 });
    const root = recordTransport(store, "message-1");

    for (const confidence of ["definitive", "adapter-backed", "heuristic"] as const) {
      const leaf = store.recordNode({ kind: "handler.returned", source: websocketSource });
      store.recordEdge({
        fromNodeId: root.id,
        toNodeId: leaf.id,
        confidence,
        correlationMethod: confidence === "heuristic" ? "time-window" : "same-native-event",
        reason: `${confidence} branch`,
      });
    }

    const trace = store.getTrace("message-1");
    expect(trace?.paths).toHaveLength(2);
    expect(trace?.truncated).toBe(true);
    expect(trace?.confidence).toBe("heuristic");
  });
});
