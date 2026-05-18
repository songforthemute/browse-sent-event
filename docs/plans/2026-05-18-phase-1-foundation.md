# Phase 1 기반 구현 계획

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**목표:** 빈 저장소를 Phase 1 기능 구현이 가능한 pnpm 모노레포 기반으로 만든다.

**아키텍처:** 루트 워크스페이스는 pnpm workspace와 Turborepo가 태스크를 조율한다. `packages/core`는 브라우저 런타임과 DevTools UI의 기반 public API를 제공하고, `packages/plugin-vite`는 Vite 전용 주입 지점을 제공한다. 이 계획은 실제 인터셉터와 UI 구현에 들어가기 전에 빌드, 타입 검사, 테스트, 린트, 포맷, 문서, 에이전트 하네스가 함께 동작하는 최소 골격을 만든다.

**기술 스택:** pnpm workspace, Turborepo, Changesets, TypeScript 6.x, tsdown, Vitest, happy-dom, Playwright, Oxlint, Oxfmt, Lit 3.x, Vite.

---

## 기준 문서

- `docs/browse-sent-event-prd.md`
- `docs/browse-sent-event-adr.md`
- `docs/browse-sent-event-v2.md`

## 범위

이 계획은 기반만 만든다. WebSocket, fetch stream, EventSource 인터셉트, 플로팅 패널 UI, 검색, export, 프로덕션 번들 제거 검증은 구현하지 않는다. 해당 기능들은 기반 작업 이후 별도 Phase 1 기능 계획에서 다룬다.

## 준수 기준

- ADR-001: pnpm workspace + Turborepo + Changesets.
- ADR-002: `packages/`, `examples/`, `docs/`, `.ai/` 경계.
- ADR-007: ESM-only package exports와 `sideEffects: false`.
- ADR-012: 런타임 의존성 최소화. `packages/core`는 `lit` 의존을 허용하고, `packages/plugin-vite`는 `vite`를 peer dependency로 둔다.
- ADR-014: TypeScript 6.x, strict mode, `isolatedDeclarations`.
- ADR-015: 패키지 빌드는 tsdown 사용.
- ADR-016: Oxlint + oxlint-tsgolint + Oxfmt.
- ADR-018: UI 방향은 Lit + Custom Elements이지만, 이 계획에서는 기반 수준의 연결만 만든다.

## 사전 확인

패키지 manifest를 작성하기 전에 npm registry에서 패키지와 버전 가용성을 확인한다. 문서는 미래 지향 스택을 전제로 하므로 구현 시점에 버전을 추측하지 않는다.

실행:

```bash
npm view typescript version
npm view tsdown version
npm view oxlint version
npm view oxlint-tsgolint version
npm view oxfmt version
npm view turbo version
npm view @changesets/cli version
npm view vitest version
npm view happy-dom version
npm view @playwright/test version
npm view lit version
npm view vite version
```

기대 결과:

- 모든 명령이 exit code `0`으로 끝난다.
- `typescript`는 `6.x` 버전을 반환한다.
- `lit`은 `3.x` 버전을 반환한다.
- 패키지가 없거나 요구 major version을 사용할 수 없으면 파일을 쓰기 전에 멈추고 보고한다.
- ESLint, Prettier, Biome, tsup, TypeScript 5.x로 임의 대체하지 않는다.

---

### 작업 1: 루트 워크스페이스 메타데이터 생성

**파일:**
- 생성: `package.json`
- 생성: `pnpm-workspace.yaml`
- 생성: `turbo.json`
- 생성: `.gitignore`
- 생성: `.npmrc`

**단계 1: 루트 manifest 작성**

`package.json`을 생성한다.

```json
{
  "name": "browse-sent-event-monorepo",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "packageManager": "pnpm@9.15.9",
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "lint": "oxlint --type-aware --type-check --deny-warnings",
    "format": "oxfmt --write .",
    "format:check": "oxfmt --check .",
    "changeset": "changeset"
  },
  "devDependencies": {
    "@changesets/cli": "<version-from-preflight>",
    "@playwright/test": "<version-from-preflight>",
    "happy-dom": "<version-from-preflight>",
    "oxfmt": "<version-from-preflight>",
    "oxlint": "<version-from-preflight>",
    "oxlint-tsgolint": "<version-from-preflight>",
    "tsdown": "<version-from-preflight>",
    "turbo": "<version-from-preflight>",
    "typescript": "<version-from-preflight>",
    "vitest": "<version-from-preflight>"
  }
}
```

`<version-from-preflight>`는 사전 확인에서 얻은 호환 버전으로 교체한다. 안정 버전 패키지는 특별한 이유가 없으면 caret range를 사용한다. 예: `^6.0.0`.

`pnpm-workspace.yaml`을 생성한다.

```yaml
packages:
  - packages/*
  - examples/*
```

`turbo.json`을 생성한다.

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": []
    }
  }
}
```

`.gitignore`를 생성한다.

```gitignore
node_modules
dist
coverage
playwright-report
test-results
.turbo
.DS_Store
*.log
```

`.npmrc`를 생성한다.

```ini
engine-strict=true
strict-peer-dependencies=true
auto-install-peers=false
```

**단계 2: manifest 형태 확인**

의존성 설치 이후 Task 8에서 실행한다.

```bash
pnpm -v
pnpm exec turbo --version
```

기대 결과:

- `pnpm -v`가 v9 이상을 출력한다.
- `pnpm exec turbo --version`이 설치된 Turbo 버전을 출력한다.

---

### 작업 2: 공통 TypeScript, 빌드, 테스트, 린트, 포맷 설정 추가

**파일:**
- 생성: `tsconfig.base.json`
- 생성: `vitest.config.ts`
- 생성: `.oxlintrc.json`
- 생성: `.oxfmtrc.json`

**단계 1: 공통 TypeScript 설정 작성**

`tsconfig.base.json`을 생성한다.

```json
{
  "compilerOptions": {
    "target": "ES2025",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "isolatedDeclarations": true,
    "skipLibCheck": true,
    "stableTypeOrdering": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

설치된 TypeScript가 `stableTypeOrdering`을 거부하면 멈추고 보고한다. ADR-014에서 명시한 옵션이므로 조용히 삭제하지 않는다.

**단계 2: Vitest 설정 작성**

`vitest.config.ts`를 생성한다.

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
});
```

**단계 3: Oxlint 설정 작성**

`.oxlintrc.json`을 생성한다.

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["typescript", "unicorn", "import", "promise", "security", "node", "jsdoc"],
  "categories": {
    "correctness": "error",
    "suspicious": "error",
    "perf": "warn",
    "style": "warn",
    "restriction": "warn",
    "pedantic": "warn"
  },
  "options": {
    "typeAware": true,
    "typeCheck": true
  },
  "rules": {
    "typescript/no-floating-promises": "error",
    "typescript/no-misused-promises": "error",
    "typescript/no-unsafe-assignment": "error",
    "typescript/no-unsafe-return": "error",
    "typescript/await-thenable": "error",
    "security/detect-object-injection": "error",
    "security/detect-unsafe-regex": "error",
    "correctness/no-unused-vars": "error",
    "correctness/no-undef": "error",
    "suspicious/no-console": "error",
    "suspicious/no-explicit-any": "error"
  }
}
```

설치된 Oxlint stack이 특정 rule을 지원하지 않으면 정확한 진단을 보고하고 멈춘다. 승인 없이 rule을 낮추거나 삭제하지 않는다.

**단계 4: Oxfmt 설정 작성**

`.oxfmtrc.json`을 생성한다.

```json
{
  "indentStyle": "space",
  "indentWidth": 2,
  "lineWidth": 100,
  "quoteStyle": "single",
  "trailingCommas": "all",
  "semicolons": "always"
}
```

**단계 5: 설정 파싱 검증**

의존성 설치 이후 실행한다.

```bash
pnpm exec tsc --showConfig
pnpm lint
pnpm format:check
```

기대 결과:

- `tsc --showConfig`가 exit code `0`으로 끝난다.
- `pnpm lint`가 exit code `0`으로 끝나거나, 이 Task에서 고쳐야 하는 config/schema 문제만 보고한다.
- `pnpm format:check`가 exit code `0`으로 끝난다.

---

### 작업 3: `packages/core` 골격 생성

**파일:**
- 생성: `packages/core/package.json`
- 생성: `packages/core/tsconfig.json`
- 생성: `packages/core/tsdown.config.ts`
- 생성: `packages/core/src/index.ts`
- 생성: `packages/core/src/runtime/options.ts`
- 생성: `packages/core/src/runtime/create-engine.ts`
- 생성: `packages/core/src/runtime/__tests__/create-engine.test.ts`

**단계 1: package manifest 작성**

`packages/core/package.json`을 생성한다.

```json
{
  "name": "@browse-sent-event/core",
  "version": "0.0.0",
  "type": "module",
  "sideEffects": false,
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsdown",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "lit": "<version-from-preflight>"
  },
  "devDependencies": {
    "typescript": "workspace:*"
  }
}
```

**단계 2: 패키지 TypeScript 설정 작성**

`packages/core/tsconfig.json`을 생성한다.

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

**단계 3: tsdown 설정 작성**

`packages/core/tsdown.config.ts`를 생성한다.

```typescript
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
});
```

**단계 4: 최소 public API 작성**

`packages/core/src/runtime/options.ts`를 생성한다.

```typescript
export interface BrowseSentEventOptions {
  readonly capacity?: number;
  readonly panel?: {
    readonly autoOpen?: boolean;
    readonly position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
    readonly hotkey?: string;
  };
  readonly filter?: {
    readonly excludeUrls?: readonly (string | RegExp)[];
  };
}

export interface ResolvedBrowseSentEventOptions {
  readonly capacity: number;
  readonly panel: {
    readonly autoOpen: boolean;
    readonly position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
    readonly hotkey: string;
  };
  readonly filter: {
    readonly excludeUrls: readonly (string | RegExp)[];
  };
}

export function resolveOptions(
  options: BrowseSentEventOptions = {},
): ResolvedBrowseSentEventOptions {
  return {
    capacity: options.capacity ?? 10_000,
    panel: {
      autoOpen: options.panel?.autoOpen ?? false,
      position: options.panel?.position ?? 'bottom-right',
      hotkey: options.panel?.hotkey ?? 'cmd+shift+r',
    },
    filter: {
      excludeUrls: options.filter?.excludeUrls ?? [],
    },
  };
}
```

`packages/core/src/runtime/create-engine.ts`를 생성한다.

```typescript
import { resolveOptions, type BrowseSentEventOptions } from './options.js';

export interface BrowseSentEventRuntime {
  readonly capacity: number;
  readonly installed: boolean;
}

export function createBrowseSentEventRuntime(
  options?: BrowseSentEventOptions,
): BrowseSentEventRuntime {
  const resolved = resolveOptions(options);

  return {
    capacity: resolved.capacity,
    installed: false,
  };
}
```

`packages/core/src/index.ts`를 생성한다.

```typescript
export {
  createBrowseSentEventRuntime,
  type BrowseSentEventRuntime,
} from './runtime/create-engine.js';
export {
  resolveOptions,
  type BrowseSentEventOptions,
  type ResolvedBrowseSentEventOptions,
} from './runtime/options.js';
```

**단계 5: smoke test 작성**

`packages/core/src/runtime/__tests__/create-engine.test.ts`를 생성한다.

```typescript
import { describe, expect, it } from 'vitest';
import { createBrowseSentEventRuntime } from '../create-engine.js';

describe('createBrowseSentEventRuntime', () => {
  it('uses the default Phase 1 capacity', () => {
    const runtime = createBrowseSentEventRuntime();

    expect(runtime.capacity).toBe(10_000);
    expect(runtime.installed).toBe(false);
  });

  it('accepts a custom capacity', () => {
    const runtime = createBrowseSentEventRuntime({ capacity: 128 });

    expect(runtime.capacity).toBe(128);
  });
});
```

**단계 6: 패키지 검증**

실행:

```bash
pnpm --filter @browse-sent-event/core test
pnpm --filter @browse-sent-event/core typecheck
pnpm --filter @browse-sent-event/core build
```

기대 결과:

- Vitest가 2개 passing test를 보고한다.
- TypeScript가 exit code `0`으로 끝난다.
- `packages/core/dist/index.js`와 `packages/core/dist/index.d.ts`가 존재한다.

---

### 작업 4: `packages/plugin-vite` 골격 생성

**파일:**
- 생성: `packages/plugin-vite/package.json`
- 생성: `packages/plugin-vite/tsconfig.json`
- 생성: `packages/plugin-vite/tsdown.config.ts`
- 생성: `packages/plugin-vite/src/index.ts`
- 생성: `packages/plugin-vite/src/__tests__/plugin.test.ts`

**단계 1: package manifest 작성**

`packages/plugin-vite/package.json`을 생성한다.

```json
{
  "name": "@browse-sent-event/plugin-vite",
  "version": "0.0.0",
  "type": "module",
  "sideEffects": false,
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsdown",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "vite": ">=5.0.0 <9.0.0"
  },
  "devDependencies": {
    "typescript": "workspace:*",
    "vite": "^8.0.13"
  }
}
```

**단계 2: TypeScript 설정 작성**

`packages/plugin-vite/tsconfig.json`을 생성한다.

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

**단계 3: tsdown 설정 작성**

`packages/plugin-vite/tsdown.config.ts`를 생성한다.

```typescript
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ['vite'],
});
```

**단계 4: 최소 Vite plugin 작성**

`packages/plugin-vite/src/index.ts`를 생성한다.

```typescript
import type { Plugin } from 'vite';

export interface BrowseSentEventVitePluginOptions {
  readonly enabled?: boolean;
}

export default function browseSentEvent(
  options: BrowseSentEventVitePluginOptions = {},
): Plugin {
  const enabled = options.enabled ?? process.env.NODE_ENV !== 'production';

  return {
    name: 'browse-sent-event:vite',
    enforce: 'pre',
    apply: 'serve',
    configResolved() {
      if (!enabled) {
        return;
      }
    },
  };
}
```

이 plugin은 의도적으로 no-op이다. import 주입은 프로덕션 제거 테스트와 데모 fixture가 필요하므로 다음 Vite plugin 계획에서 구현한다.

**단계 5: smoke test 작성**

`packages/plugin-vite/src/__tests__/plugin.test.ts`를 생성한다.

```typescript
import { describe, expect, it } from 'vitest';
import browseSentEvent from '../index.js';

describe('browseSentEvent vite plugin', () => {
  it('exposes a named pre-enforced serve plugin', () => {
    const plugin = browseSentEvent();

    expect(plugin.name).toBe('browse-sent-event:vite');
    expect(plugin.enforce).toBe('pre');
    expect(plugin.apply).toBe('serve');
  });
});
```

**단계 6: 패키지 검증**

실행:

```bash
pnpm --filter @browse-sent-event/plugin-vite test
pnpm --filter @browse-sent-event/plugin-vite typecheck
pnpm --filter @browse-sent-event/plugin-vite build
```

기대 결과:

- Vitest가 1개 passing test를 보고한다.
- TypeScript가 exit code `0`으로 끝난다.
- `packages/plugin-vite/dist/index.js`와 `packages/plugin-vite/dist/index.d.ts`가 존재한다.

---

### 작업 5: Changesets 설정 추가

**파일:**
- 생성: `.changeset/config.json`
- 생성: `.changeset/README.md`

**단계 1: Changesets config 작성**

`.changeset/config.json`을 생성한다.

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.1.1/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

`.changeset/README.md`를 생성한다.

```markdown
# Changesets

Use Changesets for package versioning and changelog generation.

Run `pnpm changeset` for any user-visible package change.
기반 설정만 변경하는 경우 release changeset은 작성하지 않는다.
```

**단계 2: Changesets 명령 검증**

실행:

```bash
pnpm changeset --help
```

기대 결과:

- 명령이 exit code `0`으로 끝난다.
- help text가 출력된다.

---

### 작업 6: 프로젝트 문서와 AI 하네스 추가

**파일:**
- 생성: `README.md`
- 생성: `CONTRIBUTING.md`
- 생성: `LICENSE`
- 생성: `.ai/AGENTS.md`
- 생성: `.ai/contexts/architecture.md`
- 생성: `.ai/contexts/phase-1-scope.md`
- 생성: `.ai/contexts/conventions.md`
- 생성: `.ai/contexts/testing.md`
- 생성: `.ai/tasks/add-interceptor.md`
- 생성: `.ai/tasks/write-changeset.md`

**단계 1: README 작성**

`README.md`를 생성한다.

```markdown
# browse-sent-event

WebSocket, HTTP stream, EventSource의 실시간 메시지 흐름을 관찰하기 위한 프론트엔드 개발 도구.

## 상태

이 저장소는 Phase 1 기반 설정 단계에 있다.

## Phase 1 목표

Vite 전용, main thread 전용 개발 도구를 제공하고, 실시간 transport 활동을 브라우저 DevTools 스타일 패널에서 보여준다.

## 문서

- `docs/browse-sent-event-prd.md`
- `docs/browse-sent-event-adr.md`
- `docs/browse-sent-event-v2.md`

## 개발

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
```
```

**단계 2: CONTRIBUTING 작성**

`CONTRIBUTING.md`를 생성한다.

```markdown
# 기여 가이드

## 요구사항

- Node.js 20+
- pnpm 9+

## 작업 흐름

1. `docs/browse-sent-event-prd.md`를 읽는다.
2. `docs/browse-sent-event-adr.md`에서 관련 ADR을 확인한다.
3. 변경 범위는 하나의 논리적 커밋으로 유지한다.
4. 커밋 전에 검증을 실행한다.

## 검증

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
```

## Changesets

사용자에게 보이는 package 변경에는 `pnpm changeset`을 실행한다.
기반 설정만 변경하는 경우 release changeset은 작성하지 않는다.
```

**단계 3: MIT license 추가**

표준 MIT license text로 `LICENSE`를 생성한다. copyright line은 우선 아래처럼 둔다.

```text
Copyright (c) 2026
```

사람 또는 조직 이름을 넣어야 한다면 교체 전에 사용자에게 확인한다.

**단계 4: AI 하네스 파일 작성**

`.ai/AGENTS.md`를 생성한다.

```markdown
# browse-sent-event 에이전트 가이드

## 먼저 읽을 문서

구현 전에 아래 파일을 읽는다.

1. `docs/browse-sent-event-prd.md`
2. `docs/browse-sent-event-adr.md`
3. `.ai/contexts/phase-1-scope.md`
4. `.ai/contexts/conventions.md`
5. `.ai/contexts/testing.md`

## 원칙

- 요구사항이 모호하면 구현 전에 질문한다.
- 추측보다 도구 출력과 파일 내용을 우선한다.
- 구현 전에 접근 방식을 요약한다.
- 필요한 경우 구현, 테스트, 문서, changeset까지 한 사이클로 완료한다.
- 기술 부채를 선택한다면 의식적 선택임을 명시한다.
```

`.ai/contexts/architecture.md`를 생성한다.

```markdown
# 아키텍처 컨텍스트

`browse-sent-event`는 pnpm 모노레포이다.

- `packages/core`는 브라우저 런타임, 엔진, 인터셉터, 스토리지, 검색, export, Lit UI를 포함한다.
- `packages/plugin-vite`는 Phase 1 Vite 통합을 포함한다.
- 이후 package들은 framework adapter, middleware, CLI, server endpoint를 추가한다.

Phase 1은 Vite 전용이며 main thread 전용이다.
```

`.ai/contexts/phase-1-scope.md`를 생성한다.

```markdown
# Phase 1 범위

범위에 포함:

- WebSocket 인터셉트
- fetch ReadableStream 인터셉트
- EventSource 인터셉트
- Shadow DOM 플로팅 패널
- 연결 목록, 메시지 타임라인, 메트릭
- 링 버퍼 스토리지
- 단순 텍스트 검색과 구조적 필터
- JSONL 및 log export
- Vite plugin injection
- 프로덕션 no-op 검증

범위에서 제외:

- React/Vue causality
- Zustand/Pinia middleware
- DOM overlay
- Message lifecycle detection
- postMessage 인터셉트
- Dev server JSON API
- webpack/Rspack/Next/Nuxt
- IndexedDB cold storage
- Schema inference
```

`.ai/contexts/conventions.md`를 생성한다.

```markdown
# 컨벤션

- 코드는 English로 작성한다.
- 커밋 메시지는 Conventional Commits 형식과 Korean description을 사용한다.
- Package는 ESM-only로 배포한다.
- 런타임 의존성은 최소화한다.
- `packages/core`는 `lit` 의존을 허용한다.
- `packages/plugin-vite`는 `vite`를 peer dependency로 선언한다.
- `isolatedDeclarations`가 활성화되어 있으므로 export되는 TypeScript API에는 명시적 타입이 필요하다.
```

`.ai/contexts/testing.md`를 생성한다.

```markdown
# 테스트 컨텍스트

- 단위 테스트와 통합 테스트에는 Vitest를 사용한다.
- 브라우저 유사 단위 테스트에는 happy-dom을 사용한다.
- Vite demo 동작이 관련된 브라우저 E2E 테스트에는 Playwright를 사용한다.
- 먼저 targeted test를 실행하고, 마지막에 전체 workspace 검증을 실행한다.
```

`.ai/tasks/add-interceptor.md`를 생성한다.

```markdown
# 인터셉터 추가 태스크

1. 해당 프로토콜이 현재 phase 범위에 포함되는지 확인한다.
2. `packages/core/src/interceptors/` 아래에 구현을 추가한다.
3. engine boundary를 통해 메시지를 기록한다.
4. 프로토콜 동작에 대한 Vitest coverage를 추가한다.
5. 실제 브라우저 동작이 필요하면 Playwright coverage를 추가한다.
6. README와 guide docs를 업데이트한다.
```

`.ai/tasks/write-changeset.md`를 생성한다.

```markdown
# Changeset 작성 태스크

사용자에게 보이는 package 변경에는 `pnpm changeset`을 실행한다.

fix에는 patch, 새 package 기능에는 minor, public API breaking change에는 major를 사용한다.
```

**단계 5: 문서 파일 존재 확인**

실행:

```bash
test -f README.md
test -f CONTRIBUTING.md
test -f LICENSE
test -f .ai/AGENTS.md
```

기대 결과:

- 모든 명령이 exit code `0`으로 끝난다.

---

### 작업 7: 예제 디렉터리 placeholder 추가

**파일:**
- 생성: `examples/README.md`

**단계 1: placeholder 작성**

`examples/README.md`를 생성한다.

```markdown
# Examples

Examples will be added with the Phase 1 feature implementation.

Planned examples:

- `react-ws-demo`
- `vue-sse-demo`
- `llm-streaming-demo`
```

**단계 2: workspace glob 안전성 확인**

실행:

```bash
pnpm list --depth 0
```

기대 결과:

- 명령이 exit code `0`으로 끝난다.
- `examples/README.md`는 package가 아니므로 example package가 감지되지 않는다.

---

### 작업 8: 의존성 설치와 lockfile 생성

**파일:**
- 생성: `pnpm-lock.yaml`

**단계 1: 의존성 설치**

실행:

```bash
pnpm install
```

기대 결과:

- `pnpm-lock.yaml`이 생성된다.
- `node_modules`가 생성되지만 Git에는 포함되지 않는다.
- peer dependency error가 없다.

패키지명 또는 버전 문제로 install이 실패하면 실패한 패키지명을 보고하고 멈춘다. 승인 없이 툴체인을 교체하지 않는다.

**단계 2: lockfile 추적 대상 확인**

실행:

```bash
git status --short pnpm-lock.yaml
```

기대 결과:

- 출력에 `?? pnpm-lock.yaml`이 포함된다.

---

### 작업 9: 전체 기반 검증

**파일:**
- 새 파일 없음.

**단계 1: workspace check 실행**

실행:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm lint
pnpm format:check
```

기대 결과:

- `pnpm typecheck`가 exit code `0`으로 끝난다.
- `pnpm test`가 exit code `0`으로 끝나고 `packages/core`, `packages/plugin-vite` 테스트가 통과한다.
- `pnpm build`가 exit code `0`으로 끝나고 두 package의 `dist` output이 생성된다.
- `pnpm lint`가 exit code `0`으로 끝난다.
- `pnpm format:check`가 exit code `0`으로 끝난다.

**단계 2: package export 산출물 확인**

실행:

```bash
test -f packages/core/dist/index.js
test -f packages/core/dist/index.d.ts
test -f packages/plugin-vite/dist/index.js
test -f packages/plugin-vite/dist/index.d.ts
```

기대 결과:

- 모든 명령이 exit code `0`으로 끝난다.

**단계 3: 의도한 파일만 변경됐는지 확인**

실행:

```bash
git status --short
```

기대 결과:

- 루트 설정 파일, package 파일, AI 하네스 파일, docs/example placeholder, `pnpm-lock.yaml`이 보인다.
- `node_modules`, `dist`, `coverage`, `.turbo`는 보이지 않는다.

---

### 작업 10: 기반 커밋

**파일:**
- Task 1부터 Task 8까지 생성한 모든 파일을 stage한다.

**단계 1: 의도적으로 stage**

실행:

```bash
git add package.json pnpm-workspace.yaml turbo.json tsconfig.base.json vitest.config.ts .oxlintrc.json .oxfmtrc.json .gitignore .npmrc pnpm-lock.yaml packages examples README.md CONTRIBUTING.md LICENSE .ai .changeset
```

기대 결과:

- 기반 파일만 stage된다.

**단계 2: staged diff 검증**

실행:

```bash
git diff --cached --stat
git diff --cached --check
```

기대 결과:

- `git diff --cached --check`가 exit code `0`으로 끝난다.
- staged stat에 생성된 `dist`, `coverage`, `.turbo`, `node_modules` 파일이 없다.

**단계 3: 커밋**

실행:

```bash
git commit -m "chore(workspace): Phase 1 기반 스캐폴딩 추가"
```

기대 결과:

- 커밋이 성공한다.
- 커밋 후 `git status --short`가 비어 있다.

---

## 후속 계획

이 기반 계획이 반영된 뒤에는 아래 순서로 별도 구현 계획을 작성한다.

1. `docs/plans/YYYY-MM-DD-core-engine-storage.md`
   - Message와 connection schema
   - Ring buffer
   - Metrics aggregator
   - Search와 export

2. `docs/plans/YYYY-MM-DD-protocol-interceptors.md`
   - WebSocket interceptor
   - fetch ReadableStream interceptor
   - EventSource interceptor

3. `docs/plans/YYYY-MM-DD-vite-plugin-injection.md`
   - Entry detection
   - 개발 환경 injection
   - 프로덕션 no-op 검증

4. `docs/plans/YYYY-MM-DD-devtools-panel.md`
   - Lit Custom Elements
   - Floating panel
   - Connection list, message timeline, metrics, search, export controls
