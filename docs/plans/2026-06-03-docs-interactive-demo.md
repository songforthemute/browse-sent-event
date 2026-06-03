# 문서 SPA 인터랙티브 예제 데모 구현 계획

> **Claude용:** 필수 하위 스킬: `superpowers:executing-plans`, `superpowers:verification-before-completion`를 사용해 이 계획을 작업 단위로 실행한다.

**목표:** GitHub Pages로 배포되는 VitePress 기술 문서 SPA 안에 `browse-sent-event` DevTools panel을 직접 체험할 수 있는 정적 인터랙티브 예제 페이지를 추가한다.

**아키텍처:** 기존 `examples/devtools-browser-fixture`는 Playwright E2E용 실제 Vite app으로 유지한다. 문서 SPA에는 별도 VitePress client component를 추가하고, 이 component가 core engine을 생성한 뒤 샘플 WebSocket, fetch stream, EventSource 메시지를 seed한다. 첫 버전은 서버 endpoint 없이 동작하는 seeded demo로 만들고, 실제 transport interceptor 검증은 기존 browser fixture와 E2E 테스트 책임으로 남긴다.

**기술 스택:** VitePress 2 alpha, Vue SFC, TypeScript 6, Lit custom element, `@browse-sent-event/core`, pnpm workspace, GitHub Pages.

---

## 배경

문서 사이트는 이미 GitHub Pages에 정적 SPA로 배포된다. 사용자가 npm 배포 전에도 제품의 핵심 표면을 확인하려면 README나 PRD 설명만으로는 부족하다. DevTools panel은 시각적/상호작용적 도구이므로 문서 안에서 직접 열어보고 메시지를 seed해보는 페이지가 필요하다.

현재 예제는 `examples/devtools-browser-fixture`에 있다. 이 fixture는 Vite dev server middleware와 Playwright 테스트에 맞춰져 있으며, 정적 GitHub Pages 문서에 그대로 포함하기 어렵다. 따라서 문서용 데모와 E2E fixture를 분리한다.

## 현재 코드 기준

| 영역 | 현재 상태 | 판단 |
| --- | --- | --- |
| Docs app | `docs/` VitePress SPA | 정적 GitHub Pages 배포 가능 |
| Docs navigation | `docs/.vitepress/config.mts` sidebar | `예제` 섹션 추가 가능 |
| Core panel | `bse-devtools-panel` Lit custom element | `mountDevtoolsPanel()`이 body에 fixed panel로 mount |
| Core engine | `createBrowseSentEventRuntime()`, `recordConnection()`, `recordMessage()` | 서버 없이 seeded demo 구성 가능 |
| Browser fixture | `examples/devtools-browser-fixture` | 실제 transport E2E 검증 책임 유지 |

## 설계

### 사용자 경험

문서에는 `예제 > DevTools panel` 페이지를 추가한다. 페이지 본문은 짧은 설명, 데모 controls, 현재 seed 상태, 실제 DevTools panel toggle로 구성한다.

```text
docs/examples/devtools-panel

+----------------------------------------------------------+
| DevTools panel 예제                                      |
|                                                          |
| [Seed WebSocket] [Seed fetch stream] [Seed EventSource]  |
| [Open panel] [Clear] [Export JSONL]                      |
|                                                          |
| Connections: 3  Messages: 6  Incoming: 3  Outgoing: 3    |
|                                                          |
| 이 데모는 정적 문서용 seeded demo입니다.                 |
+----------------------------------------------------------+
                                              +-----------+
                                              | BSE Panel |
                                              +-----------+
```

첫 버전의 panel은 core의 현재 동작을 그대로 사용해 viewport 우측 하단에 fixed panel로 띄운다. 문서 본문 안에 inline으로 panel을 넣는 것은 core style/API 변경이 필요하므로 첫 버전에서는 하지 않는다.

### 데이터 흐름

```text
VitePress markdown page
  -> DevtoolsPanelDemo.vue
    -> createBrowseSentEventRuntime({ capacity })
    -> mountDevtoolsPanel({ engine, options, target: window })
    -> button click
      -> engine.recordConnection()
      -> engine.recordMessage()
      -> panel subscriber rerender
```

문서 데모는 `installBrowseSentEvent()`를 사용하지 않는다. `installBrowseSentEvent()`는 실제 browser API interceptor와 global runtime 설치까지 수행하므로, 문서 사이트 자체의 fetch나 navigation을 우연히 수집할 수 있다. 데모에서는 engine과 panel만 직접 연결한다.

### package import 전략

VitePress component에서는 `@browse-sent-event/core` 이름으로 import한다.

```ts
import {
  createBrowseSentEventRuntime,
  mountDevtoolsPanel,
  resolveOptions,
} from "@browse-sent-event/core";
```

문서 빌드는 npm publish 전에도 동작해야 하므로 `docs/.vitepress/config.mts`에 Vite alias를 추가한다.

```ts
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  vite: {
    resolve: {
      alias: {
        "@browse-sent-event/core": fileURLToPath(
          new URL("../../packages/core/src/index.ts", import.meta.url),
        ),
      },
    },
  },
});
```

이 방식은 docs bundle이 workspace source를 직접 빌드하게 한다. 만약 VitePress가 source 내부의 `.js` extension import를 해석하지 못하면 구현을 멈추고, 대안으로 `docs:build` 전에 `@browse-sent-event/core` build를 요구하는 방식으로 전환한다.

### 예제 데이터

샘플은 실제 protocol 의미를 보여주되 서버를 요구하지 않는다.

| 버튼 | connection | messages |
| --- | --- | --- |
| Seed WebSocket | `wss://example.dev/socket` | `client hello`, `server hello` |
| Seed fetch stream | `/api/stream` | `chunk: token-1`, `chunk: token-2` |
| Seed EventSource | `/events` | `data: ready`, `data: update` |

각 seed는 connection을 open 상태로 만들고, 일부는 closed 상태 업데이트까지 넣어 lifecycle 느낌을 보여준다.

### 오류 처리

- component unmount 시 mounted panel을 unmount한다.
- runtime이 아직 준비되지 않았는데 버튼을 누르면 no-op 대신 화면 상태에 오류 메시지를 표시한다.
- export 버튼은 `engine.exportJsonl()` 결과를 `<textarea readonly>` 또는 `<pre>`에 표시한다.
- SSR 단계에서는 browser API를 사용하지 않는다. component는 `onMounted()` 이후에만 runtime과 panel을 생성한다.

## 의식적 부채

| 부채 | 지금 포기하는 것 | 지금 감당 가능한 이유 | 회수 시점 |
| --- | --- | --- | --- |
| 정적 seeded demo | 문서 페이지에서 실제 WebSocket/SSE/fetch stream endpoint를 사용한 interceptor 체험 | GitHub Pages는 정적 호스팅이고, 실제 transport 검증은 `examples/devtools-browser-fixture`와 Playwright E2E가 담당한다 | examples app을 별도 artifact로 배포하거나 server-backed demo 환경을 만들 때 |
| fixed panel | 문서 본문 안에 inline panel을 삽입하는 UX | 현재 core panel은 fixed DevTools overlay가 제품 기본 경험이며, inline mode는 core API/style 변경을 요구한다 | 문서 데모 UX가 핵심 온보딩 표면이 되거나 core에 `inline` mount mode를 추가할 때 |
| docs build source alias | 문서 빌드가 workspace source를 직접 bundle하는 구조 | npm publish 전에도 문서 데모를 빌드해야 하며 root package는 private이다 | 첫 npm alpha publish 후 package import를 배포 산출물 기준으로 검증할 때 |

## 구현 계획

### 작업 1: 설계/계획 문서 연결

**파일:**
- 생성: `docs/plans/2026-06-03-docs-interactive-demo.md`
- 수정: `docs/index.md`
- 수정: `docs/.vitepress/config.mts`

**단계 1: 계획 문서 작성**

이 문서를 작성한다. 설계, 구현 계획, 검증 계획, 의식적 부채를 포함한다.

**단계 2: 문서 홈에 계획 링크 추가**

`docs/index.md`의 최근 구현 계획 맨 위에 다음 링크를 추가한다.

```markdown
- [문서 SPA 인터랙티브 예제 데모](./plans/2026-06-03-docs-interactive-demo.md)
```

**단계 3: VitePress sidebar에 계획 링크 추가**

`docs/.vitepress/config.mts`의 `구현 계획` 그룹 맨 위에 다음 항목을 추가한다.

```ts
{
  text: "문서 SPA 인터랙티브 예제 데모",
  link: "/plans/2026-06-03-docs-interactive-demo",
}
```

**단계 4: 검증**

```bash
pnpm docs:build
pnpm format:check
git diff --check
```

기대 결과:

- VitePress build가 exit code `0`으로 끝난다.
- 새 계획 문서가 문서 홈과 sidebar에서 접근 가능하다.

**커밋:**

```bash
git add docs/plans/2026-06-03-docs-interactive-demo.md docs/index.md docs/.vitepress/config.mts
git commit -m "docs(plan): 문서 예제 데모 계획 추가"
```

### 작업 2: VitePress 예제 페이지와 navigation 추가

**파일:**
- 생성: `docs/examples/devtools-panel.md`
- 수정: `docs/index.md`
- 수정: `docs/.vitepress/config.mts`

**단계 1: 예제 문서 생성**

`docs/examples/devtools-panel.md`를 생성한다.

````markdown
---
outline: deep
---

# DevTools panel 예제

이 페이지는 `browse-sent-event` DevTools panel의 정적 문서용 seeded demo다.
실제 transport interceptor 검증은 `examples/devtools-browser-fixture`와 Playwright E2E에서 수행한다.

<script setup>
import DevtoolsPanelDemo from "../.vitepress/components/DevtoolsPanelDemo.vue";
</script>

<ClientOnly>
  <DevtoolsPanelDemo />
</ClientOnly>
````

**단계 2: VitePress sidebar에 예제 섹션 추가**

`docs/.vitepress/config.mts` sidebar의 `릴리즈`와 `구현 계획` 사이에 `예제` 그룹을 추가한다.

```ts
{
  text: "예제",
  items: [{ text: "DevTools panel", link: "/examples/devtools-panel" }],
}
```

**단계 3: 문서 홈에 예제 링크 추가**

`docs/index.md`에 `예제` 섹션을 추가한다.

```markdown
## 예제

- [DevTools panel 예제](./examples/devtools-panel.md)
```

**단계 4: 빈 component로 실패 지점 확인**

아직 `DevtoolsPanelDemo.vue`가 없으므로 다음 명령은 실패해야 한다.

```bash
pnpm docs:build
```

기대 결과:

- `DevtoolsPanelDemo.vue`를 찾을 수 없다는 build error가 난다.

**커밋은 아직 하지 않는다.** 다음 작업에서 component를 추가한 뒤 같은 커밋에 묶는다.

### 작업 3: 문서 전용 DevTools panel demo component 추가

**파일:**
- 생성: `docs/.vitepress/components/DevtoolsPanelDemo.vue`
- 수정: `docs/.vitepress/config.mts`
- 수정: `docs/examples/devtools-panel.md`
- 수정: `docs/index.md`

**단계 1: Vite alias 추가**

`docs/.vitepress/config.mts` 상단에 다음 import를 추가한다.

```ts
import { fileURLToPath, URL } from "node:url";
```

`defineConfig` 루트에 다음 `vite.resolve.alias`를 추가한다.

```ts
vite: {
  resolve: {
    alias: {
      "@browse-sent-event/core": fileURLToPath(
        new URL("../../packages/core/src/index.ts", import.meta.url),
      ),
    },
  },
},
```

**단계 2: component 작성**

`docs/.vitepress/components/DevtoolsPanelDemo.vue`를 생성한다.

핵심 요구사항:

- `onMounted()`에서 runtime과 mounted panel을 생성한다.
- `onUnmounted()`에서 panel을 unmount한다.
- WebSocket, fetch stream, EventSource 샘플 seed 버튼을 제공한다.
- Clear 버튼은 engine을 비운다.
- Open panel 버튼은 panel host의 `setOpen(true)`를 호출한다.
- Export JSONL 버튼은 `engine.exportJsonl()` 결과를 화면에 표시한다.
- SSR 중에는 `window`나 `customElements`에 접근하지 않는다.

샘플 구조:

```vue
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import {
  createBrowseSentEventRuntime,
  mountDevtoolsPanel,
  resolveOptions,
  type BrowseSentEventRuntime,
  type MountedDevtoolsPanel,
} from "@browse-sent-event/core";

const runtime = ref<BrowseSentEventRuntime>();
const mountedPanel = ref<MountedDevtoolsPanel>();
const exportText = ref("");
const errorMessage = ref("");
const snapshot = ref({ connections: [], messages: [], metrics: undefined });

function openPanel(): void {
  const setOpen = Reflect.get(mountedPanel.value?.element, "setOpen");

  if (typeof setOpen === "function") {
    setOpen.call(mountedPanel.value?.element, true);
  }
}
</script>
```

구현 시 전체 코드는 component 안에서 완성한다. helper는 이 component 안에 두고, 재사용 요구가 생기기 전에는 별도 모듈을 만들지 않는다.

**단계 3: 샘플 seed 구현**

각 seed 함수는 다음 패턴을 따른다.

```ts
const connection = runtime.value.engine.recordConnection({
  protocol: "websocket",
  state: "open",
  url: "wss://example.dev/socket",
});

runtime.value.engine.recordMessage({
  connectionId: connection.id,
  direction: "out",
  payload: "client hello",
  protocol: "websocket",
  type: "message",
});
```

**단계 4: docs build 검증**

```bash
pnpm docs:build
```

기대 결과:

- VitePress build가 성공한다.
- alias 또는 source import 문제가 있으면 여기서 실패한다.

**단계 5: 포맷 검증**

```bash
pnpm format:check
git diff --check
```

기대 결과:

- oxfmt가 Markdown, TypeScript, Vue 파일을 모두 통과한다.
- whitespace error가 없다.

**커밋:**

```bash
git add docs/examples/devtools-panel.md docs/.vitepress/components/DevtoolsPanelDemo.vue docs/.vitepress/config.mts docs/index.md
git commit -m "docs(examples): DevTools 패널 예제 페이지 추가"
```

### 작업 4: 문서 예제 smoke 검증 계획 결정

**파일:**
- 수정: `docs/plans/2026-06-03-docs-interactive-demo.md`
- 조건부 수정: `playwright.config.ts`
- 조건부 생성: `e2e/docs-example.spec.ts`

**단계 1: `pnpm docs:build`만으로 충분한지 판단**

첫 구현 PR에서는 문서 build가 최소 gate다. 하지만 component가 browser-only interaction을 가지므로, 다음 중 하나를 선택한다.

| 선택 | 내용 | 판단 |
| --- | --- | --- |
| A | 이번 PR에서는 `pnpm docs:build`까지만 검증 | 가장 작고 빠름 |
| B | 같은 PR에서 VitePress dev server Playwright smoke 추가 | 상호작용까지 검증하지만 config가 복잡해짐 |

추천은 A다. 문서 build와 component type check 수준을 먼저 통과시키고, browser smoke는 별도 PR로 분리한다.

**단계 2: A를 선택하면 부채 기록 추가**

계획 문서에 다음 부채를 남긴다.

- 포기하는 것: 문서 예제의 browser interaction 자동 검증.
- 감당 가능한 이유: 첫 PR은 docs build와 static bundle 가능성을 검증하고, 기존 E2E는 제품 panel 동작을 이미 검증한다.
- 회수 시점: 문서 예제가 릴리즈 온보딩 표면으로 고정될 때 Playwright docs smoke를 추가한다.

**단계 3: B를 선택하면 별도 계획으로 확대**

`playwright.config.ts`에 docs server를 함께 띄우는 설계가 필요하다. 기존 fixture E2E와 baseURL이 다르므로, 같은 PR에 끼워 넣지 말고 별도 계획을 작성한다.

**커밋:**

```bash
git add docs/plans/2026-06-03-docs-interactive-demo.md
git commit -m "docs(test): 문서 예제 검증 범위 기록"
```

## 검증 계획

### 계획 문서 검증

```bash
pnpm docs:build
pnpm format:check
git diff --check
```

### 예제 구현 검증

```bash
pnpm docs:build
pnpm format:check
git diff --check
```

### 선택적 수동 확인

```bash
pnpm docs:dev
```

브라우저에서 다음을 확인한다.

- `/examples/devtools-panel` 페이지가 열린다.
- Seed 버튼을 누르면 count가 증가한다.
- Open panel 버튼을 누르면 DevTools panel이 보인다.
- Clear 버튼을 누르면 count가 초기화된다.
- Export JSONL 결과가 화면에 표시된다.

### 이후 자동화 후보

문서 예제가 온보딩 핵심 표면이 되면 별도 PR에서 Playwright smoke를 추가한다.

후보 검증:

```bash
pnpm docs:dev --host 127.0.0.1 --port 4175
pnpm exec playwright test e2e/docs-example.spec.ts
```

## 완료 기준

- 문서 홈에서 예제 문서로 이동할 수 있다.
- VitePress sidebar에 `예제 > DevTools panel`이 보인다.
- 문서 예제 페이지가 GitHub Pages 정적 빌드에 포함된다.
- 데모 component가 SSR 단계에서 browser global을 참조하지 않는다.
- seeded demo임을 문서가 명확히 설명한다.
- 실제 transport 검증 책임이 `examples/devtools-browser-fixture`와 E2E에 남는다는 점이 문서화된다.
