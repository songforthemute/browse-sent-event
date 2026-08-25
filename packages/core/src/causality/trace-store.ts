import { getWeakestCausalityConfidence } from "./lifecycle.js";
import type {
  CausalityConfidence,
  CausalityContext,
  CausalityEdge,
  CausalityEdgeInput,
  CausalityEventKind,
  CausalityGraphDelta,
  CausalityGraphDeltaListener,
  CausalityLinkedEvidenceGraphDelta,
  CausalityLinkedEvidenceGraphDeltaListener,
  CausalityLinkedEvidenceRecordedDelta,
  CausalityLinkedNode,
  CausalityLinkedNodeInput,
  CausalityNode,
  CausalityNodeInput,
  CausalityTrace,
  CausalityTracePath,
} from "./model.js";

const defaultMaxPendingNodes = 1_000;
const defaultMaxTracePaths = 256;

export interface CausalityTraceStoreOptions {
  readonly compactAfterEvictions?: number;
  readonly maxPendingNodes?: number;
  readonly maxTracePaths?: number;
  readonly now?: () => number;
}

export interface CausalityTraceStore {
  retainMessage(messageId: string): void;
  recordNode(input: CausalityNodeInput): CausalityNode;
  recordEdge(input: CausalityEdgeInput): CausalityEdge;
  recordLinkedNode(input: CausalityLinkedNodeInput, context: CausalityContext): CausalityLinkedNode;
  getTrace(messageId: string): CausalityTrace | undefined;
  hasReachableNode(messageId: string, nodeId: string): boolean;
  subscribe(listener: CausalityGraphDeltaListener): () => void;
  subscribeLinkedEvidence(listener: CausalityLinkedEvidenceGraphDeltaListener): () => void;
  evictMessage(messageId: string): void;
  clear(): void;
  dispose(): void;
}

interface PathState {
  readonly nodeId: string;
  readonly parent?: PathState;
  readonly viaEdgeId?: string;
  readonly confidence?: CausalityConfidence;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
}

function freezeNode(node: CausalityNode): CausalityNode {
  Object.freeze(node.attributes);
  Object.freeze(node.source);
  return Object.freeze(node);
}

function freezeDelta(delta: CausalityGraphDelta): CausalityGraphDelta {
  if (delta.type === "message-evicted" || delta.type === "evidence-removed") {
    Object.freeze(delta.removedNodeIds);
    Object.freeze(delta.removedEdgeIds);
    Object.freeze(delta.removedNodes);
    Object.freeze(delta.removedEdges);
  }

  return Object.freeze(delta);
}

function freezeLinkedDelta(
  delta: CausalityLinkedEvidenceRecordedDelta,
): CausalityLinkedEvidenceRecordedDelta {
  return Object.freeze(delta);
}

interface EvidenceNotification {
  readonly baseDeltas: readonly CausalityGraphDelta[];
  readonly extensionDelta: CausalityLinkedEvidenceGraphDelta;
}

function compareEvidenceIds(left: string, right: string): number {
  const leftSequence = Number.parseInt(left.slice(left.lastIndexOf("-") + 1), 10);
  const rightSequence = Number.parseInt(right.slice(right.lastIndexOf("-") + 1), 10);
  return leftSequence - rightSequence;
}

export function createCausalityTraceStore(
  options: CausalityTraceStoreOptions = {},
): CausalityTraceStore {
  const maxPendingNodes = options.maxPendingNodes ?? defaultMaxPendingNodes;
  const maxTracePaths = options.maxTracePaths ?? defaultMaxTracePaths;
  const compactAfterEvictions = options.compactAfterEvictions;
  assertPositiveInteger(maxPendingNodes, "maxPendingNodes");
  assertPositiveInteger(maxTracePaths, "maxTracePaths");
  if (compactAfterEvictions !== undefined) {
    assertPositiveInteger(compactAfterEvictions, "compactAfterEvictions");
  }

  let nodes = new Map<string, CausalityNode>();
  let edges = new Map<string, CausalityEdge>();
  let outgoingEdgeIds = new Map<string, Set<string>>();
  let incomingEdgeIds = new Map<string, Set<string>>();
  let edgeIdsByEndpoints = new Map<string, string>();
  let retainedMessageIds = new Set<string>();
  let messageRootIds = new Map<string, string>();
  let messageNodeIds = new Map<string, Set<string>>();
  let messageEdgeIds = new Map<string, Set<string>>();
  let nodeMessageIds = new Map<string, Set<string>>();
  let edgeMessageIds = new Map<string, Set<string>>();
  let pendingNodeIds = new Set<string>();
  const baseListeners = new Set<CausalityGraphDeltaListener>();
  const linkedListeners = new Set<CausalityLinkedEvidenceGraphDeltaListener>();
  const pendingNotifications: EvidenceNotification[] = [];
  const now = options.now ?? (() => globalThis.performance?.now() ?? Date.now());
  let nextNodeSequence = 0;
  let nextEdgeSequence = 0;
  let evictionsSinceCompaction = 0;
  let disposed = false;
  let notifying = false;
  let clearListenersAfterNotification = false;

  function compactIndexes(): void {
    nodes = new Map(nodes);
    edges = new Map(edges);
    outgoingEdgeIds = new Map(outgoingEdgeIds);
    incomingEdgeIds = new Map(incomingEdgeIds);
    edgeIdsByEndpoints = new Map(edgeIdsByEndpoints);
    retainedMessageIds = new Set(retainedMessageIds);
    messageRootIds = new Map(messageRootIds);
    messageNodeIds = new Map(messageNodeIds);
    messageEdgeIds = new Map(messageEdgeIds);
    nodeMessageIds = new Map(nodeMessageIds);
    edgeMessageIds = new Map(edgeMessageIds);
    pendingNodeIds = new Set(pendingNodeIds);
  }

  function assertActive(): void {
    if (disposed) {
      throw new Error("Causality trace store is disposed.");
    }
  }

  function enqueue(nextNotification: EvidenceNotification): void {
    pendingNotifications.push(nextNotification);

    if (notifying) {
      return;
    }

    notifying = true;

    try {
      while (pendingNotifications.length > 0) {
        const notification = pendingNotifications.shift();

        if (!notification) {
          continue;
        }

        // Keep each notification's audience stable. A legacy linked-evidence
        // projection contains two deltas, so changing subscriptions in the
        // first callback must not leave an existing listener with only one.
        const baseListenerSnapshot = Array.from(baseListeners);
        const linkedListenerSnapshot = Array.from(linkedListeners);

        for (const delta of notification.baseDeltas) {
          for (const listener of baseListenerSnapshot) {
            try {
              listener(delta);
            } catch {
              // Evidence consumers must not change application or adapter behavior.
            }
          }
        }

        for (const listener of linkedListenerSnapshot) {
          try {
            listener(notification.extensionDelta);
          } catch {
            // Evidence consumers must not change application or adapter behavior.
          }
        }
      }
    } finally {
      notifying = false;

      if (clearListenersAfterNotification) {
        clearListenersAfterNotification = false;
        baseListeners.clear();
        linkedListeners.clear();
      }
    }
  }

  function notify(delta: CausalityGraphDelta): void {
    const frozenDelta = freezeDelta(delta);
    enqueue({ baseDeltas: Object.freeze([frozenDelta]), extensionDelta: frozenDelta });
  }

  function notifyLinkedEvidence(delta: CausalityLinkedEvidenceRecordedDelta): void {
    const extensionDelta = freezeLinkedDelta(delta);
    const nodeDelta = freezeDelta({ type: "node-recorded", node: extensionDelta.node });
    const edgeDelta = freezeDelta({ type: "edge-recorded", edge: extensionDelta.edge });
    enqueue({
      baseDeltas: Object.freeze([nodeDelta, edgeDelta]),
      extensionDelta,
    });
  }

  function collectReachableNodeIds(rootNodeId: string): Set<string> {
    const reachable = new Set<string>();
    const pending = [rootNodeId];

    while (pending.length > 0) {
      const nodeId = pending.pop();

      if (!nodeId || reachable.has(nodeId) || !nodes.has(nodeId)) {
        continue;
      }

      reachable.add(nodeId);

      for (const edgeId of outgoingEdgeIds.get(nodeId) ?? []) {
        const edge = edges.get(edgeId);

        if (edge) {
          pending.push(edge.toNodeId);
        }
      }
    }

    return reachable;
  }

  function addEdgeReference(messageId: string, edgeId: string): void {
    const references = edgeMessageIds.get(edgeId) ?? new Set<string>();

    if (references.has(messageId)) {
      return;
    }

    references.add(messageId);
    edgeMessageIds.set(edgeId, references);
    const referencedEdges = messageEdgeIds.get(messageId) ?? new Set<string>();
    referencedEdges.add(edgeId);
    messageEdgeIds.set(messageId, referencedEdges);
  }

  function attachMessageToGraph(messageId: string, startNodeId: string): void {
    const pending = [startNodeId];

    while (pending.length > 0) {
      const nodeId = pending.pop();

      if (!nodeId) {
        continue;
      }

      const references = nodeMessageIds.get(nodeId) ?? new Set<string>();

      if (references.has(messageId)) {
        continue;
      }

      references.add(messageId);
      nodeMessageIds.set(nodeId, references);
      const referencedNodes = messageNodeIds.get(messageId) ?? new Set<string>();
      referencedNodes.add(nodeId);
      messageNodeIds.set(messageId, referencedNodes);
      pendingNodeIds.delete(nodeId);

      for (const edgeId of outgoingEdgeIds.get(nodeId) ?? []) {
        const edge = edges.get(edgeId);

        if (edge) {
          addEdgeReference(messageId, edgeId);
          pending.push(edge.toNodeId);
        }
      }
    }
  }

  function removeEdge(edgeId: string): CausalityEdge | undefined {
    const edge = edges.get(edgeId);

    if (!edge) {
      return undefined;
    }

    edges.delete(edgeId);
    edgeIdsByEndpoints.delete(`${edge.fromNodeId}\0${edge.toNodeId}`);
    outgoingEdgeIds.get(edge.fromNodeId)?.delete(edgeId);
    incomingEdgeIds.get(edge.toNodeId)?.delete(edgeId);

    for (const messageId of edgeMessageIds.get(edgeId) ?? []) {
      messageEdgeIds.get(messageId)?.delete(edgeId);
    }

    edgeMessageIds.delete(edgeId);
    return edge;
  }

  function removeNode(nodeId: string): {
    readonly node?: CausalityNode;
    readonly edges: readonly CausalityEdge[];
  } {
    const node = nodes.get(nodeId);

    if (!node) {
      return { edges: [] };
    }

    const incidentEdgeIds = new Set([
      ...(outgoingEdgeIds.get(nodeId) ?? []),
      ...(incomingEdgeIds.get(nodeId) ?? []),
    ]);
    const removedEdges = [...incidentEdgeIds].flatMap((edgeId) => {
      const edge = removeEdge(edgeId);
      return edge ? [edge] : [];
    });

    for (const messageId of nodeMessageIds.get(nodeId) ?? []) {
      messageNodeIds.get(messageId)?.delete(nodeId);
    }

    nodes.delete(nodeId);
    outgoingEdgeIds.delete(nodeId);
    incomingEdgeIds.delete(nodeId);
    nodeMessageIds.delete(nodeId);
    pendingNodeIds.delete(nodeId);
    return { node, edges: removedEdges };
  }

  function prunePendingNodes(): void {
    while (pendingNodeIds.size > maxPendingNodes) {
      const nodeId = pendingNodeIds.values().next().value;

      if (typeof nodeId !== "string") {
        return;
      }

      const removal = removeNode(nodeId);
      const removedNodes = removal.node ? [removal.node] : [];
      notify({
        type: "evidence-removed",
        reason: "pending-capacity",
        removedNodeIds: removedNodes.map((node) => node.id),
        removedEdgeIds: removal.edges.map((edge) => edge.id),
        removedNodes,
        removedEdges: removal.edges,
      });
    }
  }

  function retainMessage(messageId: string): void {
    assertActive();

    if (messageId.length === 0) {
      throw new Error("Retained messageId must be a non-empty string.");
    }

    if (retainedMessageIds.has(messageId)) {
      throw new Error(`Message ${messageId} is already retained.`);
    }

    retainedMessageIds.add(messageId);
  }

  function recordNode(input: CausalityNodeInput): CausalityNode {
    assertActive();

    if (input.messageId !== undefined && input.kind !== "transport.received") {
      throw new Error("Only transport.received nodes may own a messageId.");
    }

    if (input.kind === "transport.received" && input.messageId === undefined) {
      throw new Error("transport.received nodes require a messageId.");
    }

    if (input.kind === "transport.received" && input.messageId?.length === 0) {
      throw new Error("transport.received messageId must be a non-empty string.");
    }

    if (input.messageId !== undefined && !retainedMessageIds.has(input.messageId)) {
      throw new Error(`Message ${input.messageId} is not retained.`);
    }

    if (input.messageId !== undefined && messageRootIds.has(input.messageId)) {
      throw new Error(`A transport node already exists for message ${input.messageId}.`);
    }

    nextNodeSequence += 1;
    const node = freezeNode({
      id: `causality-node-${nextNodeSequence}`,
      kind: input.kind,
      timestamp: input.timestamp ?? now(),
      messageId: input.messageId,
      source: { ...input.source },
      attributes: { ...input.attributes },
    });

    nodes.set(node.id, node);

    if (node.messageId !== undefined) {
      messageRootIds.set(node.messageId, node.id);
      attachMessageToGraph(node.messageId, node.id);
    } else {
      pendingNodeIds.add(node.id);
      prunePendingNodes();
    }

    notify({ type: "node-recorded", node });
    return node;
  }

  function recordEdge(input: CausalityEdgeInput): CausalityEdge {
    assertActive();

    if (!nodes.has(input.fromNodeId) || !nodes.has(input.toNodeId)) {
      throw new Error("Causality edges must reference recorded nodes.");
    }

    if (input.confidence === "unavailable") {
      throw new Error("Causality edges require an observed confidence.");
    }

    if (nodes.get(input.toNodeId)?.kind === "transport.received") {
      throw new Error("Causality edges must not target a transport root.");
    }

    const endpointKey = `${input.fromNodeId}\0${input.toNodeId}`;

    if (edgeIdsByEndpoints.has(endpointKey)) {
      throw new Error("Causality edges must not duplicate endpoints.");
    }

    if (
      input.fromNodeId === input.toNodeId ||
      collectReachableNodeIds(input.toNodeId).has(input.fromNodeId)
    ) {
      throw new Error("Causality edges must not create a cycle.");
    }

    nextEdgeSequence += 1;
    const edge = Object.freeze({
      id: `causality-edge-${nextEdgeSequence}`,
      ...input,
    });

    edges.set(edge.id, edge);
    edgeIdsByEndpoints.set(endpointKey, edge.id);
    const outgoing = outgoingEdgeIds.get(edge.fromNodeId) ?? new Set<string>();
    outgoing.add(edge.id);
    outgoingEdgeIds.set(edge.fromNodeId, outgoing);
    const incoming = incomingEdgeIds.get(edge.toNodeId) ?? new Set<string>();
    incoming.add(edge.id);
    incomingEdgeIds.set(edge.toNodeId, incoming);

    for (const messageId of nodeMessageIds.get(edge.fromNodeId) ?? []) {
      addEdgeReference(messageId, edge.id);
      attachMessageToGraph(messageId, edge.toNodeId);
    }

    notify({ type: "edge-recorded", edge });
    return edge;
  }

  function recordLinkedNode(
    input: CausalityLinkedNodeInput,
    context: CausalityContext,
  ): CausalityLinkedNode {
    assertActive();

    // Materialize every caller-controlled value before reading graph indexes or
    // reserving identifiers. Getters and the clock are allowed to reenter the
    // store, so any context or map reference observed before this point may be
    // stale when control returns.
    const messageId = context.messageId;
    const activeNodeId = context.activeNodeId;
    const nodeInput = {
      kind: input.node.kind as CausalityEventKind,
      timestamp: input.node.timestamp ?? now(),
      source: { ...input.node.source },
      attributes: { ...input.node.attributes },
    };
    const edgeInput = {
      confidence: input.edge.confidence,
      correlationMethod: input.edge.correlationMethod,
      reason: input.edge.reason,
    };

    assertActive();

    if (nodeInput.kind === "transport.received") {
      throw new Error("Linked causality evidence must not create a transport root.");
    }

    if (!retainedMessageIds.has(messageId)) {
      throw new Error(`Message ${messageId} is not retained.`);
    }

    if (!hasReachableNode(messageId, activeNodeId)) {
      throw new Error("Linked causality evidence requires a retained message trace node.");
    }

    const parentMessageIds = nodeMessageIds.get(activeNodeId);

    if (!parentMessageIds) {
      throw new Error("Linked causality evidence requires a retained message trace node.");
    }

    const linkedMessageNodeIds = [...parentMessageIds].map((associatedMessageId) => {
      const referencedNodes = messageNodeIds.get(associatedMessageId);

      if (!referencedNodes) {
        throw new Error("Linked causality evidence requires a retained message trace.");
      }

      return { associatedMessageId, referencedNodes };
    });

    if (edgeInput.confidence === "unavailable") {
      throw new Error("Causality edges require an observed confidence.");
    }

    const nodeId = `causality-node-${nextNodeSequence + 1}`;
    const edgeId = `causality-edge-${nextEdgeSequence + 1}`;
    const node = freezeNode({
      id: nodeId,
      ...nodeInput,
    });
    const endpointKey = `${activeNodeId}\0${node.id}`;

    if (edgeIdsByEndpoints.has(endpointKey)) {
      throw new Error("Causality edges must not duplicate endpoints.");
    }

    const edge = Object.freeze({
      id: edgeId,
      fromNodeId: activeNodeId,
      toNodeId: node.id,
      ...edgeInput,
    });

    // Nothing above mutates store state. Commit the node, edge, and message
    // indexes together so observers never receive an unattached child node.
    nextNodeSequence += 1;
    nextEdgeSequence += 1;
    nodes.set(node.id, node);
    edges.set(edge.id, edge);
    edgeIdsByEndpoints.set(endpointKey, edge.id);

    const outgoing = outgoingEdgeIds.get(edge.fromNodeId) ?? new Set<string>();
    outgoing.add(edge.id);
    outgoingEdgeIds.set(edge.fromNodeId, outgoing);
    const incoming = incomingEdgeIds.get(edge.toNodeId) ?? new Set<string>();
    incoming.add(edge.id);
    incomingEdgeIds.set(edge.toNodeId, incoming);

    nodeMessageIds.set(node.id, new Set(parentMessageIds));

    for (const { associatedMessageId, referencedNodes } of linkedMessageNodeIds) {
      referencedNodes.add(node.id);
      addEdgeReference(associatedMessageId, edge.id);
    }

    const result = Object.freeze({ node, edge });
    notifyLinkedEvidence({ type: "linked-evidence-recorded", ...result });
    return result;
  }

  function materializePath(state: PathState): CausalityTracePath {
    const nodeIds: string[] = [];
    const edgeIds: string[] = [];
    let current: PathState | undefined = state;

    while (current) {
      nodeIds.push(current.nodeId);

      if (current.viaEdgeId) {
        edgeIds.push(current.viaEdgeId);
      }

      current = current.parent;
    }

    nodeIds.reverse();
    edgeIds.reverse();
    return Object.freeze({
      nodeIds: Object.freeze(nodeIds),
      edgeIds: Object.freeze(edgeIds),
      confidence: state.confidence ?? "unavailable",
    });
  }

  function getTrace(messageId: string): CausalityTrace | undefined {
    const rootNodeId = messageRootIds.get(messageId);
    const referencedNodeIds = messageNodeIds.get(messageId);

    if (!rootNodeId || !referencedNodeIds) {
      return undefined;
    }

    const referencedEdgeIds = messageEdgeIds.get(messageId) ?? new Set<string>();
    const traceNodes = [...referencedNodeIds].toSorted(compareEvidenceIds).flatMap((nodeId) => {
      const node = nodes.get(nodeId);
      return node ? [node] : [];
    });
    const traceEdges = [...referencedEdgeIds].toSorted(compareEvidenceIds).flatMap((edgeId) => {
      const edge = edges.get(edgeId);
      return edge ? [edge] : [];
    });
    const paths: CausalityTracePath[] = [];
    const pendingPaths: PathState[] = [{ nodeId: rootNodeId }];

    while (pendingPaths.length > 0 && paths.length < maxTracePaths) {
      const state = pendingPaths.pop();

      if (!state) {
        continue;
      }

      const outgoing = [...(outgoingEdgeIds.get(state.nodeId) ?? [])].flatMap((edgeId) => {
        const edge = referencedEdgeIds.has(edgeId) ? edges.get(edgeId) : undefined;
        return edge ? [edge] : [];
      });

      if (outgoing.length === 0) {
        paths.push(materializePath(state));
        continue;
      }

      for (const edge of outgoing.toReversed()) {
        pendingPaths.push({
          nodeId: edge.toNodeId,
          parent: state,
          viaEdgeId: edge.id,
          confidence: state.confidence
            ? getWeakestCausalityConfidence([state.confidence, edge.confidence])
            : edge.confidence,
        });
      }
    }

    return Object.freeze({
      messageId,
      rootNodeId,
      nodes: Object.freeze(traceNodes),
      edges: Object.freeze(traceEdges),
      paths: Object.freeze(paths),
      truncated: pendingPaths.length > 0,
      confidence: getWeakestCausalityConfidence(traceEdges.map((edge) => edge.confidence)),
    });
  }

  function hasReachableNode(messageId: string, nodeId: string): boolean {
    return messageRootIds.has(messageId) && (nodeMessageIds.get(nodeId)?.has(messageId) ?? false);
  }

  function subscribe(listener: CausalityGraphDeltaListener): () => void {
    assertActive();
    baseListeners.add(listener);

    return () => {
      baseListeners.delete(listener);
    };
  }

  function subscribeLinkedEvidence(
    listener: CausalityLinkedEvidenceGraphDeltaListener,
  ): () => void {
    assertActive();
    linkedListeners.add(listener);

    return () => {
      linkedListeners.delete(listener);
    };
  }

  function evictMessage(messageId: string): void {
    assertActive();

    if (!retainedMessageIds.delete(messageId)) {
      return;
    }

    const referencedEdgeIds = messageEdgeIds.get(messageId) ?? new Set<string>();
    const removedEdgesById = new Map<string, CausalityEdge>();

    for (const edgeId of referencedEdgeIds) {
      const edge = edges.get(edgeId);
      const references = edgeMessageIds.get(edgeId);
      references?.delete(messageId);

      if (edge && references?.size === 0) {
        removedEdgesById.set(edge.id, edge);
      }
    }

    const referencedNodeIds = messageNodeIds.get(messageId) ?? new Set<string>();
    const removedNodes: CausalityNode[] = [];

    for (const nodeId of referencedNodeIds) {
      const node = nodes.get(nodeId);
      const references = nodeMessageIds.get(nodeId);
      references?.delete(messageId);

      if (node && references?.size === 0) {
        removedNodes.push(node);
      }
    }

    messageEdgeIds.delete(messageId);
    messageNodeIds.delete(messageId);
    messageRootIds.delete(messageId);

    for (const edge of removedEdgesById.values()) {
      removeEdge(edge.id);
    }

    for (const node of removedNodes) {
      const removal = removeNode(node.id);

      for (const edge of removal.edges) {
        removedEdgesById.set(edge.id, edge);
      }
    }

    if (compactAfterEvictions !== undefined) {
      evictionsSinceCompaction += 1;

      if (evictionsSinceCompaction >= compactAfterEvictions) {
        compactIndexes();
        evictionsSinceCompaction = 0;
      }
    }

    const removedEdges = [...removedEdgesById.values()].toSorted((left, right) =>
      compareEvidenceIds(left.id, right.id),
    );

    notify({
      type: "message-evicted",
      messageId,
      removedNodeIds: removedNodes.map((node) => node.id),
      removedEdgeIds: removedEdges.map((edge) => edge.id),
      removedNodes,
      removedEdges,
    });
  }

  function clear(): void {
    assertActive();
    nodes.clear();
    edges.clear();
    outgoingEdgeIds.clear();
    incomingEdgeIds.clear();
    edgeIdsByEndpoints.clear();
    retainedMessageIds.clear();
    messageRootIds.clear();
    messageNodeIds.clear();
    messageEdgeIds.clear();
    nodeMessageIds.clear();
    edgeMessageIds.clear();
    pendingNodeIds.clear();
    evictionsSinceCompaction = 0;
    notify({ type: "cleared" });
  }

  function dispose(): void {
    if (disposed) {
      return;
    }

    disposed = true;
    nodes.clear();
    edges.clear();
    outgoingEdgeIds.clear();
    incomingEdgeIds.clear();
    edgeIdsByEndpoints.clear();
    retainedMessageIds.clear();
    messageRootIds.clear();
    messageNodeIds.clear();
    messageEdgeIds.clear();
    nodeMessageIds.clear();
    edgeMessageIds.clear();
    pendingNodeIds.clear();
    evictionsSinceCompaction = 0;
    notify({ type: "disposed" });

    if (notifying) {
      clearListenersAfterNotification = true;
      return;
    }

    baseListeners.clear();
    linkedListeners.clear();
  }

  return {
    clear,
    dispose,
    evictMessage,
    getTrace,
    hasReachableNode,
    recordEdge,
    recordLinkedNode,
    recordNode,
    retainMessage,
    subscribe,
    subscribeLinkedEvidence,
  };
}
