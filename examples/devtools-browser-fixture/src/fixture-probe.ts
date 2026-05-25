import type { BrowseSentEventRuntime } from "@browse-sent-event/core";

export interface BrowseSentEventFixtureCounts {
  readonly connections: number;
  readonly messages: number;
}

interface BrowseSentEventPanelHost extends HTMLElement {
  setOpen(open: boolean): void;
}

function isBrowseSentEventRuntime(value: unknown): value is BrowseSentEventRuntime {
  return (
    typeof value === "object" &&
    value !== null &&
    "capacity" in value &&
    "engine" in value &&
    "installed" in value &&
    "uninstall" in value
  );
}

function isBrowseSentEventPanelHost(value: Element | null): value is BrowseSentEventPanelHost {
  const setOpen: unknown = value ? Reflect.get(value, "setOpen") : undefined;

  return value instanceof HTMLElement && typeof setOpen === "function";
}

function getRuntime(): BrowseSentEventRuntime {
  const runtime: unknown = Reflect.get(globalThis, "__browseSentEventRuntime__");

  if (!isBrowseSentEventRuntime(runtime)) {
    throw new Error("browse-sent-event runtime is not installed");
  }

  return runtime;
}

function getPanel(): BrowseSentEventPanelHost {
  const panel = document.querySelector("bse-devtools-panel");

  if (!isBrowseSentEventPanelHost(panel)) {
    throw new Error("browse-sent-event panel is not mounted");
  }

  return panel;
}

export function seedPanel(): void {
  const runtime = getRuntime();
  runtime.engine.clear();
  const connection = runtime.engine.recordConnection({
    openedAt: 1_000,
    protocol: "websocket",
    state: "open",
    url: "wss://fixture.test/socket",
  });

  runtime.engine.recordMessage({
    connectionId: connection.id,
    direction: "out",
    payload: "client hello",
    protocol: "websocket",
    timestamp: 1_100,
    type: "message",
  });
  runtime.engine.recordMessage({
    connectionId: connection.id,
    direction: "in",
    payload: "server hello",
    protocol: "websocket",
    timestamp: 1_200,
    type: "message",
  });

  getPanel().setOpen(true);
}

export function closePanel(): void {
  getPanel().setOpen(false);
}

export function getSnapshotCounts(): BrowseSentEventFixtureCounts {
  const snapshot = getRuntime().engine.getSnapshot();

  return {
    connections: snapshot.connections.length,
    messages: snapshot.messages.length,
  };
}
