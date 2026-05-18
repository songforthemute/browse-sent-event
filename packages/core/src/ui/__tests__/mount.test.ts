import { afterEach, describe, expect, it } from "vitest";
import { createDevtoolsEngine } from "../../runtime/engine.js";
import { mountDevtoolsPanel } from "../mount.js";

describe("mountDevtoolsPanel", () => {
  afterEach(() => {
    globalThis.document.body.replaceChildren();
  });

  it("mounts a custom element host and unmounts it", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });
    const mounted = mountDevtoolsPanel({
      engine,
      options: {
        autoOpen: true,
        hotkey: "cmd+shift+r",
        position: "bottom-right",
      },
      target: globalThis.window,
    });

    const panel = globalThis.document.querySelector("bse-devtools-panel");

    expect(panel).not.toBeNull();
    expect(panel?.hasAttribute("open")).toBe(true);

    mounted.unmount();

    expect(globalThis.document.querySelector("bse-devtools-panel")).toBeNull();
  });

  it("toggles the panel with the configured hotkey", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });
    const mounted = mountDevtoolsPanel({
      engine,
      options: {
        autoOpen: false,
        hotkey: "cmd+shift+r",
        position: "bottom-right",
      },
      target: globalThis.window,
    });

    expect(mounted.element.hasAttribute("open")).toBe(false);

    globalThis.window.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", {
        key: "r",
        metaKey: true,
        shiftKey: true,
      }),
    );

    expect(mounted.element.hasAttribute("open")).toBe(true);

    mounted.unmount();
  });
});
