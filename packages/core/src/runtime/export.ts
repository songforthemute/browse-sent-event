import type { BrowseSentEventMessage } from "./events.js";
import { serializePayloadForExport } from "./payload.js";

function formatDirection(direction: "in" | "out"): string {
  return direction === "in" ? "IN" : "OUT";
}

export function exportMessagesAsJsonl(messages: readonly BrowseSentEventMessage[]): string {
  return messages
    .map((message) =>
      JSON.stringify({
        ...message,
        payload: serializePayloadForExport(message.payload),
      }),
    )
    .join("\n");
}

export function exportMessagesAsLog(messages: readonly BrowseSentEventMessage[]): string {
  return messages
    .map((message) => {
      const timestamp = message.timestamp.toFixed(3);

      return `${timestamp} ${formatDirection(message.direction)} [${message.protocol}] ${message.type ?? "message"} - ${message.payloadPreview}`;
    })
    .join("\n");
}
