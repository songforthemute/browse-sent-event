import type { Plugin, ResolvedConfig } from "vite";
import {
  bootstrapModuleId,
  collectHtmlModuleEntries,
  createBootstrapImport,
  createBootstrapModuleCode,
  isEntryModuleId,
  resolvedBootstrapModuleId,
} from "./injection.js";

export interface BrowseSentEventVitePluginOptions {
  readonly enabled?: boolean;
}

export default function browseSentEvent(options: BrowseSentEventVitePluginOptions = {}): Plugin {
  const enabled = options.enabled ?? true;
  const htmlEntries = new Set<string>();
  let config: ResolvedConfig | undefined;

  return {
    name: "browse-sent-event:vite",
    enforce: "pre",
    apply: "serve",
    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },
    transformIndexHtml(html) {
      if (!enabled) {
        return;
      }

      for (const entry of collectHtmlModuleEntries(html)) {
        htmlEntries.add(entry);
      }
    },
    resolveId(id) {
      if (id === bootstrapModuleId) {
        return resolvedBootstrapModuleId;
      }
    },
    load(id) {
      if (id === resolvedBootstrapModuleId) {
        return createBootstrapModuleCode();
      }
    },
    transform(code, id) {
      if (!enabled || !config || !isEntryModuleId(id, htmlEntries, config.root)) {
        return;
      }

      return {
        code: `${createBootstrapImport()}\n${code}`,
        map: null,
      };
    },
  };
}
