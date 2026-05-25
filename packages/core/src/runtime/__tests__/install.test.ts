import { beforeEach, describe, expect, it } from "vitest";
import { installBrowseSentEvent } from "../install.js";

describe("installBrowseSentEvent", () => {
  beforeEach(() => {
    globalThis.document.body.replaceChildren();
    Reflect.deleteProperty(globalThis.window, "__browseSentEventRuntime__");
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
});
