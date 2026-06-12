import type { BrowseSentEventPayload, BrowseSentEventProtocol } from "../runtime/events.js";
import type {
  BrowseSentEventInterceptorContext,
  InstalledBrowseSentEventInterceptor,
} from "./types.js";
import { installGlobalPatch } from "./global-patch.js";

type FetchFunction = typeof globalThis.fetch;
type FetchInput = Parameters<FetchFunction>[0];
type FetchInit = Parameters<FetchFunction>[1];

const textDecoder = new globalThis.TextDecoder();

function getRequestUrl(input: FetchInput): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof globalThis.URL) {
    return input.toString();
  }

  return input.url;
}

function isTextContentType(contentType: string | null): boolean {
  return contentType?.includes("text/") === true || contentType?.includes("json") === true;
}

function classifyProtocol(contentType: string | null): BrowseSentEventProtocol {
  return contentType?.includes("text/event-stream") === true ? "eventsource" : "fetch-stream";
}

function toPayload(chunk: Uint8Array, contentType: string | null): BrowseSentEventPayload {
  if (isTextContentType(contentType)) {
    return textDecoder.decode(chunk);
  }

  return Uint8Array.from(chunk).buffer;
}

async function recordReadableStream(
  stream: ReadableStream<Uint8Array>,
  context: BrowseSentEventInterceptorContext,
  connectionId: string,
  protocol: BrowseSentEventProtocol,
  contentType: string | null,
): Promise<void> {
  const reader = stream.getReader();

  try {
    while (true) {
      const result = await reader.read();

      if (result.done) {
        break;
      }

      context.engine.recordMessage({
        connectionId,
        direction: "in",
        protocol,
        payload: toPayload(result.value, contentType),
        metadata: { contentType },
      });
    }
  } finally {
    context.engine.updateConnection(connectionId, {
      state: "closed",
      closedAt: globalThis.performance?.now() ?? Date.now(),
    });
    reader.releaseLock();
  }
}

export function installFetchStreamInterceptor(
  context: BrowseSentEventInterceptorContext,
): InstalledBrowseSentEventInterceptor | undefined {
  const originalFetch = context.target.fetch;

  if (!originalFetch) {
    return undefined;
  }

  const instrumentedFetch: FetchFunction = async (
    input: FetchInput,
    init?: FetchInit,
  ): Promise<Response> => {
    const response = await originalFetch(input, init);
    const body = response.body;

    if (!body) {
      return response;
    }

    const contentType = response.headers.get("content-type");
    const protocol = classifyProtocol(contentType);
    const connection = context.engine.recordConnection({
      protocol,
      url: getRequestUrl(input),
      state: "open",
      metadata: {
        contentType,
        source: protocol === "eventsource" ? "fetch" : "fetch",
      },
    });
    const clonedBody = response.clone().body;

    if (clonedBody) {
      void recordReadableStream(clonedBody, context, connection.id, protocol, contentType);
    }

    return response;
  };

  const patch = installGlobalPatch(context.target, "fetch", () => instrumentedFetch);

  return {
    name: "fetch-stream",
    uninstall() {
      patch.uninstall();
    },
  };
}
