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

  it("matches an absolute transformed module id against an HTML entry", () => {
    expect(isEntryModuleId("/repo/app/src/main.ts", ["/src/main.ts"], "/repo/app")).toBe(
      true,
    );
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
