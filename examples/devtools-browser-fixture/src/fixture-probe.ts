import type { BrowseSentEventRuntime } from "@browse-sent-event/core";

export interface BrowseSentEventFixtureCounts {
  readonly connections: number;
  readonly messages: number;
}

export interface BrowseSentEventFixtureMinimumCounts {
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

async function waitForSnapshotCounts(minimum: BrowseSentEventFixtureMinimumCounts): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 1_000) {
    const counts = getSnapshotCounts();

    if (counts.connections >= minimum.connections && counts.messages >= minimum.messages) {
      return;
    }

    await new Promise((resolve) => {
      globalThis.setTimeout(resolve, 10);
    });
  }

  throw new Error("Timed out waiting for transport records");
}

export async function runFetchStream(): Promise<void> {
  const response = await fetch("/__bse-fixture/stream");
  await response.text();
  await waitForSnapshotCounts({ connections: 1, messages: 1 });
}

export async function runEventSource(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const source = new EventSource("/__bse-fixture/events");
    let count = 0;

    source.addEventListener("message", () => {
      count += 1;

      if (count >= 2) {
        source.close();
        resolve();
      }
    });
    source.addEventListener("error", () => {
      source.close();
      reject(new Error("EventSource fixture failed"));
    });
  });
  await waitForSnapshotCounts({ connections: 2, messages: 2 });
}

export async function runWebSocket(url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url);

    socket.addEventListener(
      "open",
      () => {
        socket.send("browser hello");
      },
      { once: true },
    );
    socket.addEventListener(
      "message",
      () => {
        socket.close();
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        reject(new Error("WebSocket fixture failed"));
      },
      { once: true },
    );
  });
  await waitForSnapshotCounts({ connections: 1, messages: 2 });
}
