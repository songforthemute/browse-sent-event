import { createBrowseSentEventRuntime, type BrowseSentEventRuntime } from "./create-engine.js";
import type {
  BrowseSentEventInterceptorTarget,
  InstalledBrowseSentEventInterceptor,
} from "../interceptors/types.js";
import { installWebSocketInterceptor } from "../interceptors/websocket.js";
import type { BrowseSentEventOptions } from "./options.js";

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

  const installedInterceptors: InstalledBrowseSentEventInterceptor[] = [];
  const runtime = createBrowseSentEventRuntime(options, {
    installed: true,
    uninstall() {
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

  Reflect.set(target, runtimeKey, runtime);

  return runtime;
}
