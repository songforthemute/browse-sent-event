import { describe, expect, it } from "vitest";
import {
  bootstrapModuleId,
  collectHtmlModuleEntries,
  createBootstrapImport,
  createBootstrapModuleCode,
  isEntryModuleId,
  resolvedBootstrapModuleId,
} from "../injection.js";

describe("vite injection helpers", () => {
  it("collects Vite HTML module script entries", () => {
    const html = '<div id="app"></div><script type="module" src="/src/main.ts"></script>';

    expect(collectHtmlModuleEntries(html)).toEqual(["/src/main.ts"]);
  });

  it("collects module entries with mixed attributes, query strings, and relative paths", () => {
    const html = [
      '<script defer src="/src/main.ts?t=1" type="module"></script>',
      '<script type="module" crossorigin src="./src/admin.ts"></script>',
      '<script src="/src/legacy.js"></script>',
    ].join("");

    expect(collectHtmlModuleEntries(html)).toEqual(["/src/main.ts?t=1", "./src/admin.ts"]);
  });

  it("matches an absolute transformed module id against an HTML entry", () => {
    expect(isEntryModuleId("/repo/app/src/main.ts", ["/src/main.ts"], "/repo/app")).toBe(true);
  });

  it("matches transformed module ids when either side has query parameters or relative paths", () => {
    expect(isEntryModuleId("/repo/app/src/main.ts?import", ["/src/main.ts?t=1"], "/repo/app")).toBe(
      true,
    );
    expect(isEntryModuleId("/repo/app/src/admin.ts", ["./src/admin.ts"], "/repo/app")).toBe(true);
  });

  it("creates the virtual bootstrap import", () => {
    expect(createBootstrapImport()).toBe(`import "${bootstrapModuleId}";`);
  });

  it("creates virtual bootstrap module code that calls core install", () => {
    expect(createBootstrapModuleCode()).toContain("@browse-sent-event/core");
    expect(createBootstrapModuleCode()).toContain("installBrowseSentEvent");
  });

  it("uses the Vite virtual module resolved id convention", () => {
    expect(resolvedBootstrapModuleId).toBe(`\0${bootstrapModuleId}`);
  });
});
