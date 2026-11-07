import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  deps: {
    neverBundle: ["@browse-sent-event/core", "zustand", "zustand/vanilla"],
  },
});
