import { describe, expect, it } from "vitest";
import { createUrlFilter } from "../url-filter.js";

describe("createUrlFilter", () => {
  it("matches case-sensitive URL substrings", () => {
    const shouldExcludeUrl = createUrlFilter(["/health"]);

    expect(shouldExcludeUrl("https://example.test/health?ready=1")).toBe(true);
    expect(shouldExcludeUrl("https://example.test/HEALTH")).toBe(false);
    expect(shouldExcludeUrl("https://example.test/events")).toBe(false);
  });

  it("matches regular expressions with their configured flags", () => {
    const shouldExcludeUrl = createUrlFilter([/\/internal\/events(?:\?|$)/i]);

    expect(shouldExcludeUrl("https://example.test/INTERNAL/EVENTS?cursor=1")).toBe(true);
    expect(shouldExcludeUrl("https://example.test/internal/messages")).toBe(false);
  });

  it.each(["g", "y"])(
    "keeps %s regular expressions deterministic without mutating the input",
    (flag) => {
      const pattern = new RegExp("internal/events", flag);
      pattern.lastIndex = 4;
      const shouldExcludeUrl = createUrlFilter([pattern]);
      const url = flag === "y" ? "internal/events" : "https://example.test/internal/events";

      expect(shouldExcludeUrl(url)).toBe(true);
      expect(shouldExcludeUrl(url)).toBe(true);
      expect(pattern.lastIndex).toBe(4);
    },
  );

  it("ignores regular expressions that cannot be observed safely", () => {
    const pattern = new Proxy(/ignored/, {
      get() {
        throw new Error("blocked getter");
      },
    });
    const shouldExcludeUrl = createUrlFilter([pattern]);

    expect(shouldExcludeUrl("https://example.test/ignored")).toBe(false);
  });

  it("includes every URL when no patterns are configured", () => {
    const shouldExcludeUrl = createUrlFilter([]);

    expect(shouldExcludeUrl("https://example.test/anything")).toBe(false);
  });
});
