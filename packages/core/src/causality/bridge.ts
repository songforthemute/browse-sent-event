import { createCausalityContextStack } from "./context.js";
import type { SynchronousObserverInput } from "../observer.js";
import type {
  CausalityContext,
  CausalityEdge,
  CausalityEdgeInput,
  CausalityGraphDelta,
  CausalityGraphDeltaListener,
  CausalityLinkedEvidenceGraphDelta,
  CausalityLinkedEvidenceGraphDeltaListener,
  CausalityLinkedNode,
  CausalityLinkedNodeInput,
  CausalityNode,
  CausalityNodeInput,
  CausalityTrace,
} from "./model.js";
import { createCausalityTraceStore, type CausalityTraceStoreOptions } from "./trace-store.js";

export interface BrowseSentEventCausalityBridge {
  getActiveContext(): CausalityContext | undefined;
  runWithContext<T>(context: CausalityContext, callback: () => T): T;
  recordNode(input: CausalityNodeInput): CausalityNode;
  recordEdge(input: CausalityEdgeInput): CausalityEdge;
  getTrace(messageId: string): CausalityTrace | undefined;
  subscribeEvidence<Listener extends CausalityGraphDeltaListener>(
    listener: SynchronousObserverInput<CausalityGraphDelta, Listener>,
  ): () => void;
}

export interface BrowseSentEventCausalityLinkedEvidenceBridge extends BrowseSentEventCausalityBridge {
  recordLinkedNode(input: CausalityLinkedNodeInput): CausalityLinkedNode;
  /** Receives every bridge-v1 delta plus atomic linked-evidence deltas. */
  subscribeLinkedEvidence<Listener extends CausalityLinkedEvidenceGraphDeltaListener>(
    listener: SynchronousObserverInput<CausalityLinkedEvidenceGraphDelta, Listener>,
  ): () => void;
}

export function hasBrowseSentEventCausalityLinkedEvidenceBridge(
  bridge: BrowseSentEventCausalityBridge,
): bridge is BrowseSentEventCausalityLinkedEvidenceBridge {
  try {
    return (
      typeof Reflect.get(bridge, "recordLinkedNode") === "function" &&
      typeof Reflect.get(bridge, "subscribeLinkedEvidence") === "function"
    );
  } catch {
    return false;
  }
}

export interface BrowseSentEventCausalityController extends BrowseSentEventCausalityLinkedEvidenceBridge {
  retainMessage(messageId: string): void;
  evictMessage(messageId: string): void;
  clear(): void;
  dispose(): void;
}

export function createBrowseSentEventCausalityBridge(
  options: CausalityTraceStoreOptions = {},
): BrowseSentEventCausalityController {
  const contextStack = createCausalityContextStack();
  const traceStore = createCausalityTraceStore(options);
  let disposed = false;

  function clear(): void {
    contextStack.clear();
    traceStore.clear();
  }

  function dispose(): void {
    if (disposed) {
      return;
    }

    contextStack.dispose();
    traceStore.dispose();
    disposed = true;
  }

  return {
    clear,
    dispose,
    evictMessage: (messageId) => traceStore.evictMessage(messageId),
    getActiveContext: () => contextStack.getActiveContext(),
    getTrace: (messageId) => traceStore.getTrace(messageId),
    recordEdge: (input) => traceStore.recordEdge(input),
    recordLinkedNode: (input) => {
      const context = contextStack.getActiveContext();

      if (!context) {
        throw new Error("Linked causality evidence requires an active context.");
      }

      return traceStore.recordLinkedNode(input, context);
    },
    recordNode: (input) => traceStore.recordNode(input),
    retainMessage: (messageId) => traceStore.retainMessage(messageId),
    runWithContext: (context, callback) => {
      if (disposed) {
        throw new Error("Causality context stack is disposed.");
      }

      if (!traceStore.hasReachableNode(context.messageId, context.activeNodeId)) {
        throw new Error("Causality context must reference a retained message trace node.");
      }

      return contextStack.runWithContext(context, callback);
    },
    subscribeEvidence: (listener) => traceStore.subscribe(listener),
    subscribeLinkedEvidence: (listener) => traceStore.subscribeLinkedEvidence(listener),
  };
}

export function createCausalityBridgeView(
  controller: BrowseSentEventCausalityController,
): BrowseSentEventCausalityLinkedEvidenceBridge {
  return Object.freeze({
    getActiveContext: (): CausalityContext | undefined => controller.getActiveContext(),
    getTrace: (messageId: string): CausalityTrace | undefined => controller.getTrace(messageId),
    recordEdge: (input: CausalityEdgeInput): CausalityEdge => controller.recordEdge(input),
    recordLinkedNode: (input: CausalityLinkedNodeInput): CausalityLinkedNode =>
      controller.recordLinkedNode(input),
    recordNode: (input: CausalityNodeInput): CausalityNode => controller.recordNode(input),
    runWithContext<T>(context: CausalityContext, callback: () => T): T {
      return controller.runWithContext(context, callback);
    },
    subscribeEvidence<Listener extends CausalityGraphDeltaListener>(
      listener: SynchronousObserverInput<CausalityGraphDelta, Listener>,
    ): () => void {
      return controller.subscribeEvidence(listener);
    },
    subscribeLinkedEvidence<Listener extends CausalityLinkedEvidenceGraphDeltaListener>(
      listener: SynchronousObserverInput<CausalityLinkedEvidenceGraphDelta, Listener>,
    ): () => void {
      return controller.subscribeLinkedEvidence(listener);
    },
  });
}
