import type { Plugin } from "vite";

export interface BrowseSentEventVitePluginOptions {
  readonly enabled?: boolean;
}

export default function browseSentEvent(options: BrowseSentEventVitePluginOptions = {}): Plugin {
  const enabled = options.enabled ?? true;

  return {
    name: "browse-sent-event:vite",
    enforce: "pre",
    apply: "serve",
    configResolved() {
      if (!enabled) {
        return;
      }
    },
  };
}
