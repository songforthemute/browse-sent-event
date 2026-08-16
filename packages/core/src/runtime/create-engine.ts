import {
  createDevtoolsEngine,
  disposeDevtoolsEngine,
  type BrowseSentEventEngine,
} from "./engine.js";
import { resolveOptions, type BrowseSentEventOptions } from "./options.js";

export interface BrowseSentEventRuntime {
  readonly capacity: number;
  readonly engine: BrowseSentEventEngine;
  readonly installed: boolean;
  uninstall(): void;
}

export interface BrowseSentEventRuntimeFactoryOptions {
  readonly installed?: boolean;
  readonly uninstall?: () => void;
}

export function createBrowseSentEventRuntime(
  options?: BrowseSentEventOptions,
  factoryOptions: BrowseSentEventRuntimeFactoryOptions = {},
): BrowseSentEventRuntime {
  const resolved = resolveOptions(options);
  const engine = createDevtoolsEngine({ capacity: resolved.capacity });
  let uninstalled = false;

  function uninstall(): void {
    if (uninstalled) {
      return;
    }

    uninstalled = true;

    try {
      factoryOptions.uninstall?.();
    } finally {
      disposeDevtoolsEngine(engine);
    }
  }

  return {
    capacity: resolved.capacity,
    engine,
    installed: factoryOptions.installed ?? false,
    uninstall,
  };
}
