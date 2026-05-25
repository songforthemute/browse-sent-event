# browse-sent-event — Architecture Decision Records

**Initial ADR Set (프로젝트 착수 시점)**

| | |
|---|---|
| **Status** | Draft v1 |
| **Owner** | songforthemute (코코) |
| **Last updated** | 2026-04-20 |
| **Scope** | 프로젝트 셋업 및 Phase 1 착수에 필요한 기술 결정 |

---

## ADR 형식 안내

각 ADR은 다음 구조를 따른다.

- **Status**: Proposed / Accepted / Deprecated / Superseded by ADR-NNN
- **Context**: 결정이 필요한 배경, 제약 조건, 관련 사실
- **Decision**: 선택한 해결책
- **Consequences**: 이 결정으로 얻는 것과 포기하는 것, 앞으로 주의할 점

새 결정이 생기면 ADR-NNN 번호를 증가시켜 추가한다. 기존 ADR은 수정하지 않고, 대신 superseding ADR을 새로 만들어 이력을 보존한다.

---

## ADR-001: Monorepo 구조 및 워크스페이스 도구

**Status:** Accepted

**Context:**

browse-sent-event는 단일 패키지로 배포되지 않는다. PRD 기준으로 최소 다음 패키지들이 존재한다.

- `core` (Phase 1)
- `plugin-vite` (Phase 1)
- `trace-react`, `middleware-zustand` (Phase 2)
- `plugin-webpack`, `plugin-rspack` (Phase 4)
- `cli` (Phase 5)

각 패키지는 독립적으로 버전 관리되어야 하고, 서로 의존성을 공유한다. 개별 레포로 쪼개면 변경 전파 비용이 크고, 단일 패키지로 합치면 사용자가 불필요한 의존성을 받게 된다.

LunaTest에서 이미 유사한 구조를 pnpm workspace로 관리하고 있으며, 그 경험이 자산이다.

**Decision:**

**pnpm workspace + Turborepo**를 채택한다.

- 패키지 매니저: **pnpm** (v9+) — `node_modules` 구조가 엄격하여 phantom dependency를 방지
- 태스크 러너: **Turborepo** — 캐싱 기반 빌드/테스트, 변경된 패키지만 실행
- 버전 관리: **Changesets** — 패키지별 독립 버전, 자동 CHANGELOG

**Rejected alternatives:**

- Nx: 기능은 풍부하나 설정 복잡도가 높음. 본 프로젝트 규모에 과잉
- Lerna: 유지보수 속도가 느려짐. 최신 기능 적용에서 뒤처짐
- Yarn workspaces: pnpm 대비 node_modules 엄격성 부족

**Consequences:**

- (+) LunaTest와 동일한 스택이므로 학습 비용 제로
- (+) Turborepo 캐싱으로 CI 시간 단축
- (+) Changesets로 릴리스 워크플로우 자동화 가능
- (−) pnpm을 처음 쓰는 기여자가 `npm install`을 시도할 경우 혼란 가능 → CONTRIBUTING.md에 명시
- (−) Turborepo 설정 파일(`turbo.json`)을 학습해야 함

---

## ADR-002: 프로젝트 디렉터리 구조

**Status:** Accepted

**Context:**

모노레포의 디렉터리 구조는 여러 층위의 관심사를 명확히 분리해야 한다.

- **배포되는 패키지** (npm publish 대상)
- **내부 도구** (빌드, 테스트, 스크립트)
- **문서** (PRD, ADR, 사용자 가이드)
- **예제/데모** (실제 앱에서 동작 확인용)
- **에이전트 하네스** (AI 개발자용 컨텍스트)

PRD의 패키지 구조와 일치시키되, 그 외 자원(문서, 예제, 설정)의 위치도 명확해야 한다.

**Decision:**

다음 디렉터리 구조를 채택한다.

```
browse-sent-event/
├── packages/              ← npm publish 대상
│   ├── core/
│   ├── plugin-vite/
│   ├── trace-react/       (Phase 2)
│   ├── middleware-zustand/ (Phase 2)
│   └── ...
│
├── examples/              ← 실제 동작 데모
│   ├── react-ws-demo/
│   ├── vue-sse-demo/
│   └── llm-streaming-demo/
│
├── docs/                  ← 사용자 및 기여자 문서
│   ├── guide/
│   │   ├── getting-started.md
│   │   ├── concepts.md
│   │   └── api-reference.md
│   ├── prd/
│   │   └── phase-1.md
│   └── adr/
│       ├── README.md      ← ADR 인덱스
│       ├── 001-monorepo.md
│       ├── 002-directory.md
│       └── ...
│
├── .ai/                   ← AI/Agent 하네스 (ADR-010 참고)
│   ├── AGENTS.md
│   ├── contexts/
│   └── tasks/
│
├── scripts/               ← 빌드/릴리스 스크립트
├── .github/               ← GitHub Actions workflows
├── .changeset/            ← Changesets 설정
│
├── package.json           ← 루트 워크스페이스 설정
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json     ← 공통 TS 설정
├── .oxlintrc.json         ← ADR-016 참고
├── .oxfmtrc.json          ← ADR-016 참고
├── CONTRIBUTING.md
├── LICENSE
└── README.md
```

**Rejected alternatives:**

- `apps/` + `packages/` 분리 (Nx 스타일): examples가 app이 아니므로 혼동 유발
- 모든 것을 루트에 둔 flat 구조: 파일 수가 증가하면 혼란

**Consequences:**

- (+) 패키지/예제/문서의 경계가 명확
- (+) `docs/adr/` 위치가 표준적이어서 외부 도구와 호환
- (+) `.ai/` 디렉터리로 에이전트 자원을 격리 (ADR-010)
- (−) `packages/` 하위에 깊은 경로가 생김 (허용 가능)

---

## ADR-003: 언어 및 타입 시스템

**Status:** Superseded by ADR-014

현재 구현 기준은 ADR-014를 따른다. 이 섹션은 결정 이력 보존용이다.

**Context:**

프론트엔드 개발자가 타깃 사용자이고, 생성된 타입(Phase 5)을 사용자에게 제공하는 도구이다. 타입 안전성은 제품의 일부이다.

**Decision:**

- **TypeScript 5.x**를 메인 언어로 사용한다
- `strict: true` + `noUncheckedIndexedAccess: true`를 모든 패키지에서 필수
- 배포 시 `.d.ts` 파일을 반드시 포함
- `tsconfig.base.json`에서 공통 옵션을 정의, 각 패키지가 extends

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true
  }
}
```

**Consequences:**

- (+) 사용자에게 정확한 타입 힌트 제공
- (+) 리팩토링 안전성 확보
- (+) Phase 5 schema 추론 기능과 타입 시스템이 자연스럽게 연결
- (−) 빌드 파이프라인에 TypeScript 컴파일 단계 필요
- (−) 일부 프레임워크 내부 타입(예: React fiber)은 `any` 또는 수동 타입 선언 필요 → ADR-008에서 다룸

---

## ADR-004: 빌드 도구

**Status:** Superseded by ADR-015

현재 구현 기준은 ADR-015를 따른다. 이 섹션은 결정 이력 보존용이다.

**Context:**

각 패키지는 npm에 배포되므로 다음 형식을 모두 지원해야 한다.

- ESM (`.js` / `.mjs`)
- CJS (`.cjs`) — 레거시 환경 호환
- 타입 선언 (`.d.ts`)
- 소스맵

**Decision:**

**tsup**을 빌드 도구로 사용한다.

- tsup은 esbuild 기반 + TypeScript 선언 생성 + 멀티 포맷 출력을 단일 설정으로 처리
- 각 패키지에 `tsup.config.ts`를 두고 `turbo run build`로 통합 빌드
- `core` 패키지는 Shadow DOM UI 코드를 포함하므로 CSS 인라인 처리 필요 → tsup의 `loader` 옵션 활용

```typescript
// packages/core/tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,   // 디버깅 가능성 유지
  treeshake: true,
});
```

**Rejected alternatives:**

- Rollup + rollup-plugin-dts: 설정 복잡도 증가
- tsc 단독: 멀티 포맷 출력이 번거로움
- unbuild: 기능은 유사하나 tsup이 더 널리 쓰여 문서 자원 풍부

**Consequences:**

- (+) 빌드 설정이 패키지당 15줄 내외
- (+) esbuild 기반이라 빌드 속도 빠름
- (−) Rollup만큼 정교한 플러그인 생태계는 아님 (현재 필요 없음)

---

## ADR-005: Linter 및 Formatter

**Status:** Superseded by ADR-016

현재 구현 기준은 ADR-016을 따른다. 이 섹션은 결정 이력 보존용이다.

**Context:**

ESLint + Prettier 조합은 표준이지만 설정 복잡도가 크고 실행 속도가 느리다. Biome은 ESLint와 Prettier를 단일 도구로 대체하며 Rust 기반으로 속도가 우수하다.

코코의 이전 판단(Xangle 관련 대화)에서 "Biome 포맷팅/일반 린팅 + typescript-eslint 타입 기반 규칙 하이브리드"를 권장한 바 있다. 이 프로젝트에도 동일 원칙을 적용한다.

**Decision:**

- **Biome**: 포맷팅 + 일반 린팅 담당 (빠른 피드백 루프)
- **typescript-eslint**: 타입 기반 규칙만 선별 적용 (Biome이 커버하지 못하는 영역)
- **lefthook**: Git hook 러너 (pre-commit에서 Biome 실행)

```json
// biome.json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "formatter": {
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "rules": {
      "recommended": true,
      "suspicious": {
        "noExplicitAny": "warn"
      }
    }
  }
}
```

typescript-eslint는 `no-floating-promises`, `no-misused-promises` 같은 타입 필요 규칙만 활성화한다.

**Consequences:**

- (+) 포맷팅 실행 속도 10배 이상 빠름
- (+) 단일 설정 파일로 formatter + linter 관리
- (−) Biome 생태계가 ESLint보다 작음 (커스텀 규칙 제한)
- (−) 두 도구를 같이 쓰므로 규칙 충돌 가능성 → 타입 규칙 외에는 Biome 우선

---

## ADR-006: 테스트 프레임워크

**Status:** Accepted

**Context:**

이 프로젝트는 브라우저 API(`window.WebSocket`, `fetch`)를 래핑하는 도구이므로, 테스트에는 다음이 필요하다.

- **단위 테스트**: 순수 로직 (RingBuffer, Search, Metrics)
- **통합 테스트**: Proxy 인터셉트가 실제 브라우저 API와 제대로 상호작용
- **E2E 테스트**: Vite 플러그인이 실제 Vite 프로젝트에서 동작

**Decision:**

- **Vitest**: 단위 + 통합 테스트 (Jest 호환 API, Vite와 통합 우수)
- **Playwright**: E2E 테스트 (실제 브라우저에서 Vite dev server + 플러그인 동작 검증)
- **happy-dom**: 브라우저 API 모킹 (Vitest 환경) — WebSocket, EventSource, fetch를 제공

```typescript
// vitest.config.ts
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

**Rejected alternatives:**

- Jest: Vitest보다 Vite 생태계와 통합이 약함
- jsdom: happy-dom 대비 성능 낮음, WebSocket 지원 미흡
- Cypress: Playwright 대비 multi-browser 지원 약함

**Consequences:**

- (+) Vitest가 프로젝트 스택(Vite)과 자연스럽게 어울림
- (+) Playwright는 Phase 4에서 `playwright-plugin` 구현 시 경험 재활용 가능
- (−) happy-dom이 일부 브라우저 API(예: Streams API 일부)에서 실제와 다른 동작 가능 → Playwright E2E로 보완

---

## ADR-007: 번들 크기 및 Tree-shaking 전략

**Status:** Accepted

**Context:**

browse-sent-event는 **개발 환경에서만 로드**되므로 번들 크기 제약이 프로덕션 앱만큼 엄격하지는 않다. 다만 초기 로드가 느리면 개발 경험을 해친다.

프로덕션 번들에는 한 바이트도 포함되지 않아야 한다는 요구(PRD 섹션 3.1 F6.3)를 위해 tree-shakable 구조가 중요하다.

**Decision:**

- **ESM-only**: 모든 패키지는 ESM export만 제공한다
- **`sideEffects: false`**: package.json에 명시 (실제로 top-level side effect 없도록)
- **인터셉트 주입은 명시적**: Proxy 패치는 plugin-vite가 주입하는 코드 경로에서만 실행, core를 단순 import한다고 자동 실행되지 않음
- **번들 크기 예산**:
  - `core`: < 50 KB (minified + gzipped, Phase 1 기준)
  - `plugin-vite`: < 10 KB (Node 측 실행이므로 크기 영향 적음)

```json
// packages/core/package.json
{
  "name": "@browse-sent-event/core",
  "type": "module",
  "sideEffects": false,
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  }
}
```

**Consequences:**

- (+) 프로덕션 빌드에서 자동 제거 보장 (`NODE_ENV === 'production'`이면 plugin-vite가 주입 안 함)
- (+) 사용자가 필요한 서브 기능만 import 가능
- (−) `sideEffects: false` 선언 후에는 실제로 side effect가 없는지 주의 필요 — 테스트로 검증

---

## ADR-008: 프레임워크 어댑터의 비공식 API 의존 전략

**Status:** Accepted (Phase 2 이후 본격 적용)

**Context:**

Phase 2에서 React causality 추적을 위해 `__REACT_DEVTOOLS_GLOBAL_HOOK__`을 사용한다. 이 훅은 **비공식 API**이며 React 메이저 업데이트 시 깨질 수 있다. Vue의 `getCurrentInstance()`도 유사하게 애플리케이션 코드에서의 사용이 권장되지 않는다.

이런 API에 의존하는 것은 유지보수 부담이지만, 공식 대안이 없으므로 어댑터 전략이 필요하다.

**Decision:**

1. **비공식 API 의존은 어댑터 패키지로 격리**: `trace-react`, `trace-vue` 내부로만 한정. core는 영향받지 않음
2. **Confidence 수준 표시**: 각 어댑터가 반환하는 매핑에 `confidence: 'adapter-backed'` 필드 부착
3. **호환성 매트릭스 유지**: README에 지원 버전 표를 명시적으로 게시

```markdown
| trace-react version | React 17 | React 18 | React 19 |
|---|---|---|---|
| 0.1.x | ✓ | ✓ | ✗ |
| 0.2.x | - | ✓ | ✓ |
```

4. **버전 감시 CI (Phase 4)**: GitHub Actions cron으로 React/Vue 신규 릴리스를 감지, 자동 이슈 생성 + 호환성 matrix 테스트 실행
5. **폴백 경로**: 어댑터가 동작하지 않는 경우 `trace-dom`의 MutationObserver heuristic으로 자동 전환

**Consequences:**

- (+) core의 안정성은 비공식 API 문제의 영향을 받지 않음
- (+) 사용자가 confidence 수준을 보고 신뢰도를 판단 가능
- (+) 프레임워크 새 버전 대응이 자동화됨 (Phase 4)
- (−) 어댑터 유지보수 부담은 그대로 존재 — 명시적으로 수용
- (−) 지원 버전 매트릭스 관리 작업 필요

---

## ADR-009: CI/CD 파이프라인

**Status:** Accepted

**Context:**

pnpm workspace + Changesets + Turborepo 조합을 CI에서 활용해야 한다. npm 배포는 수동 개입 없이 자동화되어야 하지만, 의도치 않은 배포를 막는 gate가 필요하다.

**Decision:**

**GitHub Actions**에 다음 워크플로우를 둔다.

### W1. PR Validation (`.github/workflows/pr.yml`)

모든 PR에서 실행:

```yaml
jobs:
  lint:
    - pnpm install --frozen-lockfile
    - pnpm oxlint --type-aware --type-check --deny-warnings
    - pnpm oxfmt --check
    - pnpm run typecheck

  test:
    - pnpm install --frozen-lockfile
    - pnpm turbo run test
    - upload coverage

  build:
    - pnpm install --frozen-lockfile
    - pnpm turbo run build
    - verify dist/ shape

  e2e:
    - pnpm install --frozen-lockfile
    - pnpm playwright install
    - pnpm turbo run test:e2e
```

Turborepo 캐싱 활용으로 변경 없는 패키지는 재실행 안 함.

### W2. Release (`.github/workflows/release.yml`)

`main` 브랜치에 push 시 실행, Changesets 기반:

```yaml
jobs:
  release:
    steps:
      - checkout with fetch-depth: 0
      - setup pnpm + node
      - install dependencies
      - build all packages
      - changesets action:
          publish: pnpm changeset publish
          createGithubReleases: true
        env:
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**배포 전제:**
- PR에서 `.changeset/*.md` 파일이 생성되어 있어야 함 (없으면 릴리스 안 함)
- Changesets는 자동으로 version bump PR을 생성, 머지되면 실제 publish

### W3. Framework Watch (`.github/workflows/framework-watch.yml`) — Phase 4

매일 cron으로 React/Vue/Svelte 신규 릴리스를 감지, 호환성 테스트 자동 실행.

### 브랜치 전략

- `main`: 항상 배포 가능한 상태
- `feat/*`, `fix/*`, `chore/*`: 작업 브랜치
- PR을 통해서만 `main`으로 병합
- Protected branch rule: PR 승인 1명 + CI 통과 필수

**Consequences:**

- (+) 수동 배포 단계 제거 — Changesets가 version/changelog/publish 자동화
- (+) 의도치 않은 배포 방지 (changeset 파일이 필요)
- (+) Turborepo 캐싱으로 CI 시간 최소화
- (−) Changesets 워크플로우를 기여자에게 설명 필요 → CONTRIBUTING.md에 명시

---

## ADR-010: AI/Agent 하네스 구성

**Status:** Accepted

**Context:**

이 프로젝트는 에이전트 친화적 도구를 지향하며(PRD Phase 3의 JSON API), 개발 과정에서도 Claude Code 같은 에이전트를 활용할 가능성이 높다. 코코의 이전 작업에서 `CLAUDE.md` / `AGENTS.md` 기반 시스템 지침, Claude Code skill ecosystem을 구축한 경험이 있다.

에이전트가 이 프로젝트에 기여하려면 다음이 필요하다.

- 프로젝트 전체 컨텍스트 (아키텍처, 규약, 현재 상태)
- 특정 Phase/기능 작업을 위한 집중된 컨텍스트
- 에이전트가 자주 수행할 태스크의 템플릿

**Decision:**

프로젝트 루트에 `.ai/` 디렉터리를 두고 다음 구조로 운영한다.

```
.ai/
├── AGENTS.md              ← 에이전트가 이 저장소에 진입할 때 가장 먼저 읽는 문서
│
├── contexts/              ← 주제별 집중 컨텍스트
│   ├── architecture.md    (전체 아키텍처)
│   ├── phase-1-scope.md   (현재 Phase 스코프)
│   ├── conventions.md     (코드/커밋/PR 컨벤션)
│   └── testing.md         (테스트 작성 가이드)
│
├── tasks/                 ← 반복적인 작업 템플릿
│   ├── add-interceptor.md (새 프로토콜 인터셉터 추가)
│   ├── add-adapter.md     (새 프레임워크 어댑터 추가)
│   ├── write-changeset.md (Changeset 작성 가이드)
│   └── review-pr.md       (PR 리뷰 체크리스트)
│
└── skills/                ← Claude Code 스킬 (선택)
    └── browse-sent-event/
        └── SKILL.md
```

### AGENTS.md의 핵심 원칙

Claude Code skill ecosystem에서 정립한 원칙을 적용한다.

1. **Clarify Before Code**: 스펙이 모호하면 구현 전에 질문
2. **Tool Over Assumption**: 파일을 읽거나 테스트를 돌려 확인 가능한 것을 가정으로 대체하지 않음
3. **Design Thinking First**: 구현 전에 ADR 또는 설계 토론
4. **Full Cycle**: 구현 + 테스트 + 문서 + changeset까지 완료
5. **Conscious Debt**: 단축한 부분은 명시적으로 기록

### tasks/ 템플릿 예시

```markdown
# add-interceptor.md

새 프로토콜 인터셉터를 추가할 때 따르는 절차.

## 1. 사전 조건
- [ ] ADR에 해당 프로토콜 지원이 결정되어 있는가?
- [ ] PRD의 현재 Phase 스코프에 포함되는가?

## 2. 구현
- `packages/core/src/interceptors/<protocol>.ts` 생성
- `DevtoolsEngine` 인터페이스를 통해 메시지 기록
- main thread / worker 지원 범위 명시

## 3. 테스트
- Vitest 단위 테스트 (`<protocol>.test.ts`)
- Playwright E2E (`examples/<protocol>-demo/`)

## 4. 문서
- `docs/guide/` 업데이트
- README 지원 프로토콜 섹션 갱신

## 5. 릴리스
- `.changeset/<name>.md` 작성 (minor bump)
```

**Consequences:**

- (+) 에이전트가 반복적인 실수를 하지 않도록 가이드 제공
- (+) 신규 인간 기여자에게도 동일한 문서가 유용
- (+) 프로젝트 상태가 변하면 `.ai/` 업데이트로 에이전트 동작 개선
- (−) `.ai/` 자체의 유지보수 부담 — 단, 코코의 기존 자산 재활용 가능
- (−) 에이전트가 의도와 다르게 해석할 가능성 상존 → tasks에 체크리스트 형태로 최대한 명시

---

## ADR-011: 라이선스 및 공개 정책

**Status:** Accepted

**Context:**

프론트엔드 오픈소스 생태계에 기여하는 것이 프로젝트의 명시적 목적이다(비전 문서 Mission 섹션). 라이선스는 채택률에 직접 영향을 주며, LunaTest와의 일관성도 고려 대상이다.

**Decision:**

- **라이선스: MIT**
  - 프론트엔드 생태계의 표준 (React, Vue, Vite, TanStack Query 등 대부분 MIT)
  - 상업적 사용 허용 — 기업 팀의 내부 도입 장벽 제거
  - Apache 2.0은 특허 조항이 있지만, 본 프로젝트의 특성상 불필요한 복잡도

- **공개 저장소**: 초기부터 public GitHub
- **Contributor License Agreement**: 현 단계에서는 도입하지 않음 — 채택 장벽이 됨
- **Code of Conduct**: Contributor Covenant 2.1 채택

**Consequences:**

- (+) 최대한 넓은 채택 가능
- (+) 기업 법무팀의 승인 없이도 도입 가능
- (−) 누군가 상업 제품으로 포장해서 팔아도 막을 수 없음 — 프로젝트의 공익적 성격을 고려하면 수용 가능

---

## ADR-012: 의존성 정책

**Status:** Accepted

**Context:**

개발 도구는 사용자 앱의 개발 환경에 설치된다. 의존성 하나가 늘어날 때마다 사용자의 `node_modules` 크기, 설치 시간, 보안 표면이 증가한다.

**Decision:**

### 런타임 의존성 (dependencies)

최소화 원칙. Phase 1에서 허용하는 런타임 의존성:

- **core**: 단일 의존성 — **`lit`** (ADR-018, UI 프레임워크)
  - 기존 "제로 의존성" 목표에서 한 단계 완화. Lit은 UI 빌드와 Custom Element 재사용을 위한 명시적 예외
  - 그 외 모든 유틸/상태 관리/검색은 자체 구현 유지
- **plugin-vite**: `vite` (peer dependency)
- 추가가 필요한 경우 각 의존성마다 이유를 ADR에 기록

### 개발 의존성 (devDependencies)

허용 목록:

| 도구 | 용도 | 종류 |
|---|---|---|
| `lit` | UI 프레임워크 (ADR-018) | runtime |
| `typescript` | 타입 시스템 (ADR-014: 6.x) | dev |
| `vite` | Vite 플러그인 개발/테스트 기준 (ADR-013: 8.x) | dev |
| `tsdown` | 빌드 (ADR-015) | dev |
| `vitest`, `happy-dom` | 단위/통합 테스트 | dev |
| `@playwright/test` | E2E 테스트 | dev |
| `oxlint` | 린터 (ADR-016) | dev |
| `oxlint-tsgolint` | 타입 인식 린팅 (ADR-016) | dev |
| `oxfmt` | 포매터 (ADR-016) | dev |
| `turbo` | 모노레포 태스크 러너 | dev |
| `@changesets/cli` | 릴리스 관리 | dev |
| `lefthook` | Git hook | dev |
| `@types/*` | 타입 선언 (필요 시) | dev |

그 외 devDependency는 추가 전에 필요성을 ADR 또는 PR description에 명시.

### 유틸리티 라이브러리 정책 (lodash, es-toolkit 등)

**core 패키지에는 범용 유틸리티 라이브러리를 추가하지 않는다.**

근거:

- 이 프로젝트에 필요한 유틸 연산 대부분이 **2026년 표준 JavaScript로 해결 가능**하다:
  - 깊은 복사: `structuredClone` (브라우저 네이티브)
  - 그룹화: `Object.groupBy` (ES2024)
  - debounce/throttle: 10~20줄 자체 구현
  - 부분 문자열 검색 (Phase 1): `String.includes`
  - trigram 인덱싱 (Phase 2): 도메인 특화이므로 자체 구현
- 링 버퍼는 **배열 인덱싱 + 모듈로 연산만 필요**하며, 외부 유틸 의존 없음
- `sideEffects: false` 선언과 tree-shaking을 엄격히 유지하려면 유틸 라이브러리의 import 경계를 관리해야 함 — 부담 대비 이득 없음

필요한 유틸은 `packages/core/src/internal/utils/` 에 자체 구현한다. 모니터링 라이브러리가 범용 유틸에 의존하는 것은 **관찰 도구의 단순성 원칙**과 충돌한다.

**예외:** `examples/*` 앱은 데모이므로 현실적인 의존성을 써도 된다. `docs/` 는 Astro 생태계 의존성을 자유롭게 사용 (ADR-017).

### Peer Dependency 정책

프레임워크 어댑터는 해당 프레임워크를 peer dependency로 선언:

```json
{
  "peerDependencies": {
    "react": ">=17.0.0"
  },
  "peerDependenciesMeta": {
    "react": { "optional": false }
  }
}
```

버전 범위는 호환성 매트릭스(ADR-008)와 일치.

**Consequences:**

- (+) 사용자 설치 비용 최소
- (+) 보안 취약점 노출 표면 축소
- (+) 빌드 시간 예측 가능
- (−) 자체 구현 부담 — 링 버퍼, 간단한 검색 등은 직접 구현. 허용 가능한 복잡도 범위 내

---

## 결정 이력 요약

| ID | 주제 | 선택 | Status | Phase |
|---|---|---|---|---|
| 001 | Monorepo | pnpm workspace + Turborepo + Changesets | Accepted | 초기 |
| 002 | Directory | `packages/` + `examples/` + `docs/` + `.ai/` | Accepted | 초기 |
| 003 | 언어 | TypeScript 5.x, strict mode | **Superseded by 014** | 초기 |
| 004 | 빌드 | tsup (esbuild 기반) | **Superseded by 015** | 초기 |
| 005 | Lint | Biome + typescript-eslint (하이브리드) | **Superseded by 016** | 초기 |
| 006 | Test | Vitest + Playwright + happy-dom | Accepted | 초기 |
| 007 | 번들 | ESM-only, `sideEffects: false` | Accepted | 초기 |
| 008 | 어댑터 | 비공식 API 격리, confidence 표시 | Accepted | Phase 2+ |
| 009 | CI/CD | GitHub Actions + Changesets 자동 배포 | Accepted | 초기 |
| 010 | AI 하네스 | `.ai/` 디렉터리, AGENTS.md + contexts/ + tasks/ | Accepted | 초기 |
| 011 | 라이선스 | MIT, public GitHub, Contributor Covenant | Accepted | 초기 |
| 012 | 의존성 | 런타임 제로 목표, peer deps 활용 | Accepted | 초기 |
| **013** | **메타: VoidZero 생태계 채택** | **Oxc 파서 공유 통합 툴체인** | **Accepted** | **초기** |
| **014** | **언어 (TS 6)** | **TypeScript 6.x, `isolatedDeclarations`** | **Accepted (supersedes 003)** | **초기** |
| **015** | **빌드 (tsdown)** | **tsdown (Rolldown 기반, VoidZero)** | **Accepted (supersedes 004)** | **초기** |
| **016** | **Lint/Format (Oxlint 스택)** | **Oxlint + oxlint-tsgolint + Oxfmt** | **Accepted (supersedes 005)** | **초기** |
| **017** | **문서 사이트 (Astro)** | **Astro + Starlight** | **Accepted** | **Phase 1 후반** |
| **018** | **DevTools UI 프레임워크** | **Lit + Shadow DOM closed + Custom Elements** | **Accepted** | **초기** |

---

## ADR-013: 메타 결정 — VoidZero 생태계 채택

**Status:** Accepted

**Context:**

ADR-003, 004, 005를 초안으로 작성한 후 스택 재검토 과정에서, 개별 도구 선택이 아니라 **툴체인 전체의 일관성**이 더 큰 결정임이 드러났다.

2026년 현재 JavaScript 툴체인 생태계의 상황:

- **VoidZero**는 Evan You가 설립한 회사로, Vite, Vitest, Rolldown, Oxc를 통합 개발한다. Rspack 前 핵심 기여자를 포함한 전문가 팀이 합류하여 단일 진영으로 통합되고 있다.
- **Oxc**는 Rust 기반 컴파일러 인프라(파서, 리졸버, 트랜스포머, 린터, 포매터)로, 모든 VoidZero 도구의 기반이다.
- **Vite 8**은 Rolldown을 번들러로 내장, 개발/프로덕션이 단일 번들러로 통합됐다.
- **Vite+**(`vp` 바이너리)는 Vite, Vitest, Oxlint, Oxfmt, Rolldown, tsdown을 단일 바이너리로 제공하는 공식 통합 CLI.

이 상황에서 툴체인을 구성하는 두 가지 전략이 있다.

1. **각 영역에서 "최선"을 선택** — 빌드는 tsup, 린트는 Biome, 테스트는 Vitest처럼 개별 최적화
2. **단일 생태계에 정렬** — VoidZero 또는 Rspack 중 한 진영의 통합 스택 사용

browse-sent-event의 특수성이 이 결정에 영향을 준다.

- **Vite 플러그인을 핵심 제품으로 만든다** — 생태계가 Vite/VoidZero로 이미 기울어져 있다
- **에이전트 주도 개발을 지향한다** — 도구 간 일관된 진단 포맷과 빠른 피드백 루프가 필수
- **도구 자체가 관찰 가능성을 다룬다** — 도구 선택에 메타 일관성이 필요하다

**Decision:**

**VoidZero 생태계에 정렬한다.** 개별 도구 선택(ADR-014, 015, 016)은 이 메타 결정의 구체적 구현이다.

채택 도구:

| 영역 | 도구 | ADR |
|---|---|---|
| 파서/컴파일러 인프라 | Oxc | 암묵적 (다른 도구의 기반) |
| 번들러 (dev/build) | Vite 8 (Rolldown) | 초기부터 |
| 라이브러리 빌드 | tsdown (Rolldown 기반) | ADR-015 |
| 린터 | Oxlint + oxlint-tsgolint | ADR-016 |
| 포매터 | Oxfmt | ADR-016 |
| 테스트 | Vitest | ADR-006 |

**2026-05-18 구현 점검, 2026-05-25 최신화:**

Vite 8 전환 후 번들러 영향 의존성은 다음과 같이 정렬한다.

- `vite 8.0.14`는 `rolldown 1.0.2`, `lightningcss 1.32.0`을 사용한다.
- `vitest 4.1.7`은 peer 경로에서 `vite 8.0.14`를 사용한다.
- `tsdown 0.22.0`은 `rolldown 1.0.1`을 사용한다.
- 현재 설치 그래프에는 `rollup`과 `esbuild`가 남아 있지 않다.

이에 따라 `plugin-vite`는 Vite 공개 Plugin API를 기준으로 작성하고, Vite 8에서 deprecated 경로가 된 `transformWithEsbuild`, `optimizeDeps.esbuildOptions`, `build.minify: 'esbuild'`, `build.cssMinify: 'esbuild'`에 의존하지 않는다. Rollup 전용 출력 조정이 필요하면 `build.rollupOptions`보다 `build.rolldownOptions`를 먼저 검토한다.

근거 문서: [Vite 8 announcement](https://vite.dev/blog/announcing-vite8), [Vite 8 migration guide](https://vite.dev/guide/migration).

**정렬하지 않는 영역:**

- **Turborepo**는 유지 (VoidZero는 태스크 러너가 아직 정식 제품 아님)
- **Changesets**는 유지 (VoidZero에 대응 도구 없음)
- **Playwright**는 유지 (브라우저 자동화는 VoidZero 스코프 밖)
- **TypeScript 6.x**는 유지 (Microsoft 공식이며, `tsgolint`가 이를 활용)

**구조적 이득:**

1. **단일 파서 (Oxc)**: 빌드/린트/포맷이 같은 AST를 공유. 이중 파싱 제거
2. **일관된 진단 포맷**: Oxlint의 machine-actionable 진단이 도구 전반에 통용
3. **피드백 루프 속도**: 린트 < 1초, 빌드 수 초 단위로 개발/CI 경험 변화
4. **메타 일관성**: 관찰 가능성 도구가 관찰 가능한 스택 위에서 개발됨
5. **미래 통합**: Vite+ `vp` 바이너리 하나로 툴체인 통합 가능

**Rejected alternatives:**

- **Rspack + Rslib (ByteDance 진영)**: Vite 플러그인이 핵심 제품이므로 철학적 불일치. Module Federation이 핵심 가치 아님
- **각 영역 개별 최선 (tsup + Biome + Vitest 조합)**: Oxc 파서 공유 이득 상실, 진단 포맷 불일치
- **ESLint + Prettier 유지**: 에이전트 친화성 부족, 피드백 루프 느림

**Consequences:**

- (+) 도구 간 원활한 통합 (같은 파서, 같은 진단 구조)
- (+) 성능: 피드백 루프 초 단위, AI 이터레이션 가속
- (+) 미래 대비: VoidZero의 통합 방향(Vite+)에 자연스럽게 올라탐
- (+) 메타 일관성: 관찰 가능성 도구가 VoidZero의 "관찰 가능한 툴체인" 철학과 공명
- (−) **단일 회사 의존 리스크**: VoidZero 전체 생태계에 베팅. 회사 상황 악화 시 영향 범위가 큼
- (−) **상대적 미성숙도**: Oxlint, tsdown 모두 1~2년 된 도구. 엣지 케이스에서 이슈 가능성
- (−) 플러그인 생태계가 ESLint 대비 작음 (단, JS 플러그인 alpha로 ESLint 플러그인 호환)

**롤백 기준:**

다음 중 하나가 발생하면 이 메타 결정을 재검토한다.

1. VoidZero 재정/인력 위기 (주요 기여자 이탈, 투자 중단)
2. Oxc 파서가 프로덕션에서 파싱 오류 재발생 (월 1회 이상)
3. Oxlint type-aware 룰이 6개월간 정체 (tsgolint 정식 릴리스 실패)
4. Vite 8/Rolldown 기준에서 실제 주입 플러그인 호환성 문제가 지속

롤백 시 마이그레이션 경로:

- tsdown → tsup (설정 호환성 높음, tsdown이 tsup의 주요 설정 옵션과 호환을 유지하도록 설계됨)
- Oxlint → ESLint (JS 플러그인 alpha를 통한 역방향 호환)
- Oxfmt → Prettier (Oxfmt가 Prettier의 JavaScript/TypeScript 호환성 테스트 100% 통과, 교체 비용 낮음)

---

## ADR-014: 언어 및 타입 시스템 (TypeScript 6)

**Status:** Accepted (supersedes ADR-003)

**Context:**

ADR-003에서 TypeScript 5.x를 선택했다. 하지만 2026년 3월 23일 TypeScript 6.0이 정식 릴리스되었고, 2026년 4월 현 시점에서 새 프로젝트가 5.x로 시작할 이유가 없다.

TypeScript 6.0의 특성:

- JavaScript 코드베이스 기반의 마지막 릴리즈이자, Go 기반 TypeScript 7.0으로 가는 브릿지 릴리즈
- strict가 기본 true, target 기본 ES2025, module 기본 esnext
- TypeScript 5.9와 API 호환성 유지
- 7.0은 "몇 달 내" 릴리즈 예정

`isolatedDeclarations`는 TypeScript 5.5에서 도입된 기능으로, 빌드 도구가 타입 선언을 빠르게 생성할 수 있게 한다. tsdown은 isolatedDeclarations를 네이티브로 지원하여 tsc를 통한 타입 생성보다 빠르다. ADR-015의 tsdown 선택과 맞물린다.

또한 `oxlint-tsgolint`가 TypeScript의 Go 포팅(tsgo)을 활용하므로, TypeScript 7.0 준비가 된 상태여야 한다.

**Decision:**

**TypeScript 6.x를 사용한다.** 주요 설정:

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2025",
    "module": "ESNext",
    "moduleResolution": "Bundler",

    // 6.0 기본값이지만 명시적으로 유지
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,

    // tsdown의 빠른 .d.ts 생성 활용
    "isolatedDeclarations": true,

    "skipLibCheck": true,

    // 6.0 → 7.0 마이그레이션 대비
    "stableTypeOrdering": true
  }
}
```

**`isolatedDeclarations` 요구사항:**

모든 export는 명시적 타입 annotation이 필요하다. 컴파일러가 파일 간 타입 추론 없이 `.d.ts`를 생성할 수 있도록.

```typescript
// ❌ 금지 (isolatedDeclarations 위반)
export function parse(input: string) {
  return JSON.parse(input);
}

// ✅ 허용 (명시적 반환 타입)
export function parse(input: string): unknown {
  return JSON.parse(input);
}
```

이 제약은 불편해 보이지만, 라이브러리 배포에서는 오히려 이득이다. API 경계가 명확해지고, tsc 없이도 빠른 `.d.ts` 생성이 가능하다.

**Consequences:**

- (+) 현재 최신 안정 버전 사용, 커뮤니티 지원 최신
- (+) 6.0 → 7.0 마이그레이션 사전 대비 (`stableTypeOrdering`)
- (+) `isolatedDeclarations`로 tsdown 타입 생성 가속
- (+) Strict mode 기본값으로 설정 간소화
- (−) `isolatedDeclarations` 때문에 export 타입 명시 규율 필요
- (−) ES2025 target은 구형 Node.js 버전 미지원 (Node 20+ 요구)

---

## ADR-015: 빌드 도구 (tsdown)

**Status:** Accepted (supersedes ADR-004)

**Context:**

ADR-004에서 tsup을 선택했으나, 2026년 현재 tsup은 다음 이유로 부적합하다.

- tsup은 적극적으로 유지보수되지 않고, tsdown이 성능 면에서 크게 앞서며, 새 프로젝트에 tsup를 쓸 이유가 없다
- tsup 저자가 프로젝트를 사실상 방치한 상태

대체 후보:

1. **tsdown** (VoidZero): Rolldown + Oxc 기반, ESM-only 배포 친화, isolatedDeclarations 네이티브 지원, tsup 설정 호환
2. **Rslib** (ByteDance): Rspack 기반, Module Federation 네이티브
3. **Rollup 직접 사용**: 유연하지만 설정 복잡도 증가

ADR-013의 메타 결정(VoidZero 생태계 정렬)에 따라 tsdown을 선택한다.

**Decision:**

**tsdown**을 라이브러리 빌드 도구로 사용한다.

```typescript
// packages/core/tsdown.config.ts
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],          // ESM only (ADR-007)
  dts: true,                // isolatedDeclarations 활용
  sourcemap: true,
  clean: true,
  treeshake: true,
  // Oxc 기반 트랜스파일로 tsc 없이 빠른 빌드
});
```

**주요 이점:**

1. **Oxc 파서 공유**: Vite가 파싱한 AST를 tsdown도 공유 가능한 기반
2. **isolatedDeclarations 네이티브**: tsc 없이 `.d.ts` 생성, 빌드 시간 대폭 단축
3. **ESM-only**: 2026년 기준 CJS 없이 ESM 배포만 제공해도 현실적 (ADR-007)
4. **tsup 호환**: 기존 tsup 설정을 쉽게 마이그레이션 (롤백 안전망)

**Rejected alternatives:**

- **Rslib**: ADR-013 메타 결정에 따라 Rspack 생태계 미채택. Module Federation 불필요
- **Rollup 직접**: tsdown이 Rollup/Rolldown 위의 라이브러리 특화 레이어이므로 Rollup을 직접 쓸 이유 없음
- **tsup 유지**: 유지보수 중단 리스크

**Consequences:**

- (+) VoidZero 생태계 완전 정렬
- (+) Oxc 기반 빠른 빌드 (tsc 의존 없음)
- (+) isolatedDeclarations 네이티브 지원
- (+) ESM-only로 2026년 배포 표준에 맞춤
- (−) tsdown은 2024년 출시된 비교적 새 도구 — 엣지 케이스 가능성
- (−) CJS 배포 시 별도 설정 필요 (현재 불필요)

---

## ADR-016: Lint/Format (Oxlint + oxlint-tsgolint + Oxfmt)

**Status:** Accepted (supersedes ADR-005)

**Context:**

ADR-005에서 Biome + typescript-eslint 하이브리드를 선택했다. 하지만 다음 사실이 드러났다.

- Biome 플러그인은 npm 배포가 공식적으로 권장되지 않음. 조직/프로젝트 내부용으로 설계. SonarJS 같은 생태계 활용 불가
- ESLint 플러그인 생태계가 필요한데, Biome만으로는 부족
- 하이브리드 운영의 유지보수 부담

그리고 더 중요한 발견:

- Oxlint JS plugins 알파로 대부분의 기존 ESLint 플러그인을 수정 없이 실행 가능. 많은 팀이 Oxlint를 ESLint의 드롭인 대체품으로 쓸 수 있다
- oxlint-tsgolint는 typescript-go 위에서 직접 실행되어 ESLint + typescript-eslint보다 큰 성능 향상. 50개 이상의 TypeScript type-aware 룰 지원
- Oxlint 진단은 인간 가독성과 기계 실행 가능성 둘 다를 고려해 설계. AI가 이슈를 이해하고 수정을 안정적으로 적용하는 데 도움

에이전트 주도 개발 맥락에서 깨진 유리창 이론 관점의 요구사항:

1. **일관성**: 모든 코드가 동일한 엄격한 규칙을 따름
2. **즉각성**: 위반이 빨리 탐지 (초 단위 피드백)
3. **명확성**: AI가 위반을 이해하고 수정 가능 (machine-actionable)

Oxlint는 세 요구를 모두 만족한다. ESLint는 1번만, Biome은 1, 2번만 만족한다.

**Decision:**

**Oxlint + oxlint-tsgolint + Oxfmt** 조합을 채택한다.

```json
// .oxlintrc.json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",

  "plugins": [
    "typescript",
    "unicorn",
    "import",
    "promise",
    "security",
    "node",
    "jsdoc"
  ],

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
    // Type-aware (via tsgolint)
    "typescript/no-floating-promises": "error",
    "typescript/no-misused-promises": "error",
    "typescript/no-unsafe-assignment": "error",
    "typescript/no-unsafe-return": "error",
    "typescript/await-thenable": "error",

    // Security
    "security/detect-object-injection": "error",
    "security/detect-unsafe-regex": "error",

    // Correctness (엄격)
    "correctness/no-unused-vars": "error",
    "correctness/no-undef": "error",

    // AI/에이전트 친화적
    "suspicious/no-console": "error",
    "suspicious/no-explicit-any": "error"
  }
}
```

**Oxfmt 설정:**

```json
// .oxfmtrc.json
{
  "indentStyle": "space",
  "indentWidth": 2,
  "lineWidth": 100,
  "quoteStyle": "single",
  "trailingCommas": "all",
  "semicolons": "always"
}
```

**엄격도 원칙 (깨진 유리창 방지):**

1. **Error로 시작**: 새 룰은 기본적으로 `error` 레벨. `warn`은 점진 도입 중인 것만
2. **Auto-fix 최대 활용**: 에이전트가 수정 가능한 것은 자동으로 처리
3. **Category 기반 관리**: `correctness`, `suspicious`, `security`는 전체 `error`
4. **프리셋 참고**: @nkzw/oxlint-config는 Oxlint를 위한 포괄적이고 엄격한 기본 + JS 플러그인 모음으로, LLM이 더 나은 코드를 작성하도록 유도하는 원칙을 따름. 이 설계를 참고

**실행 통합 (ADR-009 CI/CD 업데이트):**

```bash
# Pre-commit (lefthook)
oxlint --type-aware --fix
oxfmt --write

# CI
oxlint --type-aware --type-check --deny-warnings
oxfmt --check
```

**Rejected alternatives:**

- **ESLint + Prettier**: 속도 느림, 에이전트 친화성 부족 (진단 구조 불일치)
- **Biome**: 플러그인 배포 제약, Oxc 파서 공유 이득 부재
- **Oxlint 단독 (tsgolint 없이)**: type-aware 룰 누락으로 엄격도 저하

**Consequences:**

- (+) **속도**: Oxlint가 ESLint 대비 50-100배 빠름, Biome 대비 2배 빠름. 피드백 루프 초 단위
- (+) **에이전트 친화적 진단**: machine-actionable 구조로 AI 수정 안정성
- (+) **타입 인식 린팅**: tsgolint로 no-floating-promises 등 중요 룰 커버
- (+) **ESLint 플러그인 호환**: JS plugins alpha로 필요 시 기존 플러그인 활용
- (+) **포매터 통합**: Oxfmt의 Prettier 100% 호환으로 교체 비용 낮음
- (+) **VoidZero 생태계 정렬**: Oxc 파서 공유
- (−) **Oxlint 플러그인 생태계 상대적 미성숙**: 엣지 케이스에서 ESLint 플러그인이 필요할 수 있음
- (−) **tsgolint alpha 단계**: 일부 룰 누락 가능. 핵심 룰(50+)은 커버됨
- (−) **커뮤니티 경험 상대적 부족**: ESLint 대비 stackoverflow/블로그 자료 적음

**모니터링 지표:**

이 결정의 지속 가능성을 판단하기 위해 다음을 관찰한다.

- Oxlint 주요 버전 릴리스 주기 (분기 1회 이하면 우려)
- tsgolint 커버 룰 수 (50개 미만 유지되면 ESLint 보조 고려)
- 실제 프로젝트에서 발견된 엣지 케이스 수 (월 2회 이상이면 재검토)

---

## ADR-017: 문서 사이트 도구 (Astro + Starlight)

**Status:** Accepted

**Context:**

오픈소스 도구의 채택률은 문서 품질과 직결된다. 이 프로젝트의 문서 요구사항은 특수하다.

- **시각적 도구이므로 시연이 중요하다**: "메시지가 어디까지 갔고 어디서 죽었는지 보여준다"는 가치 제안은 글로 설명하기 어렵다. 문서에 실제 동작하는 데모 또는 상호작용 가능한 예시가 들어가야 한다
- **기술 문서와 개념 설명이 공존한다**: API 레퍼런스, 가이드, Message Causality 같은 개념 설명, Phase 로드맵 등 층위가 다른 콘텐츠
- **ADR/PRD도 공개한다**: 결정의 투명성을 위해 내부 문서까지 공개하는 오픈소스 방식

후보 비교:

| 도구 | 장점 | 약점 |
|---|---|---|
| **VitePress** | Vite 기반, Vue 생태계 통합 | Vue 강제, 커스터마이징 상대적 제한 |
| **Astro + Starlight** | Vite 기반(Oxc 전환 중), MDX 네이티브, 프레임워크 자유, Islands Architecture | 자체 프레임워크 학습 |
| **Docusaurus** | 성숙한 생태계 | React 강제, Webpack 기반 (우리 스택과 이질) |
| **Nextra** | 간편 | Next.js 강제 |

**Decision:**

**Astro + Starlight**를 문서 사이트로 채택한다.

**선택 근거:**

1. **VoidZero 생태계와의 궤도 일치**: Astro는 Vite 기반이고, Astro 팀이 Oxc 기반 자체 Rust 컴파일러를 개발 중이다. ADR-013의 메타 결정과 같은 방향
2. **Islands Architecture**: 정적 페이지 대부분 + 인터랙티브 데모 부분만 아일랜드로. 이 프로젝트 문서에 특히 적합:
   - Phase 1 타임라인 데모 (실시간 메시지 시각화)
   - Causality 추적 인터랙티브 (Phase 2)
   - Schema inference 라이브 입력 (Phase 5)
3. **Starlight 기본 품질**: 검색, 다국어, 사이드바 자동 생성, 다크 모드 즉시 사용 가능
4. **MDX 네이티브**: 문서에 React/Vue/Solid 컴포넌트를 자유롭게 섞기 가능
5. **프레임워크 유연성**: 인터랙티브 컴포넌트 구현 시 특정 프레임워크에 강제되지 않음

**디렉터리 구조 (ADR-002와 정합):**

```
docs/                           ← ADR-002의 docs 디렉터리
├── astro.config.mjs
├── src/
│   ├── content/
│   │   ├── docs/               ← Starlight 콘텐츠
│   │   │   ├── guide/
│   │   │   ├── concepts/
│   │   │   ├── api/
│   │   │   └── adr/            ← 공개된 ADR 일부
│   │   └── config.ts
│   └── components/             ← 인터랙티브 데모 아일랜드
│       ├── TimelineDemo.tsx
│       └── CausalityExplorer.tsx
└── public/
```

**배포:**

- GitHub Actions로 빌드 후 GitHub Pages 또는 Vercel/Netlify 배포
- `main` 브랜치 머지 시 자동 배포

**Rejected alternatives:**

- **VitePress**: 메타 일관성은 Astro와 비슷하나, Vue 강제와 인터랙티브 유연성 제약
- **Docusaurus**: Webpack 기반이라 ADR-013의 Oxc 생태계 원칙과 이질
- **자체 Vite 앱**: 초기 개발 속도 손해. Starlight의 기본 기능(검색, 사이드바 등) 재구현 비용

**Consequences:**

- (+) 인터랙티브 데모를 문서에 자연스럽게 통합
- (+) VoidZero 궤도(Oxc 기반 컴파일러)와 일치
- (+) Starlight의 검색, 다국어, 테마 즉시 활용
- (+) MDX로 ADR/PRD 같은 문서도 풍부하게 표현
- (−) Astro 학습 곡선 (Vue/React만 쓰던 기여자 대상)
- (−) 문서 빌드 파이프라인이 코어 빌드와 별도 — Turborepo 캐싱으로 완화

---

## ADR-018: DevTools UI 프레임워크 (Lit + Shadow DOM + Custom Elements)

**Status:** Accepted

**Context:**

DevTools 패널 UI를 어떻게 구현할지는 두 가지 독립 질문으로 분해된다.

1. **격리 메커니즘**: 앱 스타일/스크립트와 충돌 없이 어떻게 분리하는가
2. **컴포넌트 프레임워크**: 격리된 공간 내부에서 무엇으로 UI를 만드는가

### 격리 메커니즘 검토

후보: iframe, Shadow DOM, 일반 DOM (Portal).

- **iframe**: 완전 격리이지만 별도 렌더링 컨텍스트로 인한 오버헤드, postMessage 통신 부담, inspect 번거로움
- **일반 DOM**: 앱의 전역 CSS 리셋/Tailwind preflight/CSS-in-JS에 의해 깨질 가능성 높음
- **Shadow DOM**: CSS 완전 격리, 같은 렌더링 트리라 성능 우수, DevTools에서 inspect 가능

→ **Shadow DOM이 최적 균형점.** iframe은 Phase 5 외부 Dashboard에서만 사용.

### 컴포넌트 프레임워크 검토

후보를 광범위하게 평가:

| 카테고리 | 후보 | 평가 |
|---|---|---|
| 메인스트림 | React, Vue 3, Svelte 5, Solid | 앱 프레임워크와 충돌 가능, 번들 과함 |
| 경량 Web Component | **Lit**, Stencil, FAST, Hybrids | Lit이 가장 검증됨 |
| 초경량 | VanJS (1KB), uhtml (2.5KB), petite-vue, Mithril | 매력적이나 생태계/유지보수 약함 |
| 시그널 기반 | @preact/signals-core | reactivity만 제공, 템플릿 문제 해결 못함 |
| 바닐라 | Custom Element + 직접 DOM 조작 | 템플릿 피로 누적, Phase 2+ 복잡도에 취약 |

핵심 판단 기준:

**(a) 프레임워크 어그노스틱 주입**: React/Vue/Svelte/Vanilla 어떤 앱에든 주입되어야 함. 패널이 React를 쓰면 앱과 두 React 인스턴스가 공존하는 문제 발생. **표준 Custom Element는 모든 프레임워크와 격리됨**.

**(b) 번들 크기 맥락**: Lit 7 KB는 core 50 KB 예산의 14%이나, 직접 구현 시 template 시스템 + reactivity 자체 구현으로 3~5 KB 사용 후 검증 부족. 실질 절약 2~4 KB는 자체 유지보수 부담을 정당화하지 못함.

**(c) Shadow DOM 네이티브 지원**: Lit은 `static styles = css\`...\`` → `adoptedStyleSheets` 자동 변환, `:host`/`::slotted` 타입 안전 지원, slot 처리 자동화. 바닐라로 동일 구현 시 실수 여지.

**(d) 표준 친화성**: Lit은 Google/Chrome 팀의 Web Components 레퍼런스 구현. VoidZero 생태계 철학("웹 표준 위 얇은 레이어")과 정합.

**(e) 컴포넌트 재사용**: Custom Element는 Astro 데모 사이트(ADR-017), Phase 3 외부 Dashboard, Phase 5 Collector/Dashboard에서 동일 코드로 재사용 가능.

**Decision:**

**Lit 3.x + Shadow DOM (closed mode) + Custom Elements**를 채택한다.

**구현 원칙:**

1. **모든 UI 컴포넌트는 Custom Element**
   - 인라인 패널, Astro 데모, 외부 Dashboard에서 동일 컴포넌트 재사용
   - 네이밍: `bse-` 접두사 (`bse-devtools-panel`, `bse-timeline`, `bse-message-detail`)

2. **Shadow DOM closed mode**
   - 외부 JS에서 `shadowRoot` 접근 불가
   - 앱이 실수로 또는 의도적으로 패널 내부 조작 방지
   - `customElements.define`이 idempotent하므로 HMR 중복 주입 구조적으로 차단

3. **스타일 격리**
   - `static styles = css\`...\``로 컴포넌트별 스타일 정의
   - `adoptedStyleSheets`로 인스턴스 간 자동 공유 (메모리 절약)
   - `:host { all: initial }`로 앱 inherited 스타일 차단

4. **상태 관리**
   - 컴포넌트 내부 상태: Lit reactive properties (`@state`)
   - 전역 상태: core engine의 pub/sub 구독
   - 별도 상태 관리 라이브러리 없음

5. **이벤트 격리**
   - 패널 내부 이벤트는 `composed: false`로 외부 버블링 차단
   - 앱의 전역 리스너에 영향 없도록

**구조 예시:**

```typescript
// packages/core/src/ui/components/timeline.ts
import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';

@customElement('bse-timeline')
export class Timeline extends LitElement {
  static styles = css`
    :host {
      all: initial;
      display: block;
      font-family: system-ui, sans-serif;
    }
    .message {
      padding: 4px 8px;
      border-bottom: 1px solid var(--bse-border);
    }
    .message[data-direction="in"] { color: var(--bse-in); }
    .message[data-direction="out"] { color: var(--bse-out); }
  `;

  @state() private messages: Message[] = [];
  private unsubscribe?: () => void;

  connectedCallback() {
    super.connectedCallback();
    this.unsubscribe = engine.subscribe('message', (msg) => {
      this.messages = [msg, ...this.messages].slice(0, 500);
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.unsubscribe?.();
  }

  render() {
    return html`
      ${this.messages.map(m => html`
        <div class="message" data-direction=${m.direction}>
          ${this.formatMessage(m)}
        </div>
      `)}
    `;
  }

  private formatMessage(msg: Message): string {
    // ...
  }
}
```

**Rejected alternatives:**

- **바닐라 + 직접 DOM 조작**: 템플릿 시스템 자체 구현 부담, Phase 2+ 복잡도 증가 시 유지보수 어려움. "최적화할 대상이 없으므로 바닐라"라는 주장은 Phase 1에는 맞지만, Custom Element 재사용/Shadow DOM 통합 편의를 잃음
- **uhtml (2.5 KB)**: Lit의 부분집합. template literal만 필요하면 이쪽이 가벼우나, 클래스 기반 Custom Element + reactive property + lifecycle을 직접 구현해야 함. 결국 Lit을 부분 재구현
- **VanJS (1 KB)**: 함수형 API. HTML 친숙도 떨어지고 커뮤니티 작음
- **Preact**: 앱이 React면 두 인스턴스 공존 우려. JSX 컴파일 필요
- **Solid/Svelte**: 컴파일 단계 추가, Shadow DOM 친화성 Lit 대비 약함
- **React/Vue 메인스트림**: 번들 과함, 앱 프레임워크와 충돌 가능

**Consequences:**

- (+) **프레임워크 어그노스틱**: 표준 Custom Element로 컴파일되어 어떤 앱에도 주입 가능
- (+) **재사용성**: Astro 데모, 외부 Dashboard 등 다른 컨텍스트에서 동일 코드 재사용
- (+) **Shadow DOM 네이티브**: `adoptedStyleSheets`, `:host`, slot 자동 처리
- (+) **표준 친화**: Google/Chrome 팀 유지, Web Components 표준 발전에 즉시 반응
- (+) **VoidZero 철학 정합**: "웹 표준 위 얇은 레이어"
- (+) **번들 비용 합리**: 7 KB로 Phase 5까지 UI 커버
- (−) **Lit 학습 곡선**: `html\`...\`` 태그, decorator, reactive property 학습 필요
- (−) **JSX 대비 DX 약함**: TypeScript 타입 체크가 template 안에서 제한적 (`lit-plugin` VS Code 확장으로 보완)
- (−) **decorator 사용**: experimental decorator 설정 필요 (TS 6의 stable decorator로 마이그레이션 가능)

**호환성 정책:**

- Lit 3.x 메이저 버전 따라감
- Lit 4.0 릴리스 시 마이그레이션 검토 (currently no announced timeline)
- decorator는 Lit이 권장하는 방식 사용, ECMAScript 표준 decorator 안정화 시 전환

---

## 향후 ADR 후보

결정이 필요하지만 아직 미확정인 항목. 착수 과정에서 별도 ADR로 발전시킨다.

- **ADR-019**: 벤치마크 자동화 (초당 처리량 회귀 감지)
- **ADR-020**: 텔레메트리 (opt-in 여부, 수집 항목)
- **ADR-021**: 보안 리뷰 절차 (Phase 3 Dev Server 엔드포인트 대비)
