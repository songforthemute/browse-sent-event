import type { BrowseSentEventEngine } from "../runtime/engine.js";
import type { ResolvedBrowseSentEventOptions } from "../runtime/options.js";
import { createHotkeyMatcher } from "./hotkey.js";
import { devtoolsPanelTagName, registerDevtoolsElements } from "./register.js";

export interface MountedDevtoolsPanel {
  readonly element: HTMLElement;
  unmount(): void;
}

export interface MountDevtoolsPanelOptions {
  readonly engine: BrowseSentEventEngine;
  readonly options: ResolvedBrowseSentEventOptions["panel"];
  readonly target: Window & typeof globalThis;
}

export function mountDevtoolsPanel(options: MountDevtoolsPanelOptions): MountedDevtoolsPanel {
  registerDevtoolsElements(options.target.customElements);

  const element = options.target.document.createElement(devtoolsPanelTagName);

  Reflect.set(element, "engine", options.engine);
  Reflect.set(element, "open", options.options.autoOpen);
  element.setAttribute("data-position", options.options.position);

  if (options.options.autoOpen) {
    element.setAttribute("open", "");
  }

  options.target.document.body.append(element);

  const matchesHotkey = createHotkeyMatcher(options.options.hotkey);
  const onKeyDown = matchesHotkey
    ? (event: KeyboardEvent): void => {
        if (!matchesHotkey(event)) {
          return;
        }

        event.preventDefault();

        const setOpen = Reflect.get(element, "setOpen");

        if (typeof setOpen === "function") {
          setOpen.call(element, !element.hasAttribute("open"));
        }
      }
    : undefined;

  if (onKeyDown) {
    options.target.addEventListener("keydown", onKeyDown);
  }

  return {
    element,
    unmount() {
      if (onKeyDown) {
        options.target.removeEventListener("keydown", onKeyDown);
      }

      element.remove();
    },
  };
}
