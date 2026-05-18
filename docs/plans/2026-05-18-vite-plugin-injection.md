# Vite 플러그인 주입 구현 계획

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**목표:** Vite 개발 서버에서 앱 entry module 최상단에 browse-sent-event bootstrap을 주입하고, 프로덕션 빌드에서는 관련 코드가 완전히 빠지는 것을 검증한다.

**아키텍처:** `packages/core`는 top-level side effect 없이 명시적 `installBrowseSentEvent()` 함수만 제공한다. `packages/plugin-vite`는 Vite 8 공개 Plugin API(`configResolved`, `transformIndexHtml`, `resolveId`, `load`, `transform`)만 사용해 HTML의 module script entry를 기록하고, 해당 entry module에 virtual bootstrap import를 prepend한다. `apply: "serve"`를 유지해 production build 경로에서는 플러그인이 실행되지 않게 한다.

**기술 스택:** TypeScript 6, Vite 8.0.13, Vitest 4.1.6, happy-dom, tsdown, pnpm workspace, Turborepo.

---

## 기준 문서

- PRD F6.2: 앱 진입점 최상단에 core를 물리적으로 삽입한다.
- PRD F6.3: 프로덕션 번들에 관련 코드가 한 바이트도 포함되지 않는다.
- PRD F6.4: Vite 8/Rolldown 기준에서는 Vite 공개 Plugin API만 사용한다.
- ADR-007: `sideEffects: false`를 유지하고, core 단순 import는 Proxy patch를 실행하지 않는다.
- Vite Plugin API: https://vite.dev/guide/api-plugin.html
- Vite JavaScript API: https://vite.dev/guide/api-javascript.html
- Vite 8 Migration Guide: https://vite.dev/guide/migration.html

## 설계 결정

1. `transformIndexHtml`은 script를 직접 삽입하지 않고 entry 탐지에만 사용한다.
2. 실제 bootstrap 실행은 entry module `transform` 결과의 첫 줄 import로 보장한다.
3. bootstrap module은 `virtual:browse-sent-event/bootstrap`으로 노출한다.
4. virtual module은 `@browse-sent-event/core`의 `installBrowseSentEvent()`를 호출한다.
5. `packages/plugin-vite`는 `@browse-sent-event/core`를 workspace dependency로 갖는다.
6. HTML parsing은 Phase 1 범위에서 `<script type="module" src="...">`만 지원하는 작은 유틸로 시작한다. import map, inline module script, framework-specific HTML mutation은 이번 작업의 범위가 아니다.

## 비범위

- WebSocket/fetch/EventSource 실제 인터셉터 구현
- DevTools UI 렌더링
- iframe/worker entry 주입
- webpack/Rspack/Next/Nuxt 지원
- `transformWithEsbuild`, `optimizeDeps.esbuildOptions`, `build.rollupOptions` 기반 구현

---

### Task 1: Core bootstrap API 추가

**Files:**
- Create: `packages/core/src/runtime/install.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/runtime/__tests__/install.test.ts`

**Step 1: Write the failing test**

Create `packages/core/src/runtime/__tests__/install.test.ts`.

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { installBrowseSentEvent } from "../install.js";

describe("installBrowseSentEvent", () => {
  beforeEach(() => {
    delete (window as unknown as Record<string, unknown>).__browseSentEventRuntime__;
  });

  it("installs the runtime once and returns the same runtime on repeated calls", () => {
    const first = installBrowseSentEvent({ capacity: 123 });
    const second = installBrowseSentEvent({ capacity: 456 });

    expect(first.installed).toBe(true);
    expect(first.capacity).toBe(123);
    expect(second).toBe(first);
  });
});
```

**Step 2: Run the test and verify RED**

Run:

```bash
pnpm --filter @browse-sent-event/core test -- src/runtime/__tests__/install.test.ts
```

Expected:

- FAIL
- Failure reason mentions `install.js` or `installBrowseSentEvent` missing.

**Step 3: Implement the bootstrap API**

Create `packages/core/src/runtime/install.ts`.

```typescript
import { createBrowseSentEventRuntime, type BrowseSentEventRuntime } from "./create-engine.js";
import type { BrowseSentEventOptions } from "./options.js";

const runtimeKey = "__browseSentEventRuntime__";

type RuntimeWindow = Window & {
  [runtimeKey]?: BrowseSentEventRuntime;
};

function getRuntimeWindow(): RuntimeWindow | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window as RuntimeWindow;
}

export function installBrowseSentEvent(
  options?: BrowseSentEventOptions,
): BrowseSentEventRuntime {
  const target = getRuntimeWindow();

  if (!target) {
    return {
      ...createBrowseSentEventRuntime(options),
      installed: false,
    };
  }

  if (target[runtimeKey]) {
    return target[runtimeKey];
  }

  const runtime: BrowseSentEventRuntime = {
    ...createBrowseSentEventRuntime(options),
    installed: true,
  };

  target[runtimeKey] = runtime;

  return runtime;
}
```

Modify `packages/core/src/index.ts`.

```typescript
export {
  installBrowseSentEvent,
} from "./runtime/install.js";
export {
  createBrowseSentEventRuntime,
  type BrowseSentEventRuntime,
} from "./runtime/create-engine.js";
export {
  resolveOptions,
  type BrowseSentEventOptions,
  type ResolvedBrowseSentEventOptions,
} from "./runtime/options.js";
```

**Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @browse-sent-event/core test -- src/runtime/__tests__/install.test.ts
pnpm --filter @browse-sent-event/core typecheck
```

Expected:

- The new install test passes.
- Typecheck exits `0`.

**Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/runtime/install.ts packages/core/src/runtime/__tests__/install.test.ts
git commit -m "feat(core): bootstrap 설치 함수 추가"
```

---

### Task 2: Vite plugin injection 유틸 추가

**Files:**
- Create: `packages/plugin-vite/src/injection.ts`
- Test: `packages/plugin-vite/src/__tests__/injection.test.ts`

**Step 1: Write the failing tests**

Create `packages/plugin-vite/src/__tests__/injection.test.ts`.

```typescript
import { describe, expect, it } from "vitest";
import {
  bootstrapModuleId,
  collectHtmlModuleEntries,
  createBootstrapImport,
  createBootstrapModuleCode,
  isEntryModuleId,
  resolvedBootstrapModuleId,
} from "../injection.js";

describe("vite injection helpers", () => {
  it("collects Vite HTML module script entries", () => {
    const html = '<div id="app"></div><script type="module" src="/src/main.ts"></script>';

    expect(collectHtmlModuleEntries(html)).toEqual(["/src/main.ts"]);
  });

  it("matches an absolute transformed module id against an HTML entry", () => {
    expect(
      isEntryModuleId("/repo/app/src/main.ts", ["/src/main.ts"], "/repo/app"),
    ).toBe(true);
  });

  it("creates the virtual bootstrap import", () => {
    expect(createBootstrapImport()).toBe(`import "${bootstrapModuleId}";`);
  });

  it("creates virtual bootstrap module code that calls core install", () => {
    expect(createBootstrapModuleCode()).toContain("@browse-sent-event/core");
    expect(createBootstrapModuleCode()).toContain("installBrowseSentEvent");
  });

  it("uses the Vite virtual module resolved id convention", () => {
    expect(resolvedBootstrapModuleId).toBe(`\\0${bootstrapModuleId}`);
  });
});
```

**Step 2: Run the tests and verify RED**

Run:

```bash
pnpm --filter @browse-sent-event/plugin-vite test -- src/__tests__/injection.test.ts
```

Expected:

- FAIL
- Failure reason mentions missing `../injection.js`.

**Step 3: Implement helper functions**

Create `packages/plugin-vite/src/injection.ts`.

```typescript
import path from "node:path";
import { normalizePath } from "vite";

export const bootstrapModuleId = "virtual:browse-sent-event/bootstrap";
export const resolvedBootstrapModuleId = `\0${bootstrapModuleId}`;

const moduleScriptPattern =
  /<script\b(?=[^>]*\btype=["']module["'])(?=[^>]*\bsrc=["']([^"']+)["'])[^>]*><\/script>/gi;

export function collectHtmlModuleEntries(html: string): string[] {
  const entries = new Set<string>();

  for (const match of html.matchAll(moduleScriptPattern)) {
    const src = match[1];

    if (src) {
      entries.add(src);
    }
  }

  return [...entries];
}

export function createBootstrapImport(): string {
  return `import "${bootstrapModuleId}";`;
}

export function createBootstrapModuleCode(): string {
  return [
    `import { installBrowseSentEvent } from "@browse-sent-event/core";`,
    `installBrowseSentEvent();`,
  ].join("\n");
}

export function isEntryModuleId(
  id: string,
  entries: Iterable<string>,
  root: string,
): boolean {
  const cleanId = normalizePath(id.split("?")[0] ?? id);

  for (const entry of entries) {
    const cleanEntry = entry.split("?")[0] ?? entry;
    const resolvedEntry = normalizePath(path.resolve(root, cleanEntry.replace(/^\//, "")));

    if (cleanId === resolvedEntry) {
      return true;
    }
  }

  return false;
}
```

**Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @browse-sent-event/plugin-vite test -- src/__tests__/injection.test.ts
pnpm --filter @browse-sent-event/plugin-vite typecheck
```

Expected:

- Helper tests pass.
- Typecheck exits `0`.

**Step 5: Commit**

```bash
git add packages/plugin-vite/src/injection.ts packages/plugin-vite/src/__tests__/injection.test.ts
git commit -m "feat(plugin-vite): bootstrap 주입 유틸 추가"
```

---

### Task 3: Vite plugin에 entry transform 연결

**Files:**
- Modify: `packages/plugin-vite/package.json`
- Modify: `packages/plugin-vite/src/index.ts`
- Modify: `packages/plugin-vite/src/__tests__/plugin.test.ts`

**Step 1: Write the failing tests**

Modify `packages/plugin-vite/src/__tests__/plugin.test.ts`.

```typescript
import { describe, expect, it } from "vitest";
import browseSentEvent from "../index.js";
import { bootstrapModuleId } from "../injection.js";

describe("browseSentEvent vite plugin", () => {
  it("exposes a named pre-enforced serve plugin", () => {
    const plugin = browseSentEvent();

    expect(plugin.name).toBe("browse-sent-event:vite");
    expect(plugin.enforce).toBe("pre");
    expect(plugin.apply).toBe("serve");
  });

  it("resolves and loads the virtual bootstrap module", async () => {
    const plugin = browseSentEvent();

    expect(await plugin.resolveId?.(bootstrapModuleId)).toBe("\0virtual:browse-sent-event/bootstrap");
    expect(await plugin.load?.("\0virtual:browse-sent-event/bootstrap")).toContain(
      "installBrowseSentEvent",
    );
  });

  it("does not inject when disabled", async () => {
    const plugin = browseSentEvent({ enabled: false });

    expect(await plugin.transform?.("console.log('app');", "/repo/src/main.ts")).toBeUndefined();
  });
});
```

If TypeScript complains because Vite hook types can be object hooks in Vite 8, adjust the test by adding a tiny local helper that calls function-form hooks only. Keep the production plugin hooks as function-form hooks for this task.

**Step 2: Run the tests and verify RED**

Run:

```bash
pnpm --filter @browse-sent-event/plugin-vite test -- src/__tests__/plugin.test.ts
```

Expected:

- Existing metadata test passes.
- New virtual module test fails because `resolveId`/`load` are missing.

**Step 3: Add core dependency**

Modify `packages/plugin-vite/package.json`.

```json
{
  "dependencies": {
    "@browse-sent-event/core": "workspace:*"
  }
}
```

Keep existing `devDependencies.vite` and `peerDependencies.vite` unchanged.

**Step 4: Implement plugin hooks**

Modify `packages/plugin-vite/src/index.ts`.

```typescript
import type { Plugin, ResolvedConfig } from "vite";
import {
  bootstrapModuleId,
  collectHtmlModuleEntries,
  createBootstrapImport,
  createBootstrapModuleCode,
  isEntryModuleId,
  resolvedBootstrapModuleId,
} from "./injection.js";

export interface BrowseSentEventVitePluginOptions {
  readonly enabled?: boolean;
}

export default function browseSentEvent(options: BrowseSentEventVitePluginOptions = {}): Plugin {
  const enabled = options.enabled ?? true;
  const htmlEntries = new Set<string>();
  let config: ResolvedConfig | undefined;

  return {
    name: "browse-sent-event:vite",
    enforce: "pre",
    apply: "serve",
    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },
    transformIndexHtml(html) {
      if (!enabled) {
        return;
      }

      for (const entry of collectHtmlModuleEntries(html)) {
        htmlEntries.add(entry);
      }
    },
    resolveId(id) {
      if (id === bootstrapModuleId) {
        return resolvedBootstrapModuleId;
      }
    },
    load(id) {
      if (id === resolvedBootstrapModuleId) {
        return createBootstrapModuleCode();
      }
    },
    transform(code, id) {
      if (!enabled || !config || !isEntryModuleId(id, htmlEntries, config.root)) {
        return;
      }

      return {
        code: `${createBootstrapImport()}\n${code}`,
        map: null,
      };
    },
  };
}
```

**Step 5: Verify GREEN**

Run:

```bash
pnpm --filter @browse-sent-event/plugin-vite test -- src/__tests__/plugin.test.ts
pnpm --filter @browse-sent-event/plugin-vite typecheck
pnpm install --frozen-lockfile
```

Expected:

- Plugin tests pass.
- Typecheck exits `0`.
- Lockfile is up to date after adding `@browse-sent-event/core` dependency.

**Step 6: Commit**

```bash
git add packages/plugin-vite/package.json pnpm-lock.yaml packages/plugin-vite/src/index.ts packages/plugin-vite/src/__tests__/plugin.test.ts
git commit -m "feat(plugin-vite): 개발 entry bootstrap 주입 추가"
```

---

### Task 4: Vite dev/build fixture 검증 추가

**Files:**
- Create: `packages/plugin-vite/src/__tests__/vite-fixture.test.ts`

**Step 1: Write the failing integration tests**

Create `packages/plugin-vite/src/__tests__/vite-fixture.test.ts`.

```typescript
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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
    root = await mkdtemp(path.join(tmpdir(), "browse-sent-event-vite-"));
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

    expect(result?.code).toContain('import "virtual:browse-sent-event/bootstrap";');
    expect(result?.code.indexOf("virtual:browse-sent-event/bootstrap")).toBeLessThan(
      result?.code.indexOf("__fixtureLoaded") ?? Number.POSITIVE_INFINITY,
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
```

**Step 2: Run the test and verify RED or integration failure**

Run:

```bash
pnpm --filter @browse-sent-event/plugin-vite test -- src/__tests__/vite-fixture.test.ts
```

Expected before Task 3 implementation:

- FAIL because no bootstrap import is injected.

Expected after Task 3 implementation:

- PASS.

**Step 3: Verify GREEN**

Run:

```bash
pnpm --filter @browse-sent-event/plugin-vite test -- src/__tests__/vite-fixture.test.ts
pnpm --filter @browse-sent-event/plugin-vite test
```

Expected:

- Integration tests pass.
- All plugin-vite tests pass.
- Output has no `ES2025`, `esbuild`, or `oxc options` warning.

**Step 4: Commit**

```bash
git add packages/plugin-vite/src/__tests__/vite-fixture.test.ts
git commit -m "test(plugin-vite): Vite 주입과 프로덕션 제거 검증 추가"
```

---

### Task 5: Workspace verification

**Files:**
- No file changes expected.

**Step 1: Run full verification**

Run:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm exec turbo run test --force
pnpm exec turbo run typecheck --force
pnpm exec turbo run build --force
pnpm lint
pnpm format:check
git diff --check
```

Expected:

- Every command exits `0`.
- `pnpm test` and forced tests show:
  - `@browse-sent-event/core`: all tests pass.
  - `@browse-sent-event/plugin-vite`: all tests pass.
- No Vite 6/esbuild `ES2025` warning appears.

**Step 2: Inspect package outputs**

Run:

```bash
test -f packages/core/dist/index.mjs
test -f packages/core/dist/index.d.mts
test -f packages/plugin-vite/dist/index.mjs
test -f packages/plugin-vite/dist/index.d.mts
```

Expected:

- All commands exit `0`.

**Step 3: Report**

Report:

- Commit SHAs created for Tasks 1-4.
- Verification commands and outcomes.
- Any deviation from this plan.

Do not claim completion until the verification commands have been run fresh.
