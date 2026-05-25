import type { BrowseSentEventEngine } from "../runtime/engine.js";
import type { ResolvedBrowseSentEventOptions } from "../runtime/options.js";
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

function matchesHotkey(event: KeyboardEvent, hotkey: string): boolean {
  const normalized = hotkey.toLowerCase();

  return (
    normalized === "cmd+shift+r" &&
    (event.metaKey || event.ctrlKey) &&
    event.shiftKey &&
    event.key.toLowerCase() === "r"
  );
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

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!matchesHotkey(event, options.options.hotkey)) {
      return;
    }

    event.preventDefault();

    const setOpen = Reflect.get(element, "setOpen");

    if (typeof setOpen === "function") {
      setOpen.call(element, !element.hasAttribute("open"));
    }
  };

  options.target.addEventListener("keydown", onKeyDown);

  return {
    element,
    unmount() {
      options.target.removeEventListener("keydown", onKeyDown);
      element.remove();
    },
  };
}
