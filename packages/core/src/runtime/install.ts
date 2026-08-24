import { createBrowseSentEventRuntime, type BrowseSentEventRuntime } from "./create-engine.js";
import {
  getBrowseSentEventCausalityAvailability,
  installBrowseSentEventCausalityEnvelope,
  type InstalledBrowseSentEventCausalityEnvelope,
} from "../causality/global-envelope.js";
import type {
  BrowseSentEventInterceptorTarget,
  InstalledBrowseSentEventInterceptor,
} from "../interceptors/types.js";
import { installEventSourceInterceptor } from "../interceptors/eventsource.js";
import { installFetchStreamInterceptor } from "../interceptors/fetch-stream.js";
import { installWebSocketInterceptor } from "../interceptors/websocket.js";
import { installXmlHttpRequestInterceptor } from "../interceptors/xml-http-request.js";
import { mountDevtoolsPanel, type MountedDevtoolsPanel } from "../ui/mount.js";
import { resolveOptions, type BrowseSentEventOptions } from "./options.js";
import { createUrlFilter } from "./url-filter.js";

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

/** @internal Shared only with deterministic teardown tests; not exported by the package entry point. */
export function runTeardownsBestEffort(teardowns: readonly (() => void)[]): void {
  const errors: unknown[] = [];

  for (const teardown of teardowns) {
    try {
      teardown();
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length === 1) {
    throw errors[0];
  }

  if (errors.length > 1) {
    throw new AggregateError(errors, "BrowseSentEvent teardown failed.");
  }
}

export function installBrowseSentEvent(options?: BrowseSentEventOptions): BrowseSentEventRuntime {
  const target = getRuntimeWindow();

  if (!target) {
    return {
      ...createBrowseSentEventRuntime(options),
      installed: false,
    };
  }

  return installBrowseSentEventOnTarget(target, options);
}

/** @internal Isolates the browser-global installation seam for hostile global regression tests. */
export function installBrowseSentEventOnTarget(
  target: BrowseSentEventInterceptorTarget,
  options?: BrowseSentEventOptions,
): BrowseSentEventRuntime {
  const availability = getBrowseSentEventCausalityAvailability(target);
  const installedRuntime = Reflect.get(target, runtimeKey);

  if (
    availability.status === "available" &&
    isBrowseSentEventRuntime(installedRuntime) &&
    installedRuntime.engine.causality === availability.envelope.bridge
  ) {
    return installedRuntime;
  }

  // A pre-envelope runtime might belong to an older copy of core. Do not turn
  // its private engine into the public bridge, or overwrite its ownership.
  if (isBrowseSentEventRuntime(installedRuntime)) {
    return installedRuntime;
  }

  if (availability.status === "available") {
    return {
      ...createBrowseSentEventRuntime(options),
      installed: false,
    };
  }

  const resolvedOptions = resolveOptions(options);
  const installedInterceptors: InstalledBrowseSentEventInterceptor[] = [];
  let mountedPanel: MountedDevtoolsPanel | undefined;
  let causalityEnvelope: InstalledBrowseSentEventCausalityEnvelope | undefined;
  const runtime = createBrowseSentEventRuntime(options, {
    installed: true,
    uninstall() {
      const panel = mountedPanel;
      mountedPanel = undefined;

      try {
        runTeardownsBestEffort([
          () => panel?.unmount(),
          ...installedInterceptors.toReversed().map((interceptor) => () => interceptor.uninstall()),
        ]);
      } finally {
        causalityEnvelope?.uninstall();

        if (Reflect.get(target, runtimeKey) === runtime) {
          Reflect.deleteProperty(target, runtimeKey);
        }
      }
    },
  });
  const interceptorContext = {
    engine: runtime.engine,
    shouldExcludeUrl: createUrlFilter(resolvedOptions.filter.excludeUrls),
    target,
  };

  const webSocketInterceptor = installWebSocketInterceptor(interceptorContext);

  if (webSocketInterceptor) {
    installedInterceptors.push(webSocketInterceptor);
  }

  const fetchStreamInterceptor = installFetchStreamInterceptor(interceptorContext);

  if (fetchStreamInterceptor) {
    installedInterceptors.push(fetchStreamInterceptor);
  }

  const eventSourceInterceptor = installEventSourceInterceptor(interceptorContext);

  if (eventSourceInterceptor) {
    installedInterceptors.push(eventSourceInterceptor);
  }

  const xmlHttpRequestInterceptor = installXmlHttpRequestInterceptor(interceptorContext);

  if (xmlHttpRequestInterceptor) {
    installedInterceptors.push(xmlHttpRequestInterceptor);
  }

  mountedPanel = mountDevtoolsPanel({
    engine: runtime.engine,
    options: resolvedOptions.panel,
    target,
  });

  if (!Reflect.set(target, runtimeKey, runtime) || Reflect.get(target, runtimeKey) !== runtime) {
    runtime.uninstall();
    return {
      ...createBrowseSentEventRuntime(options),
      installed: false,
    };
  }

  // This is intentionally the final publish step: an adapter never sees a
  // bridge while the runtime's interceptors and panel are only partly installed.
  causalityEnvelope = installBrowseSentEventCausalityEnvelope(target, runtime.engine.causality);

  if (!causalityEnvelope.installed) {
    // A foreign or non-configurable envelope only disables adapter discovery.
    // Transport interception and the existing Phase 1 panel remain useful.
    return runtime;
  }

  return runtime;
}
