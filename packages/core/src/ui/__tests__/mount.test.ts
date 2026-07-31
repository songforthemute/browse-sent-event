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

  it("toggles the panel with a custom hotkey", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });
    const mounted = mountDevtoolsPanel({
      engine,
      options: {
        autoOpen: false,
        hotkey: "ctrl+alt+k",
        position: "bottom-right",
      },
      target: globalThis.window,
    });

    globalThis.window.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", {
        altKey: true,
        ctrlKey: true,
        key: "k",
      }),
    );

    expect(mounted.element.hasAttribute("open")).toBe(true);

    mounted.unmount();
  });

  it("keeps the panel mounted when the hotkey is invalid", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });
    const mounted = mountDevtoolsPanel({
      engine,
      options: {
        autoOpen: false,
        hotkey: "cmd+ctrl+r",
        position: "bottom-right",
      },
      target: globalThis.window,
    });

    globalThis.window.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", {
        ctrlKey: true,
        key: "r",
      }),
    );

    expect(globalThis.document.querySelector("bse-devtools-panel")).toBe(mounted.element);
    expect(mounted.element.hasAttribute("open")).toBe(false);

    mounted.unmount();
  });

  it("subscribes to engine snapshots while mounted", async () => {
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

    const connection = engine.recordConnection({
      protocol: "websocket",
      url: "wss://example.test/socket",
    });
    engine.recordMessage({
      connectionId: connection.id,
      direction: "in",
      protocol: "websocket",
      payload: "hello",
    });

    await Reflect.get(mounted.element, "updateComplete");

    expect(Reflect.get(mounted.element, "snapshot")?.messages).toHaveLength(1);

    mounted.unmount();
  });

  it("unsubscribes from engine snapshots when unmounted", async () => {
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

    const connection = engine.recordConnection({
      protocol: "websocket",
      url: "wss://example.test/socket",
    });

    await Reflect.get(mounted.element, "updateComplete");
    const snapshotBeforeUnmount = Reflect.get(mounted.element, "snapshot");

    mounted.unmount();

    engine.recordMessage({
      connectionId: connection.id,
      direction: "in",
      protocol: "websocket",
      payload: "after unmount",
    });

    expect(Reflect.get(mounted.element, "snapshot")).toBe(snapshotBeforeUnmount);
  });

  it("dispatches an export event with JSONL content", () => {
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
    const connection = engine.recordConnection({
      protocol: "websocket",
      url: "wss://example.test/socket",
    });

    engine.recordMessage({
      connectionId: connection.id,
      direction: "in",
      protocol: "websocket",
      payload: "hello",
    });

    const exports: unknown[] = [];

    mounted.element.addEventListener("bse-export", (event) => {
      if (event instanceof globalThis.CustomEvent) {
        exports.push(event.detail);
      }
    });

    Reflect.get(mounted.element, "requestExport")?.call(mounted.element, "jsonl");

    expect(exports).toEqual([
      expect.objectContaining({
        content: expect.stringContaining('"payload":"hello"'),
        format: "jsonl",
      }),
    ]);

    mounted.unmount();
  });

  it("dispatches export content filtered by query", () => {
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
    const connection = engine.recordConnection({
      protocol: "websocket",
      url: "wss://example.test/socket",
    });

    engine.recordMessage({
      connectionId: connection.id,
      direction: "in",
      protocol: "websocket",
      payload: "keep this message",
    });
    engine.recordMessage({
      connectionId: connection.id,
      direction: "in",
      protocol: "websocket",
      payload: "skip this message",
    });

    const exports: unknown[] = [];

    mounted.element.addEventListener("bse-export", (event) => {
      if (event instanceof globalThis.CustomEvent) {
        exports.push(event.detail);
      }
    });

    Reflect.get(mounted.element, "setQuery")?.call(mounted.element, "keep");
    Reflect.get(mounted.element, "requestExport")?.call(mounted.element, "jsonl");

    expect(exports).toEqual([
      expect.objectContaining({
        content: expect.stringContaining("keep this message"),
        format: "jsonl",
      }),
    ]);
    expect(exports).toEqual([
      expect.objectContaining({
        content: expect.not.stringContaining("skip this message"),
      }),
    ]);

    mounted.unmount();
  });
});
