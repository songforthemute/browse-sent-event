import { describe, expect, it } from "vitest";
import { formatByteSize, formatTimestamp } from "../format.js";

describe("ui format helpers", () => {
  it("formats byte sizes", () => {
    expect(formatByteSize(42)).toBe("42 B");
    expect(formatByteSize(1536)).toBe("1.5 KB");
  });

  it("formats timestamps as time with milliseconds", () => {
    expect(formatTimestamp(3_661_234)).toBe("01:01:01.234");
  });
});
