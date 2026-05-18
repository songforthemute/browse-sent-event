# Vite 플러그인 주입 구현 계획

> **Claude용:** 필수 하위 스킬: `superpowers:executing-plans`를 사용해 이 계획을 작업 단위로 실행한다.

**목표:** Vite 개발 서버에서 앱 진입 모듈 최상단에 browse-sent-event 부트스트랩을 주입하고, 프로덕션 빌드에서는 관련 코드가 완전히 빠지는 것을 검증한다.

**아키텍처:** `packages/core`는 최상위 실행 부수 효과 없이 명시적 `installBrowseSentEvent()` 함수만 제공한다. `packages/plugin-vite`는 Vite 8 공개 Plugin API(`configResolved`, `transformIndexHtml`, `resolveId`, `load`, `transform`)만 사용해 HTML의 module script 진입점을 기록하고, 해당 진입 모듈에 virtual bootstrap import를 prepend한다. `apply: "serve"`를 유지해 프로덕션 빌드 경로에서는 플러그인이 실행되지 않게 한다.

**기술 스택:** TypeScript 6, Vite 8.0.13, Vitest 4.1.6, happy-dom, tsdown, pnpm workspace, Turborepo.

---

## 기준 문서

- PRD F6.2: 앱 진입점 최상단에 core를 물리적으로 삽입한다.
- PRD F6.3: 프로덕션 번들에 관련 코드가 한 바이트도 포함되지 않는다.
- PRD F6.4: Vite 8/Rolldown 기준에서는 Vite 공개 Plugin API만 사용한다.
- ADR-007: `sideEffects: false`를 유지하고, core 단순 import는 Proxy patch를 실행하지 않는다.
- Vite 플러그인 API: https://vite.dev/guide/api-plugin.html
- Vite JavaScript API: https://vite.dev/guide/api-javascript.html
- Vite 8 마이그레이션 가이드: https://vite.dev/guide/migration.html

## 설계 결정

1. `transformIndexHtml`은 script를 직접 삽입하지 않고 진입점 탐지에만 사용한다.
2. 실제 부트스트랩 실행은 진입 모듈 `transform` 결과의 첫 줄 import로 보장한다.
3. 부트스트랩 모듈은 `virtual:browse-sent-event/bootstrap`으로 노출한다.
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

### 작업 1: Core 부트스트랩 API 추가

**파일:**
- 생성: `packages/core/src/runtime/install.ts`
- 수정: `packages/core/src/index.ts`
- 테스트: `packages/core/src/runtime/__tests__/install.test.ts`

**단계 1: 실패하는 테스트 작성**

`packages/core/src/runtime/__tests__/install.test.ts`를 생성한다.

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

**단계 2: 테스트를 실행해 RED 확인**

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/runtime/__tests__/install.test.ts
```

기대 결과:

- 실패한다.
- 실패 이유에 `install.js` 또는 `installBrowseSentEvent`가 없다는 내용이 포함된다.

**단계 3: 부트스트랩 API 구현**

`packages/core/src/runtime/install.ts`를 생성한다.

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

`packages/core/src/index.ts`를 수정한다.

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

**단계 4: GREEN 확인**

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/runtime/__tests__/install.test.ts
pnpm --filter @browse-sent-event/core typecheck
```

기대 결과:

- 새 install 테스트가 통과한다.
- 타입 검사가 exit code `0`으로 끝난다.

**단계 5: 커밋**

```bash
git add packages/core/src/index.ts packages/core/src/runtime/install.ts packages/core/src/runtime/__tests__/install.test.ts
git commit -m "feat(core): bootstrap 설치 함수 추가"
```

---

### 작업 2: Vite 플러그인 주입 유틸 추가

**파일:**
- 생성: `packages/plugin-vite/src/injection.ts`
- 테스트: `packages/plugin-vite/src/__tests__/injection.test.ts`

**단계 1: 실패하는 테스트 작성**

`packages/plugin-vite/src/__tests__/injection.test.ts`를 생성한다.

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

**단계 2: 테스트를 실행해 RED 확인**

실행:

```bash
pnpm --filter @browse-sent-event/plugin-vite test -- src/__tests__/injection.test.ts
```

기대 결과:

- 실패한다.
- 실패 이유에 `../injection.js`가 없다는 내용이 포함된다.

**단계 3: helper 함수 구현**

`packages/plugin-vite/src/injection.ts`를 생성한다.

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

**단계 4: GREEN 확인**

실행:

```bash
pnpm --filter @browse-sent-event/plugin-vite test -- src/__tests__/injection.test.ts
pnpm --filter @browse-sent-event/plugin-vite typecheck
```

기대 결과:

- helper 테스트가 통과한다.
- 타입 검사가 exit code `0`으로 끝난다.

**단계 5: 커밋**

```bash
git add packages/plugin-vite/src/injection.ts packages/plugin-vite/src/__tests__/injection.test.ts
git commit -m "feat(plugin-vite): bootstrap 주입 유틸 추가"
```

---

### 작업 3: Vite 플러그인에 진입 모듈 transform 연결

**파일:**
- 수정: `packages/plugin-vite/package.json`
- 수정: `packages/plugin-vite/src/index.ts`
- 수정: `packages/plugin-vite/src/__tests__/plugin.test.ts`

**단계 1: 실패하는 테스트 작성**

`packages/plugin-vite/src/__tests__/plugin.test.ts`를 수정한다.

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

Vite 8 hook 타입이 object hook도 허용하기 때문에 TypeScript 오류가 나면, function-form hook만 호출하는 작은 로컬 helper를 테스트에 추가한다. 이번 작업의 production plugin hook은 function-form hook으로 유지한다.

**단계 2: 테스트를 실행해 RED 확인**

실행:

```bash
pnpm --filter @browse-sent-event/plugin-vite test -- src/__tests__/plugin.test.ts
```

기대 결과:

- 기존 metadata 테스트는 통과한다.
- 새 virtual module 테스트는 `resolveId`/`load`가 없어 실패한다.

**단계 3: core dependency 추가**

`packages/plugin-vite/package.json`을 수정한다.

```json
{
  "dependencies": {
    "@browse-sent-event/core": "workspace:*"
  }
}
```

기존 `devDependencies.vite`와 `peerDependencies.vite`는 그대로 둔다.

**단계 4: plugin hook 구현**

`packages/plugin-vite/src/index.ts`를 수정한다.

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

**단계 5: GREEN 확인**

실행:

```bash
pnpm --filter @browse-sent-event/plugin-vite test -- src/__tests__/plugin.test.ts
pnpm --filter @browse-sent-event/plugin-vite typecheck
pnpm install --frozen-lockfile
```

기대 결과:

- plugin 테스트가 통과한다.
- 타입 검사가 exit code `0`으로 끝난다.
- `@browse-sent-event/core` dependency를 추가한 뒤 lockfile이 최신 상태다.

**단계 6: 커밋**

```bash
git add packages/plugin-vite/package.json pnpm-lock.yaml packages/plugin-vite/src/index.ts packages/plugin-vite/src/__tests__/plugin.test.ts
git commit -m "feat(plugin-vite): 개발 entry bootstrap 주입 추가"
```

---

### 작업 4: Vite dev/build fixture 검증 추가

**파일:**
- 생성: `packages/plugin-vite/src/__tests__/vite-fixture.test.ts`

**단계 1: 실패하는 통합 테스트 작성**

`packages/plugin-vite/src/__tests__/vite-fixture.test.ts`를 생성한다.

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

**단계 2: 테스트를 실행해 RED 또는 통합 실패 확인**

실행:

```bash
pnpm --filter @browse-sent-event/plugin-vite test -- src/__tests__/vite-fixture.test.ts
```

작업 3 구현 전 기대 결과:

- bootstrap import가 주입되지 않아 실패한다.

작업 3 구현 후 기대 결과:

- 통과한다.

**단계 3: GREEN 확인**

실행:

```bash
pnpm --filter @browse-sent-event/plugin-vite test -- src/__tests__/vite-fixture.test.ts
pnpm --filter @browse-sent-event/plugin-vite test
```

기대 결과:

- 통합 테스트가 통과한다.
- 모든 plugin-vite 테스트가 통과한다.
- 출력에 `ES2025`, `esbuild`, `oxc options` 경고가 없다.

**단계 4: 커밋**

```bash
git add packages/plugin-vite/src/__tests__/vite-fixture.test.ts
git commit -m "test(plugin-vite): Vite 주입과 프로덕션 제거 검증 추가"
```

---

### 작업 5: 워크스페이스 검증

**파일:**
- 파일 변경 없음.

**단계 1: 전체 검증 실행**

실행:

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

기대 결과:

- 모든 명령이 exit code `0`으로 끝난다.
- `pnpm test`와 캐시 우회 테스트에서 다음을 확인한다.
  - `@browse-sent-event/core`: 모든 테스트 통과.
  - `@browse-sent-event/plugin-vite`: 모든 테스트 통과.
- Vite 6/esbuild `ES2025` 경고가 나타나지 않는다.

**단계 2: 패키지 산출물 확인**

실행:

```bash
test -f packages/core/dist/index.mjs
test -f packages/core/dist/index.d.mts
test -f packages/plugin-vite/dist/index.mjs
test -f packages/plugin-vite/dist/index.d.mts
```

기대 결과:

- 모든 명령이 exit code `0`으로 끝난다.

**단계 3: 보고**

보고 항목:

- 작업 1-4에서 생성한 commit SHA.
- 검증 명령과 결과.
- 이 계획에서 벗어난 사항.

검증 명령을 새로 실행하기 전에는 완료를 주장하지 않는다.
