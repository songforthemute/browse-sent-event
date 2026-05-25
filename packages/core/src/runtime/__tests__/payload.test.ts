import { describe, expect, it } from "vitest";
import { createPayloadSummary, serializePayloadForExport } from "../payload.js";

describe("payload helpers", () => {
  it("summarizes text payloads with byte size and a 100 character preview", () => {
    const payload = "a".repeat(120);

    expect(createPayloadSummary(payload)).toEqual({
      payload,
      payloadPreview: "a".repeat(100),
      size: 120,
    });
  });

  it("summarizes ArrayBuffer payloads without stringifying binary data", () => {
    const payload = new Uint8Array([1, 2, 3]).buffer;

    expect(createPayloadSummary(payload)).toEqual({
      payload,
      payloadPreview: "[binary 3 bytes]",
      size: 3,
    });
  });

  it("serializes binary payloads for JSONL export", () => {
    const payload = new Uint8Array([1, 2, 3]).buffer;

    expect(serializePayloadForExport(payload)).toEqual({
      type: "array-buffer",
      byteLength: 3,
    });
  });
});
