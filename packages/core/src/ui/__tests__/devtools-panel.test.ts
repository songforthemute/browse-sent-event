import { describe, expect, it } from "vitest";
import { BrowseSentEventDevtoolsPanelElement } from "../components/devtools-panel.js";
import { devtoolsPanelStyles } from "../components/devtools-panel.styles.js";

describe("BrowseSentEventDevtoolsPanelElement", () => {
  it("uses the shared DevTools panel styles module", () => {
    expect(BrowseSentEventDevtoolsPanelElement.styles).toBe(devtoolsPanelStyles);
  });
});
