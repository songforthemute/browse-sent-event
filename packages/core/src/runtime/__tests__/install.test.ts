import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowseSentEventRuntime } from "../create-engine.js";
import { installBrowseSentEvent, runTeardownsBestEffort } from "../install.js";

const originalXmlHttpRequest = globalThis.window.XMLHttpRequest;

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

  it("removes the installed runtime when uninstalled", () => {
    const runtime = installBrowseSentEvent();

    runtime.uninstall();

    const next = installBrowseSentEvent();

    expect(next).not.toBe(runtime);
  });

  it("disposes causality evidence subscriptions when uninstalled", () => {
    const runtime = installBrowseSentEvent();
    const deltas: unknown[] = [];
    runtime.engine.causality.subscribeEvidence((delta) => deltas.push(delta));

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
