import { describe, expect, it } from "vitest";
import { createHotkeyMatcher } from "../hotkey.js";

function keyboardEvent(key: string, init: Omit<KeyboardEventInit, "key"> = {}): KeyboardEvent {
  return new globalThis.KeyboardEvent("keydown", { ...init, key });
}

describe("createHotkeyMatcher", () => {
  it("matches portable cmd with either meta or control", () => {
    const matches = createHotkeyMatcher("cmd+shift+b");

    expect(matches?.(keyboardEvent("b", { metaKey: true, shiftKey: true }))).toBe(true);
    expect(matches?.(keyboardEvent("B", { ctrlKey: true, shiftKey: true }))).toBe(true);
  });

  it("matches explicit modifiers regardless of token order and whitespace", () => {
    const matches = createHotkeyMatcher(" K + ALT + ctrl ");

    expect(matches?.(keyboardEvent("k", { altKey: true, ctrlKey: true }))).toBe(true);
  });

  it("requires an exact modifier set", () => {
    const matches = createHotkeyMatcher("ctrl+alt+k");

    expect(matches?.(keyboardEvent("k", { altKey: true, ctrlKey: true }))).toBe(true);
    expect(
      matches?.(
        keyboardEvent("k", {
          altKey: true,
          ctrlKey: true,
          shiftKey: true,
        }),
      ),
    ).toBe(false);
  });

  it("does not match cmd when meta and control are both pressed", () => {
    const matches = createHotkeyMatcher("cmd+r");

    expect(matches?.(keyboardEvent("r", { ctrlKey: true, metaKey: true }))).toBe(false);
  });

  it.each(["", "cmd", "cmd++r", "cmd+r+k", "shift+shift+r", "cmd+ctrl+r", "cmd+meta+r"])(
    "rejects invalid hotkey %s",
    (hotkey) => {
      expect(createHotkeyMatcher(hotkey)).toBeUndefined();
    },
  );
});
