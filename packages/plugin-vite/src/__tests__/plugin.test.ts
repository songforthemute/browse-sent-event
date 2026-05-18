import { describe, expect, it } from "vitest";
import type { Plugin } from "vite";
import browseSentEvent from "../index.js";
import { bootstrapModuleId, resolvedBootstrapModuleId } from "../injection.js";

function expectFunctionHook<TArgs extends readonly unknown[], TResult>(
  hook: Plugin[keyof Plugin],
): (...args: TArgs) => TResult | Promise<TResult> {
  if (typeof hook !== "function") {
    throw new TypeError("Expected a function hook");
  }

  return hook as (...args: TArgs) => TResult | Promise<TResult>;
}

describe("browseSentEvent vite plugin", () => {
  it("exposes a named pre-enforced serve plugin", () => {
    const plugin = browseSentEvent();

    expect(plugin.name).toBe("browse-sent-event:vite");
    expect(plugin.enforce).toBe("pre");
    expect(plugin.apply).toBe("serve");
  });

  it("resolves and loads the virtual bootstrap module", async () => {
    const plugin = browseSentEvent();
    const resolveId = expectFunctionHook<[string], string | undefined>(plugin.resolveId);
    const load = expectFunctionHook<[string], string | undefined>(plugin.load);

    expect(await resolveId(bootstrapModuleId)).toBe(resolvedBootstrapModuleId);
    expect(await load(resolvedBootstrapModuleId)).toContain("installBrowseSentEvent");
  });

  it("does not inject when disabled", async () => {
    const plugin = browseSentEvent({ enabled: false });
    const transform = expectFunctionHook<[string, string], undefined>(plugin.transform);

    expect(await transform("console.log('app');", "/repo/src/main.ts")).toBeUndefined();
  });
});
