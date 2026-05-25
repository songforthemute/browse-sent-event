import { createDevtoolsEngine, type BrowseSentEventEngine } from "./engine.js";
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

  return {
    capacity: resolved.capacity,
    engine: createDevtoolsEngine({ capacity: resolved.capacity }),
    installed: factoryOptions.installed ?? false,
    uninstall: factoryOptions.uninstall ?? (() => undefined),
  };
}
