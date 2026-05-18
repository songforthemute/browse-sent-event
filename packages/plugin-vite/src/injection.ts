import { resolve } from "node:path";
import { normalizePath } from "vite";

export const bootstrapModuleId: string = "virtual:browse-sent-event/bootstrap";
export const resolvedBootstrapModuleId: string = `\0${bootstrapModuleId}`;

const moduleScriptPattern =
  /<script\b(?=[^>]*\btype=["']module["'])(?=[^>]*\bsrc=["']([^"']+)["'])[^>]*><\/script>/gi;

export function collectHtmlModuleEntries(html: string): string[] {
  const entries = new Set<string>();

  for (const match of html.matchAll(moduleScriptPattern)) {
    const src = match[1];

    if (src) {
      entries.add(src);
    }
  }

  return [...entries];
}

export function createBootstrapImport(): string {
  return `import "${bootstrapModuleId}";`;
}

export function createBootstrapModuleCode(): string {
  return [
    `import { installBrowseSentEvent } from "@browse-sent-event/core";`,
    `installBrowseSentEvent();`,
  ].join("\n");
}

export function isEntryModuleId(id: string, entries: Iterable<string>, root: string): boolean {
  const cleanId = normalizePath(id.split("?")[0] ?? id);

  for (const entry of entries) {
    const cleanEntry = entry.split("?")[0] ?? entry;
    const resolvedEntry = normalizePath(resolve(root, cleanEntry.replace(/^\//, "")));

    if (cleanId === resolvedEntry) {
      return true;
    }
  }

  return false;
}
