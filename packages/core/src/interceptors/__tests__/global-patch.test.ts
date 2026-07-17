import { describe, expect, it } from "vitest";
import { installGlobalPatch } from "../global-patch.js";

const originalFetch = () => Promise.resolve(new globalThis.Response());
const replacementFetch = () => Promise.resolve(new globalThis.Response("instrumented"));
const laterFetch = () => Promise.resolve(new globalThis.Response("later"));
const previousPatchFetch = () => Promise.resolve(new globalThis.Response("previous"));

describe("installGlobalPatch", () => {
  it("restores the original value when the installed replacement is still current", () => {
    const target = {
      fetch: originalFetch,
    };
    const installed = installGlobalPatch(target, "fetch", () => replacementFetch);

    expect(target.fetch).toBe(replacementFetch);

    installed.uninstall();

    expect(target.fetch).toBe(originalFetch);
  });

  it("does not overwrite a later patch during uninstall", () => {
    const target = {
      fetch: originalFetch,
    };
    const installed = installGlobalPatch(target, "fetch", () => replacementFetch);

    target.fetch = laterFetch;
    installed.uninstall();

    expect(target.fetch).toBe(laterFetch);
  });

  it("treats an already patched value as the original for this install", () => {
    const target = {
      fetch: originalFetch,
    };

    target.fetch = previousPatchFetch;

    const installed = installGlobalPatch(target, "fetch", () => replacementFetch);

    installed.uninstall();

    expect(target.fetch).toBe(previousPatchFetch);
  });
});
