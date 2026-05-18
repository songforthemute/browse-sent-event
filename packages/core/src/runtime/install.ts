import { createBrowseSentEventRuntime, type BrowseSentEventRuntime } from "./create-engine.js";
import type { BrowseSentEventOptions } from "./options.js";

const runtimeKey = "__browseSentEventRuntime__";

function getRuntimeWindow(): Window | undefined {
  if (typeof globalThis.window === "undefined") {
    return undefined;
  }

  return globalThis.window;
}

function isBrowseSentEventRuntime(value: unknown): value is BrowseSentEventRuntime {
  return typeof value === "object" && value !== null && "capacity" in value && "installed" in value;
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

  const runtime: BrowseSentEventRuntime = {
    ...createBrowseSentEventRuntime(options),
    installed: true,
  };

  Reflect.set(target, runtimeKey, runtime);

  return runtime;
}
