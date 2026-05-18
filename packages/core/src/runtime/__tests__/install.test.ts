import { beforeEach, describe, expect, it } from "vitest";
import { installBrowseSentEvent } from "../install.js";

describe("installBrowseSentEvent", () => {
  beforeEach(() => {
    Reflect.deleteProperty(globalThis.window, "__browseSentEventRuntime__");
  });

  it("installs the runtime once and returns the same runtime on repeated calls", () => {
    const first = installBrowseSentEvent({ capacity: 123 });
    const second = installBrowseSentEvent({ capacity: 456 });

    expect(first.installed).toBe(true);
    expect(first.capacity).toBe(123);
    expect(second).toBe(first);
  });
});
