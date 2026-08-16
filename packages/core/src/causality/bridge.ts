import { createCausalityContextStack } from "./context.js";
import type {
  CausalityContext,
  CausalityEdge,
  CausalityEdgeInput,
  CausalityGraphDeltaListener,
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
  subscribeEvidence(listener: CausalityGraphDeltaListener): () => void;
}

export interface BrowseSentEventCausalityController extends BrowseSentEventCausalityBridge {
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
  };
}

export function createCausalityBridgeView(
  controller: BrowseSentEventCausalityController,
): BrowseSentEventCausalityBridge {
  return Object.freeze({
    getActiveContext: (): CausalityContext | undefined => controller.getActiveContext(),
    getTrace: (messageId: string): CausalityTrace | undefined => controller.getTrace(messageId),
    recordEdge: (input: CausalityEdgeInput): CausalityEdge => controller.recordEdge(input),
    recordNode: (input: CausalityNodeInput): CausalityNode => controller.recordNode(input),
    runWithContext<T>(context: CausalityContext, callback: () => T): T {
      return controller.runWithContext(context, callback);
    },
    subscribeEvidence: (listener: CausalityGraphDeltaListener): (() => void) =>
      controller.subscribeEvidence(listener),
  });
}
