import { describe, expect, it } from "vitest";
import { createBrowseSentEventCausalityBridge } from "../bridge.js";
import { deriveCausalityLifecycle, getWeakestCausalityConfidence } from "../lifecycle.js";
import type { CausalityGraphDelta, CausalityNodeInput } from "../model.js";
import { createCausalityTraceStore } from "../trace-store.js";
import type { CausalityTraceStore } from "../trace-store.js";

const coreSource = { adapter: "core" as const };
const websocketSource = { adapter: "websocket" as const };
const reactSource = { adapter: "react" as const };

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
    bridge.subscribeEvidence((delta) => deltas.push(delta));
    bridge.retainMessage("message-1");
    const root = bridge.recordNode(transportNode("message-1"));

    bridge.runWithContext({ messageId: "message-1", activeNodeId: root.id }, () => {
      expect(bridge.getActiveContext()?.activeNodeId).toBe(root.id);
      bridge.clear();
      expect(bridge.getActiveContext()).toBeUndefined();
    });
    expect(bridge.getTrace("message-1")).toBeUndefined();
    expect(deltas.at(-1)).toEqual({ type: "cleared" });

    bridge.retainMessage("message-2");
    bridge.recordNode(transportNode("message-2"));
    bridge.dispose();
    expect(bridge.getTrace("message-2")).toBeUndefined();
    expect(deltas.at(-1)).toEqual({ type: "disposed" });
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
