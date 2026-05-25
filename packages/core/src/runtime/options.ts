export interface BrowseSentEventOptions {
  readonly capacity?: number;
  readonly panel?: {
    readonly autoOpen?: boolean;
    readonly position?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
    readonly hotkey?: string;
  };
  readonly filter?: {
    readonly excludeUrls?: readonly (string | RegExp)[];
  };
}

export interface ResolvedBrowseSentEventOptions {
  readonly capacity: number;
  readonly panel: {
    readonly autoOpen: boolean;
    readonly position: "bottom-right" | "bottom-left" | "top-right" | "top-left";
    readonly hotkey: string;
  };
  readonly filter: {
    readonly excludeUrls: readonly (string | RegExp)[];
  };
}

export function resolveOptions(
  options: BrowseSentEventOptions = {},
): ResolvedBrowseSentEventOptions {
  return {
    capacity: options.capacity ?? 10_000,
    panel: {
      autoOpen: options.panel?.autoOpen ?? false,
      position: options.panel?.position ?? "bottom-right",
      hotkey: options.panel?.hotkey ?? "cmd+shift+r",
    },
    filter: {
      excludeUrls: options.filter?.excludeUrls ?? [],
    },
  };
}
