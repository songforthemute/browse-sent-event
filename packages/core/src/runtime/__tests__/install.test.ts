import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installBrowseSentEvent } from "../install.js";

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
});
