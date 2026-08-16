export type CausalityEventKind =
  | "transport.received"
  | "handler.started"
  | "handler.returned"
  | "zustand.set-started"
  | "zustand.set-completed"
  | "state.root-changed"
  | "react.commit-observed"
  | "adapter.diagnostic";

export type CausalityConfidence = "definitive" | "adapter-backed" | "heuristic" | "unavailable";

export type CorrelationMethod =
  | "same-native-event"
  | "same-call-stack"
  | "pending-react-commit"
  | "time-window";

export type CausalityAdapter = "core" | "websocket" | "zustand" | "react";

export type CausalityAttributeValue = string | number | boolean | null;

export interface CausalitySource {
  readonly adapter: CausalityAdapter;
  readonly instanceId?: string;
  readonly label?: string;
  readonly version?: string;
}

export interface CausalityNode {
  readonly id: string;
  readonly kind: CausalityEventKind;
  readonly timestamp: number;
  readonly messageId?: string;
  readonly source: CausalitySource;
  readonly attributes: Readonly<Record<string, CausalityAttributeValue>>;
}

export interface CausalityNodeInput {
  readonly kind: CausalityEventKind;
  readonly timestamp?: number;
  readonly messageId?: string;
  readonly source: CausalitySource;
  readonly attributes?: Readonly<Record<string, CausalityAttributeValue>>;
}

export interface CausalityEdge {
  readonly id: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly confidence: CausalityConfidence;
  readonly correlationMethod: CorrelationMethod;
  readonly reason: string;
}

export interface CausalityEdgeInput {
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly confidence: CausalityConfidence;
  readonly correlationMethod: CorrelationMethod;
  readonly reason: string;
}

export interface CausalityContext {
  readonly messageId: string;
  readonly activeNodeId: string;
}

export interface CausalityTracePath {
  readonly nodeIds: readonly string[];
  readonly edgeIds: readonly string[];
  readonly confidence: CausalityConfidence;
}

export interface CausalityTrace {
  readonly messageId: string;
  readonly rootNodeId: string;
  readonly nodes: readonly CausalityNode[];
  readonly edges: readonly CausalityEdge[];
  readonly paths: readonly CausalityTracePath[];
  readonly truncated: boolean;
  readonly confidence: CausalityConfidence;
}

export type CausalityGraphDelta =
  | { readonly type: "node-recorded"; readonly node: CausalityNode }
  | { readonly type: "edge-recorded"; readonly edge: CausalityEdge }
  | {
      readonly type: "message-evicted";
      readonly messageId: string;
      readonly removedNodeIds: readonly string[];
      readonly removedEdgeIds: readonly string[];
      readonly removedNodes: readonly CausalityNode[];
      readonly removedEdges: readonly CausalityEdge[];
    }
  | {
      readonly type: "evidence-removed";
      readonly reason: "pending-capacity";
      readonly removedNodeIds: readonly string[];
      readonly removedEdgeIds: readonly string[];
      readonly removedNodes: readonly CausalityNode[];
      readonly removedEdges: readonly CausalityEdge[];
    }
  | { readonly type: "cleared" }
  | { readonly type: "disposed" };

export type CausalityGraphDeltaListener = (delta: CausalityGraphDelta) => void;

export type CausalityLifecycleStatus =
  | "awaiting-handler"
  | "handler-observed"
  | "state-observed"
  | "commit-candidate-observed";

export interface CausalityLifecycle {
  readonly status: CausalityLifecycleStatus;
  readonly confidence: CausalityConfidence;
}
