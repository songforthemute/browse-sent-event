import { resolveOptions, type BrowseSentEventOptions } from "./options.js";

export interface BrowseSentEventRuntime {
  readonly capacity: number;
  readonly installed: boolean;
}

export function createBrowseSentEventRuntime(
  options?: BrowseSentEventOptions,
): BrowseSentEventRuntime {
  const resolved = resolveOptions(options);

  return {
    capacity: resolved.capacity,
    installed: false,
  };
}
