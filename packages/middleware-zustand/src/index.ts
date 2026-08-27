import {
  browseSentEventCausalityLinkedEvidenceCapability,
  hasBrowseSentEventCausalityLinkedEvidenceBridge,
  subscribeBrowseSentEventCausalityAvailability,
  type BrowseSentEventCausalityLinkedEvidenceBridge,
  type CausalityContext,
} from "@browse-sent-event/core";
import type { StateCreator, StoreApi } from "zustand/vanilla";

export interface TraceZustandOptions {
  /** Stable, app-chosen store identifier. State values are never captured. */
  readonly storeId: string;
  /** Test or multi-realm target for core's causality availability envelope. */
  readonly target?: object;
}

export interface TraceZustandMiddleware {
  <T>(initializer: StateCreator<T>): StateCreator<T>;
  /** Stops bridge discovery. Existing stores continue with native Zustand behavior. */
  dispose(): void;
}

interface SetEvidence<T> {
  readonly activeContext: CausalityContext;
  readonly actionLabel?: string;
  readonly beforeState: T;
  readonly bridge: BrowseSentEventCausalityLinkedEvidenceBridge;
  readonly startedNodeId: string;
  readonly replace: boolean;
}

const tracedSetStateMarker = Symbol.for("@browse-sent-event/zustand/traced-set-state");

function isTracedSetState(value: unknown): boolean {
  if (typeof value !== "function") {
    return false;
  }

  try {
    return Reflect.get(value, tracedSetStateMarker) === true;
  } catch {
    return false;
  }
}

function getActiveContext(
  bridge: BrowseSentEventCausalityLinkedEvidenceBridge | undefined,
): CausalityContext | undefined {
  if (!bridge) {
    return undefined;
  }

  try {
    return bridge.getActiveContext();
  } catch {
    return undefined;
  }
}

function beginSetEvidence<T>(
  bridge: BrowseSentEventCausalityLinkedEvidenceBridge | undefined,
  getState: () => T,
  storeId: string,
  replace: boolean,
  actionLabel: string | undefined,
): SetEvidence<T> | undefined {
  const activeContext = getActiveContext(bridge);

  if (!bridge || !activeContext) {
    return undefined;
  }

  try {
    const trace = bridge.getTrace(activeContext.messageId);

    if (!trace?.nodes.some((node) => node.id === activeContext.activeNodeId)) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  let beforeState: T;

  try {
    beforeState = getState();
  } catch {
    return undefined;
  }

  try {
    const started = bridge.runWithContext(activeContext, () =>
      bridge.recordLinkedNode({
        node: {
          kind: "zustand.set-started",
          source: { adapter: "zustand", instanceId: storeId },
          attributes: {
            storeId,
            replace,
            ...(actionLabel === undefined ? {} : { actionLabel }),
          },
        },
        edge: {
          confidence: "definitive",
          correlationMethod: "same-call-stack",
          reason: "Zustand set executed in the active synchronous handler context.",
        },
      }),
    );

    return {
      activeContext,
      actionLabel,
      beforeState,
      bridge,
      startedNodeId: started.node.id,
      replace,
    };
  } catch {
    // Instrumentation is strictly observational: a stale or hostile adapter
    // must not alter the store update path.
    return undefined;
  }
}

function completeSetEvidence<T>(
  evidence: SetEvidence<T> | undefined,
  getState: () => T,
  storeId: string,
  didThrow: boolean,
): void {
  if (!evidence) {
    return;
  }

  try {
    const trace = evidence.bridge.getTrace(evidence.activeContext.messageId);

    if (!trace?.nodes.some((node) => node.id === evidence.startedNodeId)) {
      return;
    }
  } catch {
    return;
  }

  let rootIdentityChanged: boolean | null = null;

  try {
    rootIdentityChanged = !Object.is(evidence.beforeState, getState());
  } catch {
    // Reading an exotic store must not surface an adapter error to the app.
  }

  try {
    const completed = evidence.bridge.runWithContext(
      {
        messageId: evidence.activeContext.messageId,
        activeNodeId: evidence.startedNodeId,
      },
      () =>
        evidence.bridge.recordLinkedNode({
          node: {
            kind: "zustand.set-completed",
            source: { adapter: "zustand", instanceId: storeId },
            attributes: {
              storeId,
              replace: evidence.replace,
              rootIdentityChanged,
              ...(evidence.actionLabel === undefined ? {} : { actionLabel: evidence.actionLabel }),
            },
          },
          edge: {
            confidence: "definitive",
            correlationMethod: "same-call-stack",
            reason: didThrow
              ? "Zustand set threw in the active synchronous handler context."
              : "Zustand set returned in the active synchronous handler context.",
          },
        }),
    );

    if (!rootIdentityChanged) {
      return;
    }

    evidence.bridge.runWithContext(
      {
        messageId: evidence.activeContext.messageId,
        activeNodeId: completed.node.id,
      },
      () =>
        evidence.bridge.recordLinkedNode({
          node: {
            kind: "state.root-changed",
            source: { adapter: "zustand", instanceId: storeId },
            attributes: {
              storeId,
              replace: evidence.replace,
              rootIdentityChanged: true,
              ...(evidence.actionLabel === undefined ? {} : { actionLabel: evidence.actionLabel }),
            },
          },
          edge: {
            confidence: "definitive",
            correlationMethod: "same-call-stack",
            reason:
              "Zustand state root identity changed during the active synchronous handler context.",
          },
        }),
    );
  } catch {
    // A runtime can be disposed between set start and completion. Do not let
    // that turn a successful Zustand update into an application error.
  }
}

function createTracedSetState<T>(
  setState: StoreApi<T>["setState"],
  getState: () => T,
  storeId: string,
  getBridge: () => BrowseSentEventCausalityLinkedEvidenceBridge | undefined,
): StoreApi<T>["setState"] {
  if (isTracedSetState(setState)) {
    return setState;
  }

  const tracedSetState = function tracedSetState(this: unknown, ...args: unknown[]) {
    const actionLabel = typeof args[2] === "string" ? args[2] : undefined;
    const evidence = beginSetEvidence(
      getBridge(),
      getState,
      storeId,
      args[1] === true,
      actionLabel,
    );
    let callbackInvoked = false;
    let callbackThrew = false;
    let callbackResult: unknown;

    const invokeOriginalSetState = (): unknown => {
      callbackInvoked = true;

      try {
        callbackResult = Reflect.apply(setState, this, args);
        return callbackResult;
      } catch (error) {
        callbackThrew = true;
        throw error;
      }
    };

    try {
      if (!evidence) {
        return invokeOriginalSetState();
      }

      try {
        return evidence.bridge.runWithContext(
          {
            messageId: evidence.activeContext.messageId,
            activeNodeId: evidence.startedNodeId,
          },
          invokeOriginalSetState,
        );
      } catch (error) {
        if (!callbackInvoked) {
          return invokeOriginalSetState();
        }

        if (callbackThrew) {
          throw error;
        }

        // If bridge teardown failed after the canonical setter returned, the
        // application still observes the original setter result.
        return callbackResult;
      }
    } finally {
      completeSetEvidence(evidence, getState, storeId, callbackThrew);
    }
  };

  Object.defineProperty(tracedSetState, tracedSetStateMarker, { value: true });
  return tracedSetState as StoreApi<T>["setState"];
}

/**
 * Opt-in M1 middleware. It records only synchronous calls inside an active
 * core handler context and only asserts a state edge when the store root
 * identity changes. It never captures state values.
 */
export function traceZustand(options: TraceZustandOptions): TraceZustandMiddleware {
  const target = options.target ?? globalThis;
  let bridge: BrowseSentEventCausalityLinkedEvidenceBridge | undefined;
  let disposed = false;
  let unsubscribe: (() => void) | undefined;

  try {
    unsubscribe = subscribeBrowseSentEventCausalityAvailability(
      (availability) => {
        bridge =
          !disposed &&
          availability.status === "available" &&
          hasBrowseSentEventCausalityLinkedEvidenceBridge(availability.envelope.bridge)
            ? availability.envelope.bridge
            : undefined;
      },
      target,
      {
        capabilities: [browseSentEventCausalityLinkedEvidenceCapability],
      },
    );
  } catch {
    // Discovery is best-effort. Middleware construction remains usable before
    // core bootstrap or in a foreign realm that rejects global access.
  }

  const middleware: TraceZustandMiddleware = <T>(initializer: StateCreator<T>): StateCreator<T> => {
    return (setState, getState, store) => {
      const tracedSetState = createTracedSetState(
        setState,
        getState,
        options.storeId,
        () => bridge,
      );
      const originalApiSetState = store.setState;

      store.setState =
        setState === originalApiSetState
          ? tracedSetState
          : createTracedSetState(
              originalApiSetState,
              store.getState,
              options.storeId,
              () => bridge,
            );

      return initializer(tracedSetState, getState, store);
    };
  };

  middleware.dispose = (): void => {
    if (disposed) {
      return;
    }

    disposed = true;
    bridge = undefined;
    unsubscribe?.();
    unsubscribe = undefined;
  };

  return middleware;
}
