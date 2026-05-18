import { BrowseSentEventDevtoolsPanelElement } from "./components/devtools-panel.js";

export const devtoolsPanelTagName = "bse-devtools-panel";

export function registerDevtoolsElements(
  target: CustomElementRegistry = globalThis.customElements,
): void {
  if (!target.get(devtoolsPanelTagName)) {
    target.define(devtoolsPanelTagName, BrowseSentEventDevtoolsPanelElement);
  }
}
