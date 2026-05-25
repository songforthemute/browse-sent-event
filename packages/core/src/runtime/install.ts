import { createBrowseSentEventRuntime, type BrowseSentEventRuntime } from "./create-engine.js";
import type {
  BrowseSentEventInterceptorTarget,
  InstalledBrowseSentEventInterceptor,
} from "../interceptors/types.js";
import { installEventSourceInterceptor } from "../interceptors/eventsource.js";
import { installFetchStreamInterceptor } from "../interceptors/fetch-stream.js";
import { installWebSocketInterceptor } from "../interceptors/websocket.js";
import { mountDevtoolsPanel, type MountedDevtoolsPanel } from "../ui/mount.js";
import { resolveOptions, type BrowseSentEventOptions } from "./options.js";

const runtimeKey = "__browseSentEventRuntime__";

function getRuntimeWindow(): BrowseSentEventInterceptorTarget | undefined {
  if (typeof globalThis.window === "undefined") {
    return undefined;
  }

  return globalThis.window as BrowseSentEventInterceptorTarget;
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

export function installBrowseSentEvent(options?: BrowseSentEventOptions): BrowseSentEventRuntime {
  const target = getRuntimeWindow();

  if (!target) {
    return {
      ...createBrowseSentEventRuntime(options),
      installed: false,
    };
  }

  const installedRuntime = Reflect.get(target, runtimeKey);

  if (isBrowseSentEventRuntime(installedRuntime)) {
    return installedRuntime;
  }

  const resolvedOptions = resolveOptions(options);
  const installedInterceptors: InstalledBrowseSentEventInterceptor[] = [];
  let mountedPanel: MountedDevtoolsPanel | undefined;
  const runtime = createBrowseSentEventRuntime(options, {
    installed: true,
    uninstall() {
      mountedPanel?.unmount();
      mountedPanel = undefined;

      for (const interceptor of installedInterceptors.toReversed()) {
        interceptor.uninstall();
      }

      Reflect.deleteProperty(target, runtimeKey);
    },
  });

  const webSocketInterceptor = installWebSocketInterceptor({
    engine: runtime.engine,
    target,
  });

  if (webSocketInterceptor) {
    installedInterceptors.push(webSocketInterceptor);
  }

  const fetchStreamInterceptor = installFetchStreamInterceptor({
    engine: runtime.engine,
    target,
  });

  if (fetchStreamInterceptor) {
    installedInterceptors.push(fetchStreamInterceptor);
  }

  const eventSourceInterceptor = installEventSourceInterceptor({
    engine: runtime.engine,
    target,
  });

  if (eventSourceInterceptor) {
    installedInterceptors.push(eventSourceInterceptor);
  }

  mountedPanel = mountDevtoolsPanel({
    engine: runtime.engine,
    options: resolvedOptions.panel,
    target,
  });

  Reflect.set(target, runtimeKey, runtime);

  return runtime;
}
