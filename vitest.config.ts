import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    target: "esnext",
    tsconfigRaw: {
      compilerOptions: {
        target: "esnext",
      },
    },
  },
  test: {
    environment: "happy-dom",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
    },
  },
});
