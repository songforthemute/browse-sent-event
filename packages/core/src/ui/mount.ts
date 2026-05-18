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

  return {
    element,
    unmount() {
      element.remove();
    },
  };
}
