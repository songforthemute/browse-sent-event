export type BrowseSentEventHotkeyMatcher = (event: KeyboardEvent) => boolean;

const modifierTokens = new Set(["alt", "cmd", "ctrl", "meta", "shift"]);

export function createHotkeyMatcher(hotkey: string): BrowseSentEventHotkeyMatcher | undefined {
  const tokens = hotkey
    .toLowerCase()
    .split("+")
    .map((token) => token.trim());

  if (tokens.some((token) => token.length === 0)) {
    return undefined;
  }

  const declaredModifiers = new Set<string>();
  const keys: string[] = [];

  for (const token of tokens) {
    if (!modifierTokens.has(token)) {
      keys.push(token);
      continue;
    }

    if (declaredModifiers.has(token)) {
      return undefined;
    }

    declaredModifiers.add(token);
  }

  const key = keys[0];

  if (
    keys.length !== 1 ||
    key === undefined ||
    (declaredModifiers.has("cmd") &&
      (declaredModifiers.has("meta") || declaredModifiers.has("ctrl")))
  ) {
    return undefined;
  }

  return (event) => {
    const primaryMatches = declaredModifiers.has("cmd")
      ? event.metaKey !== event.ctrlKey
      : event.metaKey === declaredModifiers.has("meta") &&
        event.ctrlKey === declaredModifiers.has("ctrl");

    return (
      primaryMatches &&
      event.altKey === declaredModifiers.has("alt") &&
      event.shiftKey === declaredModifiers.has("shift") &&
      event.key.toLowerCase() === key
    );
  };
}
