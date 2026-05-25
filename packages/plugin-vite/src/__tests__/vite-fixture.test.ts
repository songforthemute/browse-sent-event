import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { cwd } from "node:process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { build, createServer, type ViteDevServer } from "vite";
import browseSentEvent from "../index.js";

let root: string;
let server: ViteDevServer | undefined;

async function writeFixture(): Promise<void> {
  await writeFile(
    path.join(root, "index.html"),
    '<div id="app"></div><script type="module" src="/src/main.ts"></script>',
  );
  await writeFile(path.join(root, "package.json"), '{"type":"module"}');
  await writeFile(path.join(root, "src/main.ts"), "window.__fixtureLoaded = true;");
}

async function readDistFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const resolved = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await readDistFiles(resolved)));
    } else {
      files.push(await readFile(resolved, "utf8"));
    }
  }

  return files;
}

describe("browseSentEvent Vite integration", () => {
  beforeEach(async () => {
    root = await mkdtemp(path.join(cwd(), ".tmp-vite-"));
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFixture();
  });

  afterEach(async () => {
    await server?.close();
    server = undefined;
    await rm(root, { recursive: true, force: true });
  });

  it("prepends the bootstrap virtual import to the Vite dev entry module", async () => {
    server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [browseSentEvent()],
      server: {
        middlewareMode: true,
      },
    });

    const html = await readFile(path.join(root, "index.html"), "utf8");
    await server.transformIndexHtml("/index.html", html);
    const result = await server.transformRequest("/src/main.ts");

    const code = result?.code ?? "";

    expect(code).toContain("virtual:browse-sent-event/bootstrap");
    expect(code.indexOf("virtual:browse-sent-event/bootstrap")).toBeLessThan(
      code.indexOf("__fixtureLoaded"),
    );
  });

  it("does not include browse-sent-event code in a production build", async () => {
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [browseSentEvent()],
      build: {
        outDir: "dist",
        emptyOutDir: true,
      },
    });

    const emittedFiles = await readDistFiles(path.join(root, "dist"));

    expect(emittedFiles.join("\n")).not.toContain("browse-sent-event");
  });
});
