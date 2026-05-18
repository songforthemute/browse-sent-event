import { describe, expect, it } from "vitest";
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
});
