import type { BrowseSentEventEngine } from "../runtime/engine.js";

export type BrowseSentEventInterceptorTarget = Window & typeof globalThis;

export interface BrowseSentEventInterceptorContext {
  readonly engine: BrowseSentEventEngine;
  readonly shouldExcludeUrl?: (url: string) => boolean;
  readonly target: BrowseSentEventInterceptorTarget;
}

export function isUrlExcluded(context: BrowseSentEventInterceptorContext, url: string): boolean {
  try {
    return context.shouldExcludeUrl?.(url) === true;
  } catch {
    return false;
  }
}

export interface InstalledBrowseSentEventInterceptor {
  readonly name: string;
  uninstall(): void;
}
