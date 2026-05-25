import type { BrowseSentEventEngine } from "../runtime/engine.js";

export type BrowseSentEventInterceptorTarget = Window & typeof globalThis;

export interface BrowseSentEventInterceptorContext {
  readonly engine: BrowseSentEventEngine;
  readonly target: BrowseSentEventInterceptorTarget;
}

export interface InstalledBrowseSentEventInterceptor {
  readonly name: string;
  uninstall(): void;
}
