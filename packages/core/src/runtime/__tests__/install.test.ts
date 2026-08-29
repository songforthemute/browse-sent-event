import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  browseSentEventCausalityGlobalKey,
  getBrowseSentEventCausalityAvailability,
  subscribeBrowseSentEventCausalityAvailability,
} from "../../causality/global-envelope.js";
import { createBrowseSentEventRuntime } from "../create-engine.js";
import {
  installBrowseSentEvent,
  installBrowseSentEventOnTarget,
  runTeardownsBestEffort,
} from "../install.js";

const originalXmlHttpRequest = globalThis.window.XMLHttpRequest;

function isWindowTarget(value: object): value is Window & typeof globalThis {
  return (
    "document" in value &&
    "EventSource" in value &&
    "fetch" in value &&
    "WebSocket" in value &&
    "XMLHttpRequest" in value
  );
}

function createIsolatedWindowTarget(): Window & typeof globalThis {
  const target: object = Object.create(globalThis.window);
  const globals = ["document", "EventSource", "fetch", "WebSocket", "XMLHttpRequest"] as const;

  for (const key of globals) {
    Reflect.set(target, key, Reflect.get(globalThis.window, key));
  }

  if (!isWindowTarget(target)) {
    throw new Error("Expected a Window-compatible test target.");
  }

  return target;
}

function cleanupInstalledRuntime(): void {
  const installedRuntime = Reflect.get(globalThis.window, "__browseSentEventRuntime__");

  if (typeof installedRuntime === "object" && installedRuntime !== null) {
    const uninstall: unknown = Reflect.get(installedRuntime, "uninstall");

    if (typeof uninstall === "function") {
      Reflect.apply(uninstall, installedRuntime, []);
    }
  }

  Reflect.set(globalThis.window, "XMLHttpRequest", originalXmlHttpRequest);
  Reflect.deleteProperty(globalThis.window, "__browseSentEventRuntime__");
  Reflect.deleteProperty(globalThis.window, browseSentEventCausalityGlobalKey);
  globalThis.document.body.replaceChildren();
}

describe("installBrowseSentEvent", () => {
  beforeEach(() => {
    cleanupInstalledRuntime();
  });

  afterEach(() => {
    cleanupInstalledRuntime();
  });

  it("installs the runtime once and returns the same runtime on repeated calls", () => {
    const first = installBrowseSentEvent({ capacity: 123 });
    const second = installBrowseSentEvent({ capacity: 456 });

    expect(first.installed).toBe(true);
    expect(first.capacity).toBe(123);
    expect(second).toBe(first);
    expect(globalThis.document.querySelectorAll("bse-devtools-panel")).toHaveLength(1);
  });

  it("publishes the adapter bridge only after installation and removes it with its owner", () => {
    const states: string[] = [];
    const beforeInstall = globalThis.window.XMLHttpRequest;
    let publishedAfterRuntimeSetup = false;
    const unsubscribe = subscribeBrowseSentEventCausalityAvailability((availability) => {
      states.push(availability.status);

      if (availability.status === "available") {
        publishedAfterRuntimeSetup =
          globalThis.window.XMLHttpRequest !== beforeInstall &&
          globalThis.document.querySelector("bse-devtools-panel") !== null;
      }
    }, globalThis.window);

    const runtime = installBrowseSentEvent();
    const availability = getBrowseSentEventCausalityAvailability(globalThis.window);

    expect(states).toEqual(["unavailable", "available"]);
    expect(publishedAfterRuntimeSetup).toBe(true);
    expect(availability).toMatchObject({ status: "available" });

    if (availability.status !== "available") {
      throw new Error("Expected the causality bridge to be available.");
    }

    expect(availability.envelope.bridge).toBe(runtime.engine.causality);

    runtime.uninstall();

    expect(states).toEqual(["unavailable", "available", "unavailable"]);
    expect(Reflect.has(globalThis.window, browseSentEventCausalityGlobalKey)).toBe(false);
    unsubscribe();
  });

  it("does not backfill a legacy runtime into the causality envelope", () => {
    const legacyRuntime = createBrowseSentEventRuntime();
    Reflect.set(globalThis.window, "__browseSentEventRuntime__", legacyRuntime);

    const runtime = installBrowseSentEvent();

    expect(runtime).toBe(legacyRuntime);
    expect(Reflect.has(globalThis.window, browseSentEventCausalityGlobalKey)).toBe(false);
  });

  it("keeps Phase 1 transport and panel installation when a foreign envelope is incompatible", () => {
    const target = createIsolatedWindowTarget();
    const beforeInstall = target.XMLHttpRequest;
    const foreignEnvelope = Object.freeze({
      protocolVersion: 99,
      capabilities: Object.freeze(["bridge-v1"]),
      ownerToken: Symbol("foreign"),
      bridge: createBrowseSentEventRuntime().engine.causality,
    });
    Reflect.set(target, browseSentEventCausalityGlobalKey, foreignEnvelope);

    const runtime = installBrowseSentEventOnTarget(target);

    expect(runtime.installed).toBe(true);
    expect(target.XMLHttpRequest).not.toBe(beforeInstall);
    expect(globalThis.document.querySelector("bse-devtools-panel")).not.toBeNull();
    expect(Reflect.get(target, browseSentEventCausalityGlobalKey)).toBe(foreignEnvelope);
    expect(getBrowseSentEventCausalityAvailability(target)).toMatchObject({
      status: "incompatible",
      reason: "protocol-version",
    });

    runtime.uninstall();

    expect(target.XMLHttpRequest).toBe(beforeInstall);
    expect(Reflect.get(target, browseSentEventCausalityGlobalKey)).toBe(foreignEnvelope);
  });

  it("keeps Phase 1 transport and panel installation when the envelope key is non-configurable", () => {
    const target = createIsolatedWindowTarget();
    const beforeInstall = target.XMLHttpRequest;
    const states: string[] = [];
    Object.defineProperty(target, browseSentEventCausalityGlobalKey, {
      configurable: false,
      value: undefined,
      writable: true,
    });
    subscribeBrowseSentEventCausalityAvailability((availability) => {
      states.push(availability.status);
    }, target);

    const runtime = installBrowseSentEventOnTarget(target);

    expect(runtime.installed).toBe(true);
    expect(target.XMLHttpRequest).not.toBe(beforeInstall);
    expect(globalThis.document.querySelector("bse-devtools-panel")).not.toBeNull();
    expect(states).toEqual(["unavailable", "incompatible"]);
    expect(Reflect.get(target, browseSentEventCausalityGlobalKey)).toBeUndefined();

    runtime.uninstall();

    expect(target.XMLHttpRequest).toBe(beforeInstall);
    expect(Reflect.get(target, browseSentEventCausalityGlobalKey)).toBeUndefined();
  });

  it("removes the installed runtime when uninstalled", () => {
    const runtime = installBrowseSentEvent();

    runtime.uninstall();

    const next = installBrowseSentEvent();

    expect(next).not.toBe(runtime);
  });

  it("disposes causality evidence subscriptions when uninstalled", () => {
    const runtime = installBrowseSentEvent();
    const deltas: unknown[] = [];
    runtime.engine.causality.subscribeEvidence((delta) => {
      deltas.push(delta);
    });

    runtime.uninstall();

    expect(deltas).toEqual([{ type: "disposed" }]);
    expect(() =>
      runtime.engine.causality.recordNode({
        kind: "transport.received",
        messageId: "message-1",
        source: { adapter: "websocket" },
      }),
    ).toThrow("Causality trace store is disposed.");
  });

  it("does not delete a newer runtime when a stale runtime uninstalls", () => {
    const staleRuntime = installBrowseSentEvent();
    const replacementRuntime = createBrowseSentEventRuntime({ capacity: 1 });
    Reflect.set(globalThis.window, "__browseSentEventRuntime__", replacementRuntime);

    staleRuntime.uninstall();

    expect(Reflect.get(globalThis.window, "__browseSentEventRuntime__")).toBe(replacementRuntime);
  });

  it("mounts and unmounts the DevTools panel in a browser window", () => {
    const runtime = installBrowseSentEvent({
      panel: {
        autoOpen: true,
      },
    });

    const panel = globalThis.document.querySelector("bse-devtools-panel");

    expect(runtime.installed).toBe(true);
    expect(panel).not.toBeNull();
    expect(panel?.hasAttribute("open")).toBe(true);

    runtime.uninstall();

    expect(globalThis.document.querySelector("bse-devtools-panel")).toBeNull();
  });

  it("patches XMLHttpRequest once and restores it on uninstall", () => {
    const beforeInstall = globalThis.window.XMLHttpRequest;
    const runtime = installBrowseSentEvent();
    const afterInstall = globalThis.window.XMLHttpRequest;

    expect(afterInstall).not.toBe(beforeInstall);
    expect(installBrowseSentEvent()).toBe(runtime);
    expect(globalThis.window.XMLHttpRequest).toBe(afterInstall);

    runtime.uninstall();

    expect(globalThis.window.XMLHttpRequest).toBe(beforeInstall);
  });

  it("continues interceptor teardown and disposes the engine when panel teardown fails", () => {
    const beforeInstall = globalThis.window.XMLHttpRequest;
    const runtime = installBrowseSentEvent();
    const panel = globalThis.document.querySelector("bse-devtools-panel");
    const failure = new Error("panel teardown failed");

    if (!panel) {
      throw new Error("Expected the installed panel.");
    }

    vi.spyOn(panel, "remove").mockImplementation(() => {
      throw failure;
    });

    expect(() => runtime.uninstall()).toThrow(failure);
    expect(globalThis.window.XMLHttpRequest).toBe(beforeInstall);
    expect(Reflect.has(globalThis.window, "__browseSentEventRuntime__")).toBe(false);
    expect(() =>
      runtime.engine.recordConnection({
        protocol: "websocket",
        url: "wss://example.test/socket",
      }),
    ).toThrow("BrowseSentEvent engine is disposed.");
  });

  it("runs every teardown and aggregates multiple failures in encounter order", () => {
    const firstFailure = new Error("first teardown failed");
    const secondFailure = new Error("second teardown failed");
    const calls: string[] = [];

    let thrown: unknown;

    try {
      runTeardownsBestEffort([
        () => {
          calls.push("first");
          throw firstFailure;
        },
        () => {
          calls.push("second");
        },
        () => {
          calls.push("third");
          throw secondFailure;
        },
      ]);
    } catch (error) {
      thrown = error;
    }

    expect(calls).toEqual(["first", "second", "third"]);
    expect(thrown).toBeInstanceOf(AggregateError);

    if (!(thrown instanceof AggregateError)) {
      throw new Error("Expected teardown failures to be aggregated.");
    }

    expect(thrown.errors).toEqual([firstFailure, secondFailure]);
  });
});
