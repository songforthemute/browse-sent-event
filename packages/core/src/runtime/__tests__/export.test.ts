import { describe, expect, it } from "vitest";
import type { BrowseSentEventMessage } from "../events.js";
import { exportMessagesAsJsonl, exportMessagesAsLog } from "../export.js";

const messages: BrowseSentEventMessage[] = [
  {
    id: "msg-1",
    connectionId: "conn-1",
    timestamp: 12.3456,
    direction: "in",
    protocol: "fetch-stream",
    type: "chunk",
    size: 11,
    payload: "First Token",
    payloadPreview: "First Token",
    metadata: {},
  },
  {
    id: "msg-2",
    connectionId: "conn-1",
    timestamp: 13,
    direction: "out",
    protocol: "websocket",
    size: 3,
    payload: new Uint8Array([1, 2, 3]).buffer,
    payloadPreview: "[binary 3 bytes]",
    metadata: {},
  },
];

describe("runtime export helpers", () => {
  it("exports messages as JSONL with serialized binary payloads", () => {
    expect(exportMessagesAsJsonl(messages)).toBe(
      [
        '{"id":"msg-1","connectionId":"conn-1","timestamp":12.3456,"direction":"in","protocol":"fetch-stream","type":"chunk","size":11,"payload":"First Token","payloadPreview":"First Token","metadata":{}}',
        '{"id":"msg-2","connectionId":"conn-1","timestamp":13,"direction":"out","protocol":"websocket","size":3,"payload":{"type":"array-buffer","byteLength":3},"payloadPreview":"[binary 3 bytes]","metadata":{}}',
      ].join("\n"),
    );
  });

  it("exports messages as compact log lines", () => {
    expect(exportMessagesAsLog(messages)).toBe(
      [
        "12.346 IN [fetch-stream] chunk - First Token",
        "13.000 OUT [websocket] message - [binary 3 bytes]",
      ].join("\n"),
    );
  });
});
