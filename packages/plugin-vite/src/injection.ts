import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { BrowseSentEventOptions } from "@browse-sent-event/core";
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

function serializeProperty(name: string, value: string | undefined): string | undefined {
  return value === undefined ? undefined : `${JSON.stringify(name)}:${value}`;
}

function serializeObject(properties: readonly (string | undefined)[]): string {
  return `{${properties
    .filter((property): property is string => property !== undefined)
    .join(",")}}`;
}

function serializePanel(panel: NonNullable<BrowseSentEventOptions["panel"]>): string {
  return serializeObject([
    serializeProperty(
      "autoOpen",
      panel.autoOpen === undefined ? undefined : JSON.stringify(panel.autoOpen),
    ),
    serializeProperty(
      "position",
      panel.position === undefined ? undefined : JSON.stringify(panel.position),
    ),
    serializeProperty(
      "hotkey",
      panel.hotkey === undefined ? undefined : JSON.stringify(panel.hotkey),
    ),
  ]);
}

function serializeExcludeUrl(pattern: string | RegExp): string {
  return typeof pattern === "string"
    ? JSON.stringify(pattern)
    : `new RegExp(${JSON.stringify(pattern.source)}, ${JSON.stringify(pattern.flags)})`;
}

function serializeFilter(filter: NonNullable<BrowseSentEventOptions["filter"]>): string {
  return serializeObject([
    serializeProperty(
      "excludeUrls",
      filter.excludeUrls === undefined
        ? undefined
        : `[${filter.excludeUrls.map(serializeExcludeUrl).join(",")}]`,
    ),
  ]);
}

export function serializeBrowseSentEventOptions(options: BrowseSentEventOptions = {}): string {
  return serializeObject([
    serializeProperty(
      "capacity",
      options.capacity === undefined ? undefined : JSON.stringify(options.capacity),
    ),
    serializeProperty(
      "panel",
      options.panel === undefined ? undefined : serializePanel(options.panel),
    ),
    serializeProperty(
      "filter",
      options.filter === undefined ? undefined : serializeFilter(options.filter),
    ),
  ]);
}

export function createBootstrapModuleCode(options: BrowseSentEventOptions = {}): string {
  return [
    `import { installBrowseSentEvent } from "@browse-sent-event/core";`,
    `installBrowseSentEvent(${serializeBrowseSentEventOptions(options)});`,
  ].join("\n");
}

function normalizeRealPath(path: string): string {
  try {
    return normalizePath(realpathSync(path));
  } catch {
    return normalizePath(path);
  }
}

export function isEntryModuleId(id: string, entries: Iterable<string>, root: string): boolean {
  const cleanId = normalizePath(id.split("?")[0] ?? id);
  const realCleanId = normalizeRealPath(cleanId);

  for (const entry of entries) {
    const cleanEntry = entry.split("?")[0] ?? entry;
    const resolvedEntry = normalizePath(resolve(root, cleanEntry.replace(/^\//, "")));
    const realResolvedEntry = normalizeRealPath(resolvedEntry);

    if (
      cleanId === resolvedEntry ||
      cleanId === realResolvedEntry ||
      realCleanId === resolvedEntry
    ) {
      return true;
    }
  }

  return false;
}
