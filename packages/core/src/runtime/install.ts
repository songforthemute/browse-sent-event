import { createBrowseSentEventRuntime, type BrowseSentEventRuntime } from "./create-engine.js";
import type { BrowseSentEventOptions } from "./options.js";

const runtimeKey = "__browseSentEventRuntime__";

type RuntimeWindow = Window & {
  [runtimeKey]?: BrowseSentEventRuntime;
};

function getRuntimeWindow(): RuntimeWindow | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window as RuntimeWindow;
}

export function installBrowseSentEvent(options?: BrowseSentEventOptions): BrowseSentEventRuntime {
  const target = getRuntimeWindow();

  if (!target) {
    return {
      ...createBrowseSentEventRuntime(options),
      installed: false,
    };
  }

  if (target[runtimeKey]) {
    return target[runtimeKey];
  }

  const runtime: BrowseSentEventRuntime = {
    ...createBrowseSentEventRuntime(options),
    installed: true,
  };

  target[runtimeKey] = runtime;

  return runtime;
}
