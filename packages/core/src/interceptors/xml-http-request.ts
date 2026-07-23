import type { BrowseSentEventConnection, BrowseSentEventPayload } from "../runtime/events.js";
import type {
  BrowseSentEventInterceptorContext,
  InstalledBrowseSentEventInterceptor,
} from "./types.js";
import { installGlobalPatch } from "./global-patch.js";

interface XmlHttpRequestDescriptor {
  readonly method: string;
  readonly url: string;
  readonly async: boolean;
  sent: boolean;
}

interface ActiveXmlHttpRequest {
  readonly connection: BrowseSentEventConnection;
  outcome?: "load";
  finalized: boolean;
}

function isInstrumentableXmlHttpRequest(value: unknown): value is XMLHttpRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "addEventListener" in value &&
    "open" in value &&
    "send" in value
  );
}

function now(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function toRequestPayload(body: Document | XMLHttpRequestBodyInit | null): BrowseSentEventPayload {
  return typeof body === "string" ? body : body === null ? "" : "[unsupported XHR request body]";
}

function toResponsePayload(request: XMLHttpRequest): BrowseSentEventPayload {
  return request.responseText;
}

function getUrlStringifierFromConstructor(Url: unknown): unknown {
  if (typeof Url !== "function") {
    return undefined;
  }

  const prototype: unknown = Reflect.get(Url, "prototype");

  if ((typeof prototype !== "object" && typeof prototype !== "function") || prototype === null) {
    return undefined;
  }

  return Reflect.get(prototype, "toString");
}

function getUrlStringifiers(target: Window): readonly unknown[] {
  return [
    getUrlStringifierFromConstructor(Reflect.get(target, "URL")),
    getUrlStringifierFromConstructor(globalThis.URL),
  ];
}

function observeUrl(value: unknown, urlStringifiers: readonly unknown[]): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  for (const urlStringifier of urlStringifiers) {
    if (typeof urlStringifier !== "function") {
      continue;
    }

    try {
      const url: unknown = Reflect.apply(urlStringifier, value, []);

      if (typeof url === "string") {
        return url;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

function createDescriptor(
  args: readonly unknown[],
  urlStringifiers: readonly unknown[],
): XmlHttpRequestDescriptor | undefined {
  const [method, urlValue, async = true] = args;
  const url = observeUrl(urlValue, urlStringifiers);

  if (typeof method !== "string" || url === undefined) {
    return undefined;
  }

  return {
    method: method.toUpperCase(),
    url,
    async: Boolean(async),
    sent: false,
  };
}

function instrumentXmlHttpRequest(
  request: XMLHttpRequest,
  context: BrowseSentEventInterceptorContext,
  urlStringifiers: readonly unknown[],
): void {
  const originalOpen: unknown = Reflect.get(request, "open");
  const originalSend: unknown = Reflect.get(request, "send");

  if (typeof originalOpen !== "function" || typeof originalSend !== "function") {
    throw new TypeError("Expected XMLHttpRequest methods.");
  }

  let descriptor: XmlHttpRequestDescriptor | undefined;
  let active: ActiveXmlHttpRequest | undefined;

  request.addEventListener("loadstart", () => {
    if (active) {
      context.engine.updateConnection(active.connection.id, { state: "open" });
    }
  });
  request.addEventListener("load", () => {
    if (active) {
      active.outcome = "load";
    }
  });
  request.addEventListener("loadend", () => {
    const current = active;

    if (!current || current.finalized) {
      return;
    }

    current.finalized = true;

    if (current.outcome === "load") {
      context.engine.recordMessage({
        connectionId: current.connection.id,
        direction: "in",
        protocol: "xhr",
        payload: toResponsePayload(request),
        type: "response",
        metadata: {
          contentType: request.getResponseHeader("content-type"),
          status: request.status,
          statusText: request.statusText,
        },
      });
    }

    context.engine.updateConnection(current.connection.id, {
      state: "closed",
      closedAt: now(),
      metadata: {
        contentType: request.getResponseHeader("content-type"),
        outcome: current.outcome ?? "unknown",
        responseType: request.responseType,
        responseURL: request.responseURL,
        status: request.status,
        statusText: request.statusText,
      },
    });
    active = undefined;
  });

  Reflect.set(request, "open", function (this: XMLHttpRequest, ...args: unknown[]) {
    const result = Reflect.apply(originalOpen, this, args);

    if (this === request) {
      descriptor = createDescriptor(args, urlStringifiers);
      active = undefined;
    }

    return result;
  });

  Reflect.set(
    request,
    "send",
    function (this: XMLHttpRequest, ...args: [body?: Document | XMLHttpRequestBodyInit | null]) {
      if (this !== request) {
        return Reflect.apply(originalSend, this, args);
      }

      if (!descriptor || descriptor.sent) {
        return Reflect.apply(originalSend, this, args);
      }

      descriptor.sent = true;

      const connection = context.engine.recordConnection({
        protocol: "xhr",
        url: descriptor.url,
        state: "connecting",
        metadata: {
          async: descriptor.async,
          method: descriptor.method,
          timeout: request.timeout,
          withCredentials: request.withCredentials,
        },
      });
      const body = args[0] ?? null;

      active = {
        connection,
        finalized: false,
      };
      context.engine.recordMessage({
        connectionId: connection.id,
        direction: "out",
        protocol: "xhr",
        payload: toRequestPayload(body),
        type: "request",
        metadata: {
          method: descriptor.method,
        },
      });

      return Reflect.apply(originalSend, this, args);
    },
  );
}

export function installXmlHttpRequestInterceptor(
  context: BrowseSentEventInterceptorContext,
): InstalledBrowseSentEventInterceptor | undefined {
  const OriginalXmlHttpRequest = context.target.XMLHttpRequest;

  if (!OriginalXmlHttpRequest) {
    return undefined;
  }

  const urlStringifiers = getUrlStringifiers(context.target);
  const ProxiedXmlHttpRequest = new Proxy(OriginalXmlHttpRequest, {
    construct(target, args, newTarget) {
      const request: unknown = Reflect.construct(target, args, newTarget);

      if (!isInstrumentableXmlHttpRequest(request)) {
        throw new TypeError("Expected XMLHttpRequest instance.");
      }

      instrumentXmlHttpRequest(request, context, urlStringifiers);

      return request;
    },
  });
  const patch = installGlobalPatch(context.target, "XMLHttpRequest", () => ProxiedXmlHttpRequest);

  return {
    name: "xhr",
    uninstall() {
      patch.uninstall();
    },
  };
}
