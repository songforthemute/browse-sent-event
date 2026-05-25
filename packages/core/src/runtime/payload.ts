import type { BrowseSentEventPayload } from "./events.js";

export interface BrowseSentEventPayloadSummary {
  readonly payload: BrowseSentEventPayload;
  readonly payloadPreview: string;
  readonly size: number;
}

export interface SerializedArrayBufferPayload {
  readonly type: "array-buffer";
  readonly byteLength: number;
}

const textEncoder = new globalThis.TextEncoder();
const previewLength = 100;

export function createPayloadSummary(
  payload: BrowseSentEventPayload,
): BrowseSentEventPayloadSummary {
  if (typeof payload === "string") {
    return {
      payload,
      payloadPreview: payload.slice(0, previewLength),
      size: textEncoder.encode(payload).byteLength,
    };
  }

  return {
    payload,
    payloadPreview: `[binary ${payload.byteLength} bytes]`,
    size: payload.byteLength,
  };
}

export function serializePayloadForExport(
  payload: BrowseSentEventPayload,
): string | SerializedArrayBufferPayload {
  if (typeof payload === "string") {
    return payload;
  }

  return {
    type: "array-buffer",
    byteLength: payload.byteLength,
  };
}
