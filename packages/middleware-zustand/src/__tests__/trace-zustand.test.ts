import {
  browseSentEventCausalityBridgeCapability,
  browseSentEventCausalityGlobalKey,
  browseSentEventCausalityProtocolVersion,
  createDevtoolsEngine,
  hasBrowseSentEventCausalityLinkedEvidenceBridge,
} from "@browse-sent-event/core";
import { createStore, type StateCreator, type StoreApi } from "zustand/vanilla";
import { describe, expect, it, vi } from "vitest";
import { installBrowseSentEventCausalityEnvelope } from "../../../core/src/causality/global-envelope.js";
import { traceZustand } from "../index.js";

interface CounterState {
  readonly count: number;
  increment(): void;
}

function createMessageContext(engine: ReturnType<typeof createDevtoolsEngine>) {
  const message = engine.recordMessage({
    connectionId: "connection-1",
    direction: "in",
    protocol: "websocket",
    payload: "incoming",
  });
  const transport = engine.causality.recordNode({
    kind: "transport.received",
    messageId: message.id,
    source: { adapter: "websocket" },
  });

  return {
    messageId: message.id,
    run<T>(callback: () => T): T {
      return engine.causality.runWithContext(
        { messageId: message.id, activeNodeId: transport.id },
        callback,
      );
    },
  };
}

function createCounterStore(target: object) {
  const middleware = traceZustand({ storeId: "trades", target });
  const store = createStore<CounterState>()(
    middleware((set) => ({
      count: 0,
      increment: () => set((state) => ({ count: state.count + 1 })),
    })),
  );

  return { middleware, store };
}

function evidenceKinds(engine: ReturnType<typeof createDevtoolsEngine>, messageId: string) {
  return engine.causality.getTrace(messageId)?.nodes.map((node) => node.kind) ?? [];
}

function getLinkedCausalityBridge(engine: ReturnType<typeof createDevtoolsEngine>) {
  const bridge = engine.causality;

  if (!hasBrowseSentEventCausalityLinkedEvidenceBridge(bridge)) {
    throw new Error("Expected the core test engine to expose linked evidence.");
  }

  return bridge;
}

describe("traceZustand", () => {
  it("subscribes before core bootstrap and connects a synchronous initializer set by definitive edges", () => {
    const target = {};
    const engine = createDevtoolsEngine({ capacity: 10 });
    const { middleware, store } = createCounterStore(target);
    const published = installBrowseSentEventCausalityEnvelope(target, engine.causality);
    const context = createMessageContext(engine);
    const linkedEvidence: Array<{
      readonly childNodeId: string;
      readonly nodeId: string;
      readonly parentNodeId: string;
    }> = [];

    getLinkedCausalityBridge(engine).subscribeLinkedEvidence((delta) => {
      if (delta.type === "linked-evidence-recorded") {
        linkedEvidence.push({
          childNodeId: delta.edge.toNodeId,
          nodeId: delta.node.id,
          parentNodeId: delta.edge.fromNodeId,
        });
      }
    });

    context.run(() => store.getState().increment());

    const trace = engine.causality.getTrace(context.messageId);
    expect(trace?.nodes.map((node) => node.kind)).toEqual([
      "transport.received",
      "zustand.set-started",
      "zustand.set-completed",
      "state.root-changed",
    ]);
    expect(trace?.edges).toHaveLength(3);
    expect(trace?.edges.every((edge) => edge.confidence === "definitive")).toBe(true);
    expect(trace?.edges.every((edge) => edge.correlationMethod === "same-call-stack")).toBe(true);
    expect(trace?.nodes.at(-1)).toMatchObject({
      source: { adapter: "zustand", instanceId: "trades" },
      attributes: { storeId: "trades", rootIdentityChanged: true },
    });
    expect(linkedEvidence).toHaveLength(3);
    expect(linkedEvidence.map((evidence) => evidence.childNodeId)).toEqual(
      linkedEvidence.map((evidence) => evidence.nodeId),
    );
    expect(linkedEvidence[1]?.parentNodeId).toBe(linkedEvidence[0]?.nodeId);
    expect(linkedEvidence[2]?.parentNodeId).toBe(linkedEvidence[1]?.nodeId);

    middleware.dispose();
    published.uninstall();
  });

  it("instruments external api.setState exactly once and omits root evidence when identity is unchanged", () => {
    const target = {};
    const engine = createDevtoolsEngine({ capacity: 10 });
    const published = installBrowseSentEventCausalityEnvelope(target, engine.causality);
    const { middleware, store } = createCounterStore(target);
    const context = createMessageContext(engine);

    context.run(() => store.setState(store.getState(), true));

    const trace = engine.causality.getTrace(context.messageId);
    expect(trace?.nodes.map((node) => node.kind)).toEqual([
      "transport.received",
      "zustand.set-started",
      "zustand.set-completed",
    ]);
    expect(trace?.edges).toHaveLength(2);
    expect(trace?.nodes.at(-1)?.attributes).toMatchObject({
      replace: true,
      rootIdentityChanged: false,
    });

    middleware.dispose();
    published.uninstall();
  });

  it("does not attach handler-external updates or updates after disposal", () => {
    const target = {};
    const engine = createDevtoolsEngine({ capacity: 10 });
    const published = installBrowseSentEventCausalityEnvelope(target, engine.causality);
    const { middleware, store } = createCounterStore(target);
    const context = createMessageContext(engine);

    store.getState().increment();
    expect(evidenceKinds(engine, context.messageId)).toEqual(["transport.received"]);

    middleware.dispose();
    context.run(() => store.getState().increment());
    expect(evidenceKinds(engine, context.messageId)).toEqual(["transport.received"]);

    published.uninstall();
  });

  it("makes a nested api.setState a child of the outer canonical set", () => {
    const target = {};
    const engine = createDevtoolsEngine({ capacity: 10 });
    const published = installBrowseSentEventCausalityEnvelope(target, engine.causality);
    const middleware = traceZustand({ storeId: "nested", target });
    const store = createStore<CounterState>()(
      middleware((set, _get, api) => ({
        count: 0,
        increment: () =>
          set(() => {
            api.setState({ count: 1 });
            return { count: 2 };
          }),
      })),
    );
    const context = createMessageContext(engine);

    context.run(() => store.getState().increment());

    const trace = engine.causality.getTrace(context.messageId);
    const starts = trace?.nodes.filter((node) => node.kind === "zustand.set-started") ?? [];
    expect(starts).toHaveLength(2);
    expect(
      trace?.edges.some(
        (edge) => edge.fromNodeId === starts[0]?.id && edge.toNodeId === starts[1]?.id,
      ),
    ).toBe(true);

    middleware.dispose();
    published.uninstall();
  });

  it("calls a throwing canonical setter once, rethrows its original error, and records completion best-effort", () => {
    const target = {};
    const engine = createDevtoolsEngine({ capacity: 10 });
    const published = installBrowseSentEventCausalityEnvelope(target, engine.causality);
    const middleware = traceZustand({ storeId: "throwing", target });
    const context = createMessageContext(engine);
    const expected = new Error("original setter failed");
    const state: CounterState = { count: 0, increment: () => {} };
    const originalSetState = vi.fn(() => {
      throw expected;
    });
    const api: StoreApi<CounterState> = {
      getInitialState: () => state,
      getState: () => state,
      setState: originalSetState as StoreApi<CounterState>["setState"],
      subscribe: () => () => {},
    };
    let capturedSetState: StoreApi<CounterState>["setState"] | undefined;
    const initializer: StateCreator<CounterState> = (setState) => {
      capturedSetState = setState;
      return { count: 0, increment: () => {} };
    };

    middleware(initializer)(
      originalSetState as StoreApi<CounterState>["setState"],
      api.getState,
      api,
    );

    context.run(() => {
      expect(() => capturedSetState?.({ count: 1 })).toThrow(expected);
    });

    expect(originalSetState).toHaveBeenCalledTimes(1);
    const trace = engine.causality.getTrace(context.messageId);
    expect(trace?.nodes.map((node) => node.kind)).toEqual([
      "transport.received",
      "zustand.set-started",
      "zustand.set-completed",
    ]);

    middleware.dispose();
    published.uninstall();
  });

  it("records a string third-argument action label without inspecting object actions", () => {
    const target = {};
    const engine = createDevtoolsEngine({ capacity: 10 });
    const published = installBrowseSentEventCausalityEnvelope(target, engine.causality);
    const middleware = traceZustand({ storeId: "label", target });
    const store = createStore<CounterState>()(
      middleware((set) => ({
        count: 0,
        increment: () => {
          Reflect.apply(set, undefined, [{ count: 1 }, false, "trade/received"]);
        },
      })),
    );
    const context = createMessageContext(engine);

    context.run(() => store.getState().increment());

    const trace = engine.causality.getTrace(context.messageId);
    expect(trace?.nodes.at(-1)?.attributes).toMatchObject({ actionLabel: "trade/received" });

    middleware.dispose();
    published.uninstall();
  });

  it("does not keep causality context after a Promise boundary", async () => {
    const target = {};
    const engine = createDevtoolsEngine({ capacity: 10 });
    const published = installBrowseSentEventCausalityEnvelope(target, engine.causality);
    const { middleware, store } = createCounterStore(target);
    const context = createMessageContext(engine);

    await context.run(() => Promise.resolve().then(() => store.getState().increment()));

    expect(evidenceKinds(engine, context.messageId)).toEqual(["transport.received"]);

    middleware.dispose();
    published.uninstall();
  });

  it("runs the original setter without evidence when its active message is evicted mid-context", () => {
    const target = {};
    const engine = createDevtoolsEngine({ capacity: 1 });
    const published = installBrowseSentEventCausalityEnvelope(target, engine.causality);
    const { middleware, store } = createCounterStore(target);
    const context = createMessageContext(engine);
    const deltas: string[] = [];
    engine.causality.subscribeEvidence((delta) => {
      if (delta.type === "node-recorded") {
        deltas.push(delta.node.kind);
      }
    });

    context.run(() => {
      engine.recordMessage({
        connectionId: "connection-1",
        direction: "in",
        protocol: "websocket",
        payload: "evicts the active message",
      });
      store.getState().increment();
    });

    expect(store.getState().count).toBe(1);
    expect(deltas).not.toContain("zustand.set-started");
    expect(deltas).not.toContain("zustand.set-completed");
    expect(deltas).not.toContain("state.root-changed");

    middleware.dispose();
    published.uninstall();
  });

  it("does not record completion evidence after a subscriber evicts the active message", () => {
    const target = {};
    const engine = createDevtoolsEngine({ capacity: 1 });
    const published = installBrowseSentEventCausalityEnvelope(target, engine.causality);
    const { middleware, store } = createCounterStore(target);
    const context = createMessageContext(engine);
    const recordedKinds: string[] = [];
    engine.causality.subscribeEvidence((delta) => {
      if (delta.type === "node-recorded") {
        recordedKinds.push(delta.node.kind);
      }
    });
    const unsubscribe = store.subscribe(() => {
      engine.recordMessage({
        connectionId: "connection-1",
        direction: "in",
        protocol: "websocket",
        payload: "evicts during setter",
      });
    });

    context.run(() => store.getState().increment());

    expect(store.getState().count).toBe(1);
    expect(recordedKinds).toEqual(["zustand.set-started"]);

    unsubscribe();
    middleware.dispose();
    published.uninstall();
  });

  it("keeps the started node and parent edge atomic when a legacy subscriber evicts the message", () => {
    const target = {};
    const engine = createDevtoolsEngine({ capacity: 1 });
    const published = installBrowseSentEventCausalityEnvelope(target, engine.causality);
    const { middleware, store } = createCounterStore(target);
    const context = createMessageContext(engine);
    const linkedEvidence: Array<{
      readonly childNodeId: string;
      readonly nodeId: string;
      readonly parentNodeId: string;
    }> = [];

    engine.causality.subscribeEvidence((delta) => {
      if (delta.type === "node-recorded" && delta.node.kind === "zustand.set-started") {
        engine.recordMessage({
          connectionId: "connection-1",
          direction: "in",
          protocol: "websocket",
          payload: "evicts during evidence notification",
        });
      }
    });
    getLinkedCausalityBridge(engine).subscribeLinkedEvidence((delta) => {
      if (delta.type === "linked-evidence-recorded" && delta.node.kind === "zustand.set-started") {
        linkedEvidence.push({
          childNodeId: delta.edge.toNodeId,
          nodeId: delta.node.id,
          parentNodeId: delta.edge.fromNodeId,
        });
      }
    });

    context.run(() => store.getState().increment());

    expect(store.getState().count).toBe(1);
    expect(linkedEvidence).toHaveLength(1);
    expect(linkedEvidence[0]?.childNodeId).toBe(linkedEvidence[0]?.nodeId);
    expect(linkedEvidence[0]?.nodeId).not.toBe(linkedEvidence[0]?.parentNodeId);

    middleware.dispose();
    published.uninstall();
  });

  it("leaves native Zustand updates uninstrumented when only bridge-v1 is available", () => {
    const target = {};
    const engine = createDevtoolsEngine({ capacity: 10 });
    const ownerToken = Symbol("legacy-bridge");
    Object.defineProperty(target, browseSentEventCausalityGlobalKey, {
      configurable: true,
      value: Object.freeze({
        protocolVersion: browseSentEventCausalityProtocolVersion,
        capabilities: Object.freeze([browseSentEventCausalityBridgeCapability]),
        ownerToken,
        bridge: engine.causality,
      }),
    });
    const { middleware, store } = createCounterStore(target);
    const context = createMessageContext(engine);

    context.run(() => store.getState().increment());

    expect(store.getState().count).toBe(1);
    expect(evidenceKinds(engine, context.messageId)).toEqual(["transport.received"]);

    middleware.dispose();
  });

  it("recovers its existing store wrapper when core is uninstalled and later reinstalled", () => {
    const target = {};
    const firstEngine = createDevtoolsEngine({ capacity: 10 });
    const firstPublished = installBrowseSentEventCausalityEnvelope(target, firstEngine.causality);
    const { middleware, store } = createCounterStore(target);

    firstPublished.uninstall();
    const secondEngine = createDevtoolsEngine({ capacity: 10 });
    const secondPublished = installBrowseSentEventCausalityEnvelope(target, secondEngine.causality);
    const context = createMessageContext(secondEngine);

    context.run(() => store.getState().increment());

    expect(evidenceKinds(secondEngine, context.messageId)).toContain("state.root-changed");

    middleware.dispose();
    secondPublished.uninstall();
  });

  it("deduplicates nested trace middleware and preserves initializer/api setter identity", () => {
    const target = {};
    const engine = createDevtoolsEngine({ capacity: 10 });
    const published = installBrowseSentEventCausalityEnvelope(target, engine.causality);
    const outer = traceZustand({ storeId: "outer", target });
    const inner = traceZustand({ storeId: "inner", target });
    let sameSetter = false;
    const store = createStore<CounterState>()(
      outer(
        inner((set, _get, api) => {
          sameSetter = set === api.setState;
          return {
            count: 0,
            increment: () => set({ count: 1 }),
          };
        }),
      ),
    );
    const context = createMessageContext(engine);

    context.run(() => store.getState().increment());

    expect(sameSetter).toBe(true);
    expect(evidenceKinds(engine, context.messageId)).toEqual([
      "transport.received",
      "zustand.set-started",
      "zustand.set-completed",
      "state.root-changed",
    ]);

    outer.dispose();
    inner.dispose();
    published.uninstall();
  });
});
