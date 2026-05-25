import type {
  BrowseSentEventInterceptorContext,
  InstalledBrowseSentEventInterceptor,
} from "./types.js";

function isInstrumentableEventSource(value: unknown): value is EventSource {
  return (
    typeof value === "object" && value !== null && "addEventListener" in value && "close" in value
  );
}

export function installEventSourceInterceptor(
  context: BrowseSentEventInterceptorContext,
): InstalledBrowseSentEventInterceptor | undefined {
  const OriginalEventSource = context.target.EventSource;

  if (!OriginalEventSource) {
    return undefined;
  }

  const ProxiedEventSource = new Proxy(OriginalEventSource, {
    construct(target, args, newTarget) {
      const source: unknown = Reflect.construct(target, args, newTarget);

      if (!isInstrumentableEventSource(source)) {
        throw new TypeError("Expected EventSource instance.");
      }

      const url = String(args[0]);
      const connection = context.engine.recordConnection({
        protocol: "eventsource",
        url,
        state: "connecting",
        metadata: { source: "eventsource" },
      });

      source.addEventListener("open", () => {
        context.engine.updateConnection(connection.id, { state: "open" });
      });
      source.addEventListener("error", () => {
        if (source.readyState === OriginalEventSource.CLOSED) {
          context.engine.updateConnection(connection.id, {
            state: "closed",
            closedAt: globalThis.performance?.now() ?? Date.now(),
          });
        }
      });
      source.addEventListener("message", (event) => {
        context.engine.recordMessage({
          connectionId: connection.id,
          direction: "in",
          protocol: "eventsource",
          payload: event.data,
          type: "message",
          metadata: {
            lastEventId: event.lastEventId,
            url,
          },
        });
      });

      const originalClose = source.close.bind(source);

      Reflect.set(source, "close", () => {
        context.engine.updateConnection(connection.id, {
          state: "closed",
          closedAt: globalThis.performance?.now() ?? Date.now(),
        });

        originalClose();
      });

      return source;
    },
  });

  Reflect.set(context.target, "EventSource", ProxiedEventSource);

  return {
    name: "eventsource",
    uninstall() {
      Reflect.set(context.target, "EventSource", OriginalEventSource);
    },
  };
}
