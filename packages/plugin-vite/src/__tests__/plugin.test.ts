import { describe, expect, it } from "vitest";
import browseSentEvent from "../index.js";
import { bootstrapModuleId, resolvedBootstrapModuleId } from "../injection.js";

describe("browseSentEvent vite plugin", () => {
  it("exposes a named pre-enforced serve plugin", () => {
    const plugin = browseSentEvent();

    expect(plugin.name).toBe("browse-sent-event:vite");
    expect(plugin.enforce).toBe("pre");
    expect(plugin.apply).toBe("serve");
  });

  it("resolves and loads the virtual bootstrap module", async () => {
    const plugin = browseSentEvent();
    const resolveId = plugin.resolveId;
    const load = plugin.load;

    if (typeof resolveId !== "function" || typeof load !== "function") {
      throw new TypeError("Expected function hooks");
    }

    expect(
      await Reflect.apply(resolveId, undefined, [bootstrapModuleId, undefined, { isEntry: false }]),
    ).toBe(resolvedBootstrapModuleId);
    expect(await Reflect.apply(load, undefined, [resolvedBootstrapModuleId])).toContain(
      "installBrowseSentEvent",
    );
  });

  it("does not inject when disabled", async () => {
    const plugin = browseSentEvent({ enabled: false });
    const transform = plugin.transform;

    if (typeof transform !== "function") {
      throw new TypeError("Expected a function hook");
    }

    expect(
      await Reflect.apply(transform, undefined, [
        "console.log('app');",
        "/repo/src/main.ts",
        {
          moduleType: "js",
        },
      ]),
    ).toBeUndefined();
  });
});
