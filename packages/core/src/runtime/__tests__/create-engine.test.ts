import { describe, expect, it, vi } from "vitest";
import { createBrowseSentEventRuntime } from "../create-engine.js";

describe("createBrowseSentEventRuntime", () => {
  it("uses the default Phase 1 capacity", () => {
    const runtime = createBrowseSentEventRuntime();

    expect(runtime.capacity).toBe(10_000);
    expect(runtime.installed).toBe(false);
  });

  it("accepts a custom capacity", () => {
    const runtime = createBrowseSentEventRuntime({ capacity: 128 });

    expect(runtime.capacity).toBe(128);
  });

  it("creates a devtools engine with the resolved capacity", () => {
    const runtime = createBrowseSentEventRuntime({ capacity: 128 });

    expect(runtime.engine.capacity).toBe(128);
    expect(runtime.engine.getMessages()).toEqual([]);
  });

  it("runs teardown once and always disposes the engine", () => {
    const failure = new Error("teardown failed");
    const teardown = vi.fn(() => {
      throw failure;
    });
    const runtime = createBrowseSentEventRuntime(undefined, { uninstall: teardown });
    const deltas: unknown[] = [];
    runtime.engine.causality.subscribeEvidence((delta) => {
      deltas.push(delta);
    });

    expect(() => runtime.uninstall()).toThrow(failure);
    expect(() => runtime.uninstall()).not.toThrow();
    expect(teardown).toHaveBeenCalledOnce();
    expect(deltas).toEqual([{ type: "disposed" }]);
    expect(() =>
      runtime.engine.recordConnection({
        protocol: "websocket",
        url: "wss://example.test/socket",
      }),
    ).toThrow("BrowseSentEvent engine is disposed.");
  });
});
