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

  it("stays unsubscribed while closed and catches up when reopened", async () => {
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
    const firstConnection = engine.recordConnection({
      protocol: "websocket",
      url: "wss://example.test/socket",
    });
    engine.updateConnection(firstConnection.id, {
      state: "closed",
      closeCode: 1000,
      closedAt: 2_000,
    });
    const reconnect = engine.recordConnection({
      protocol: "websocket",
      url: "wss://example.test/socket",
      state: "open",
    });
    engine.recordMessage({
      connectionId: reconnect.id,
      direction: "in",
      protocol: "websocket",
      payload: "while closed",
    });

    await Reflect.get(mounted.element, "updateComplete");
    expect(Reflect.get(mounted.element, "snapshot")).toBeUndefined();

    Reflect.get(mounted.element, "setOpen")?.call(mounted.element, true);
    await Reflect.get(mounted.element, "updateComplete");

    expect(Reflect.get(mounted.element, "snapshot")?.messages).toHaveLength(1);
    expect(Reflect.get(mounted.element, "snapshot")?.connections).toEqual([
      expect.objectContaining({ id: firstConnection.id, state: "closed" }),
      expect.objectContaining({ id: reconnect.id, reconnectCount: 1, state: "open" }),
    ]);

    Reflect.get(mounted.element, "setOpen")?.call(mounted.element, false);
    await Reflect.get(mounted.element, "updateComplete");
    const snapshotWhileClosed = Reflect.get(mounted.element, "snapshot");
    engine.recordMessage({
      connectionId: reconnect.id,
      direction: "in",
      protocol: "websocket",
      payload: "after close",
    });
    expect(Reflect.get(mounted.element, "snapshot")).toBe(snapshotWhileClosed);

    Reflect.get(mounted.element, "setOpen")?.call(mounted.element, true);
    await Reflect.get(mounted.element, "updateComplete");
    expect(Reflect.get(mounted.element, "snapshot")?.messages).toHaveLength(2);

    mounted.unmount();
  });

  it("moves its open subscription when the engine is replaced", async () => {
    const firstEngine = createDevtoolsEngine({ capacity: 10 });
    const secondEngine = createDevtoolsEngine({ capacity: 10 });
    const mounted = mountDevtoolsPanel({
      engine: firstEngine,
      options: {
        autoOpen: true,
        hotkey: "cmd+shift+r",
        position: "bottom-right",
      },
      target: globalThis.window,
    });
    const firstConnection = firstEngine.recordConnection({
      protocol: "websocket",
      url: "wss://first.example.test/socket",
    });
    firstEngine.recordMessage({
      connectionId: firstConnection.id,
      direction: "in",
      protocol: "websocket",
      payload: "first engine",
    });
    await Reflect.get(mounted.element, "updateComplete");

    Reflect.set(mounted.element, "engine", secondEngine);
    await Reflect.get(mounted.element, "updateComplete");
    const secondConnection = secondEngine.recordConnection({
      protocol: "websocket",
      url: "wss://second.example.test/socket",
    });
    secondEngine.recordMessage({
      connectionId: secondConnection.id,
      direction: "in",
      protocol: "websocket",
      payload: "second engine",
    });
    firstEngine.recordMessage({
      connectionId: firstConnection.id,
      direction: "in",
      protocol: "websocket",
      payload: "stale first engine",
    });
    await Reflect.get(mounted.element, "updateComplete");

    expect(Reflect.get(mounted.element, "snapshot")?.messages).toEqual([
      expect.objectContaining({ payload: "second engine" }),
    ]);

    mounted.unmount();
  });

  it("tracks direct open attribute changes and reconnects after DOM reattachment", async () => {
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
    const connection = engine.recordConnection({
      protocol: "websocket",
      url: "wss://example.test/socket",
    });

    mounted.element.setAttribute("open", "");
    await Reflect.get(mounted.element, "updateComplete");
    expect(Reflect.get(mounted.element, "snapshot")?.connections).toHaveLength(1);

    mounted.element.removeAttribute("open");
    await Reflect.get(mounted.element, "updateComplete");
    const snapshotWhileExternallyClosed = Reflect.get(mounted.element, "snapshot");
    engine.recordMessage({
      connectionId: connection.id,
      direction: "in",
      protocol: "websocket",
      payload: "while externally closed",
    });
    expect(Reflect.get(mounted.element, "snapshot")).toBe(snapshotWhileExternallyClosed);

    Reflect.set(mounted.element, "open", true);
    await Reflect.get(mounted.element, "updateComplete");
    expect(Reflect.get(mounted.element, "snapshot")?.messages).toHaveLength(1);

    mounted.element.remove();
    engine.recordMessage({
      connectionId: connection.id,
      direction: "in",
      protocol: "websocket",
      payload: "while detached",
    });
    globalThis.document.body.append(mounted.element);
    await Reflect.get(mounted.element, "updateComplete");

    expect(Reflect.get(mounted.element, "snapshot")?.messages).toHaveLength(2);

    mounted.unmount();
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
