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

  it("serializes core runtime options into the virtual bootstrap module", () => {
    const pattern = /\/internal\/events(?:\?|$)/gi;
    const code = createBootstrapModuleCode({
      capacity: 250,
      filter: {
        excludeUrls: ["/health", pattern],
      },
      panel: {
        autoOpen: true,
        hotkey: "ctrl+alt+k",
        position: "top-left",
      },
    });

    expect(code).toContain('"capacity":250');
    expect(code).toContain('"autoOpen":true');
    expect(code).toContain('"hotkey":"ctrl+alt+k"');
    expect(code).toContain('"position":"top-left"');
    expect(code).toContain(JSON.stringify("/health"));
    expect(code).toContain(
      `new RegExp(${JSON.stringify(pattern.source)}, ${JSON.stringify(pattern.flags)})`,
    );
  });

  it("uses JSON string escaping and omits plugin-only options", () => {
    const specialUrl = '</script>\n"한글"';
    const code = createBootstrapModuleCode({
      filter: {
        excludeUrls: [specialUrl],
      },
    });

    expect(code).toContain(JSON.stringify(specialUrl));
    expect(code).not.toContain('"enabled"');
  });

  it("uses the Vite virtual module resolved id convention", () => {
    expect(resolvedBootstrapModuleId).toBe(`\0${bootstrapModuleId}`);
  });
});
