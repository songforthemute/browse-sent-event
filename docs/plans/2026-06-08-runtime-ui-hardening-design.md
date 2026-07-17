# Runtime/UI 하드닝 설계

> **Claude용:** 구현 단계에서는 `superpowers:executing-plans`, `superpowers:test-driven-development`, `superpowers:verification-before-completion`를 사용해 작업 단위로 진행한다.

**목표:** Phase 1 alpha 후보를 만들기 전에 `@browse-sent-event/core`의 runtime, interceptor, DevTools UI 경계를 작게 정리해 이후 기능 추가 비용과 전역 patch 리스크를 낮춘다.

**아키텍처:** `packages/core` 패키지는 유지한다. source of truth는 runtime engine에 남기고, 파생 계산(selector/export/metrics), UI 렌더 조각, 전역 API patch ownership을 내부 모듈로 분리한다. Vite plugin은 현재 역할을 유지하되 HTML entry 탐지 edge case를 테스트로 고정한다.

**기술 스택:** TypeScript 6, Lit 3, Vitest 4, happy-dom, Playwright, Vite 8, pnpm workspace, Turborepo.

---

## 배경

현재 `browse-sent-event`는 Phase 1 DevTools MVP의 주요 기능을 갖췄다.

- Vite 개발 서버 entry bootstrap 주입
- WebSocket, fetch ReadableStream, EventSource 수집
- in-memory ring buffer
- 연결 목록, 메시지 타임라인, 메트릭, 검색/방향 필터
- JSONL/log export
- VitePress 문서 예제와 Playwright Chromium E2E

지금 구조는 작고 이해하기 쉽다. 다만 다음 기능을 붙일수록 다음 지점의 변경 비용이 커질 수 있다.

| 영역 | 현재 장점 | 장기 리스크 |
| --- | --- | --- |
| Runtime engine | 모든 state 전이가 한 파일에 있어 흐름이 보인다 | metrics/search/export/notify가 계속 늘면 engine이 feature hub가 된다 |
| DevTools panel | Lit element 하나로 mount와 UI가 단순하다 | CSS, render, event handling, export가 한 클래스에 몰려 변경 충돌이 잦아질 수 있다 |
| Interceptors | protocol별 구현이 짧고 테스트가 쉽다 | 전역 API patch/unpatch 순서가 다른 라이브러리와 충돌할 수 있다 |
| Vite plugin | dev serve 전용 주입이 명확하다 | HTML entry 탐지가 정규식 기반이라 edge case를 놓치기 쉽다 |
| Docs/status | 결정 기록이 풍부하다 | README, ADR, release guide, plan이 같은 상태를 반복하면 drift가 생긴다 |

이 문서는 큰 재작성 계획이 아니다. Phase 1의 현재 단순함을 유지하면서, 다음 기능의 발판이 되는 경계만 먼저 단단하게 만든다.

## 설계 원칙

1. **공개 API 안정성 우선**
   - `installBrowseSentEvent()`, `createDevtoolsEngine()`, `mountDevtoolsPanel()`의 외부 사용법은 유지한다.
   - 필요하면 내부 helper를 추가하되 package export는 최소화한다.

2. **분리보다 테스트가 먼저**
   - 추상화를 만들기 전에 현재 기대 동작을 테스트로 고정한다.
   - 특히 전역 patch 복구, stream tap 실패, UI 필터/선택 상태는 regression test를 먼저 둔다.

3. **한 번에 하나의 축만 바꾼다**
   - UI 분리 PR에서 interceptor 동작을 바꾸지 않는다.
   - interceptor 하드닝 PR에서 Vite plugin 탐지를 바꾸지 않는다.

4. **성능 최적화는 관측 가능한 병목부터**
   - 현재 capacity가 작다면 동기 notify는 단순성과 예측 가능성이 있다.
   - microtask/RAF batching은 테스트와 UX 기준이 생긴 뒤 도입한다.

5. **의식적 부채를 문서화한다**
   - 지금 보류하는 결정은 “무엇을 포기하는지, 왜 감당 가능한지, 언제 회수할지”를 함께 남긴다.

## 현재 구조

```text
Vite dev server
  -> @browse-sent-event/plugin-vite
    -> virtual bootstrap module
      -> installBrowseSentEvent()
        -> installWebSocketInterceptor()
        -> installFetchStreamInterceptor()
        -> installEventSourceInterceptor()
        -> mountDevtoolsPanel()

Browser transport event
  -> interceptor
    -> engine.recordConnection()/recordMessage()/updateConnection()
      -> engine snapshot
        -> getPanelViewModel()
          -> BrowseSentEventDevtoolsPanelElement render()
```

핵심 파일은 다음과 같다.

| 책임 | 파일 |
| --- | --- |
| Runtime 설치 | `packages/core/src/runtime/install.ts` |
| Engine state/search/export/metrics | `packages/core/src/runtime/engine.ts` |
| Protocol 수집 | `packages/core/src/interceptors/*.ts` |
| UI view model | `packages/core/src/ui/view-model.ts` |
| Lit panel | `packages/core/src/ui/components/devtools-panel.ts` |
| Vite 주입 | `packages/plugin-vite/src/index.ts`, `packages/plugin-vite/src/injection.ts` |
| Browser 검증 | `e2e/devtools-panel.spec.ts` |

## 목표와 비목표

### 목표

- DevTools panel 파일의 책임을 작게 나눈다.
- engine의 파생 계산을 테스트 가능한 내부 helper로 분리한다.
- 전역 API patch/unpatch가 다른 patch와 충돌할 때의 동작을 명시한다.
- fetch stream tap 실패가 unhandled rejection으로 새지 않도록 한다.
- Vite HTML entry 탐지의 주요 edge case를 테스트로 고정한다.
- 다음 구현 PR들이 하나의 기능 단위 커밋으로 나뉘도록 순서를 정한다.

### 비목표

- `@browse-sent-event/core`를 여러 npm package로 쪼개지 않는다.
- DevTools panel을 여러 custom element로 즉시 분해하지 않는다.
- panel inline mode, draggable layout, persistent position은 이 설계의 직접 구현 범위가 아니다.
- Firefox/WebKit E2E matrix를 바로 CI 필수 gate로 추가하지 않는다.
- production build instrumentation은 계속 범위 밖으로 둔다.

## 제안 아키텍처

```text
packages/core/src
  runtime/
    engine.ts              # source of truth와 public engine facade
    selectors.ts           # filter/search/metrics 파생 계산
    export.ts              # JSONL/log serialization
    diagnostics.ts         # capture failure metadata 타입 후보
  interceptors/
    global-patch.ts        # 전역 API patch ownership helper
    websocket.ts
    fetch-stream.ts
    eventsource.ts
  ui/
    view-model.ts          # snapshot -> panel model
    components/
      devtools-panel.ts    # Lit element state와 event wiring
      devtools-panel.styles.ts
      devtools-panel.render.ts  # 필요할 때만 도입
```

첫 구현에서는 `selectors.ts`, `export.ts`, `global-patch.ts`, `devtools-panel.styles.ts`까지를 우선 후보로 둔다. `diagnostics.ts`와 `devtools-panel.render.ts`는 테스트와 변경량을 보고 도입한다.

## 설계 결정

### 결정 1: Engine은 source of truth로 남기고, 파생 계산만 분리한다

**선택:** `engine.ts`는 connection/message 저장, mutation, subscriber 관리만 중심으로 유지한다. filter/search/metrics/export는 내부 순수 함수로 옮긴다.

```text
engine.ts
  -> selectors.ts
     - filterMessages(messages, connections, filter)
     - searchMessages(messages, connections, query)
     - calculateMetrics(messages, connections, connectionId?)
  -> export.ts
     - exportMessagesAsJsonl(messages)
     - exportMessagesAsLog(messages)
```

**트레이드오프:**

| 선택지 | 장점 | 단점 | 판단 |
| --- | --- | --- | --- |
| 지금처럼 engine 한 파일 유지 | 가장 단순하고 호출 추적이 쉽다 | 기능이 늘면 engine 테스트가 거대해진다 | 단기 유지에는 좋지만 다음 기능부터 비용 증가 |
| 파생 계산을 순수 함수로 분리 | 테스트가 작아지고 성능 개선 지점이 선명해진다 | 파일 수가 늘어난다 | 추천 |
| 별도 store/controller 도입 | 복잡한 상태 관리에 강하다 | Phase 1에는 과하다 | 보류 |

**구체 작업:**

- `packages/core/src/runtime/selectors.ts` 생성
- `packages/core/src/runtime/export.ts` 생성
- `packages/core/src/runtime/__tests__/selectors.test.ts` 생성
- 기존 `engine.test.ts`는 public engine behavior 중심으로 유지

**주의:** 외부 export surface에는 새 helper를 노출하지 않는다. 내부 경계 정리 목적이다.

### 결정 2: Notify batching은 지금 도입하지 않는다

**선택:** `engine.subscribe()`의 동기 notify는 유지한다. 대신 high-throughput에 취약한 계산 지점을 테스트와 helper 분리로 먼저 드러낸다.

**트레이드오프:**

| 선택지 | 장점 | 단점 | 판단 |
| --- | --- | --- | --- |
| 동기 notify 유지 | 테스트와 UI 갱신 순서가 예측 가능하다 | 많은 메시지에서 렌더 요청이 자주 발생할 수 있다 | 현재 유지 |
| `queueMicrotask` batching | burst 메시지에서 UI 갱신을 줄인다 | snapshot 전달 시점이 비동기로 바뀐다 | 실제 병목 확인 후 |
| `requestAnimationFrame` batching | UI 렌더와 잘 맞는다 | non-browser/runtime test에서 분기가 늘어난다 | panel layer에서 검토 |

**구체 작업:**

- 1차 구현에서는 notify timing을 바꾸지 않는다.
- selector/view-model 테스트에 1,000개 수준 메시지를 넣어 결과 정확성을 고정한다.
- 실제 성능 문제가 확인되면 별도 계획에서 `notifyScheduler` 옵션 또는 panel-side batching을 설계한다.

### 결정 3: DevTools panel은 한 custom element를 유지하되, 스타일과 렌더 조각을 분리한다

**선택:** `bse-devtools-panel` custom element는 하나로 유지한다. 먼저 CSS를 `devtools-panel.styles.ts`로 분리하고, 필요하면 render helper를 별도 파일 또는 private method로 나눈다.

**트레이드오프:**

| 선택지 | 장점 | 단점 | 판단 |
| --- | --- | --- | --- |
| 현 구조 유지 | 파일 이동 없음 | CSS/render/event/export가 계속 한 파일에 축적 | 다음 UI 기능 전에 정리 필요 |
| CSS만 분리 | 변경량이 작고 리스크가 낮다 | render 복잡도는 일부 남는다 | 1차 추천 |
| toolbar/timeline/detail을 별도 custom element로 분리 | 각 컴포넌트 책임이 선명하다 | registration, closed shadow, event bubbling 정책이 복잡해진다 | 지금은 보류 |
| Lit template helper 함수 분리 | custom element 추가 없이 렌더를 나눌 수 있다 | callback 타입이 길어질 수 있다 | CSS 분리 후 필요 시 |

**구체 작업:**

- `packages/core/src/ui/components/devtools-panel.styles.ts` 생성
- `devtools-panel.ts`는 state, lifecycle, event wiring에 집중
- render는 최소한 private method로 다음 단위까지 나눈다.
  - `#renderToggle()`
  - `#renderPanel(model)`
  - `#renderMetrics(model)`
  - `#renderToolbar()`
  - `#renderConnections(model)`
  - `#renderTimeline(model)`
  - `#renderDetail(model)`

**보류:** 별도 custom element 분해는 UI 상호작용이 더 늘어난 뒤 결정한다. 지금 분해하면 closed shadow DOM 안의 테스트/이벤트 경계가 불필요하게 복잡해질 수 있다.

### 결정 4: 전역 API patch ownership helper를 둔다

**선택:** WebSocket, fetch, EventSource patch/unpatch 공통 helper를 만든다. uninstall 시 현재 전역 값이 우리가 설치한 wrapper일 때만 원본으로 되돌린다. 다른 코드가 나중에 다시 patch했다면 덮어쓰지 않는다.

```text
installGlobalPatch(target, "fetch", createReplacement)
  original = target.fetch
  replacement = createReplacement(original)
  target.fetch = replacement

uninstall()
  if target.fetch === replacement:
    target.fetch = original
  else:
    skip restore
```

**트레이드오프:**

| 선택지 | 장점 | 단점 | 판단 |
| --- | --- | --- | --- |
| 항상 원본 복구 | 단순하다 | 우리 뒤에 설치된 patch를 지울 수 있다 | 위험 |
| 현재 값이 wrapper일 때만 복구 | 다른 patch를 보존한다 | 나중 patch 내부에 잡힌 우리 wrapper는 완전히 제거할 수 없다 | 추천 |
| patch stack registry 구현 | 중첩 patch를 더 정확히 추적한다 | 전역 협력자가 없으면 완전하지 않고 과하다 | 보류 |

**구체 작업:**

- `packages/core/src/interceptors/global-patch.ts` 생성
- `InstalledBrowseSentEventInterceptor.uninstall()`은 기존 `void` 계약 유지
- helper 테스트:
  - current value가 wrapper이면 원본 복구
  - current value가 다른 함수로 바뀌었으면 복구 skip
  - 기존에 이미 patch된 원본 위에 설치하면 그 patch를 original로 취급

**한계:** 다른 라이브러리가 BSE wrapper를 감싼 뒤 uninstall하면 그 라이브러리 내부 참조까지 제거할 수 없다. 이는 JavaScript 전역 monkey patch 구조의 본질적 한계다.

### 결정 5: fetch stream tap 실패를 diagnostics로 남긴다

**선택:** cloned response body를 읽는 과정에서 오류가 나면 unhandled rejection을 만들지 않고 connection metadata에 capture failure를 남긴다.

**후보 metadata:**

```ts
metadata: {
  captureStatus: "failed",
  captureError: "ReadableStream read failed"
}
```

**트레이드오프:**

| 선택지 | 장점 | 단점 | 판단 |
| --- | --- | --- | --- |
| 오류 무시 | 사용자 앱 영향 최소 | DevTools가 왜 비었는지 알 수 없다 | 부족 |
| metadata에 실패 기록 | API 변경이 작고 테스트 가능 | UI에 바로 보이지 않을 수 있다 | 1차 추천 |
| 별도 diagnostics event/store | 관측성이 좋다 | 설계 범위가 커진다 | 후속 |

**구체 작업:**

- `fetch-stream.test.ts`에 reader failure 테스트 추가
- 실패해도 app response 반환 경로는 깨지지 않아야 한다
- connection은 closed 상태가 되고 metadata에 실패 정보가 남아야 한다

### 결정 6: Vite HTML entry 탐지는 테스트를 먼저 넓힌다

**선택:** 정규식 기반 entry 수집은 유지한다. 대신 현재 지원한다고 볼 수 있는 HTML 형태를 테스트로 고정하고, 테스트로 드러난 한계가 있을 때 parser 도입을 검토한다.

**트레이드오프:**

| 선택지 | 장점 | 단점 | 판단 |
| --- | --- | --- | --- |
| 정규식 유지 | 의존성 없음, 구현 짧음 | HTML edge case에 약하다 | 테스트 보강 전제 유지 |
| HTML parser 도입 | 견고하다 | dev plugin에 의존성과 처리 비용이 늘어난다 | 지금은 보류 |
| Vite transform hook만 신뢰 | HTML parsing 제거 | 어떤 entry에 주입할지 판단이 흐려진다 | 부적합 |

**추가 테스트 후보:**

- module script 속성 순서가 바뀐 경우
- query string이 붙은 entry
- 여러 module entry
- 상대 경로 entry
- disabled 옵션일 때 HTML entry를 수집해도 transform은 주입하지 않는지

### 결정 7: 문서 drift는 “현황 문서 얇게, 결정 문서 깊게”로 관리한다

**선택:** README와 docs index는 현재 상태와 진입점만 유지한다. 세부 정책은 ADR, release guide, plan 문서로 보낸다.

**트레이드오프:**

| 선택지 | 장점 | 단점 | 판단 |
| --- | --- | --- | --- |
| 모든 문서에 상세 반복 | 각 문서만 읽어도 이해된다 | 버전/정책 drift가 잦다 | 줄인다 |
| README를 얇게 유지 | 유지보수가 쉽다 | 처음 읽는 사람에게 정보가 적을 수 있다 | 추천 |
| 문서 자동 생성 | drift가 가장 적다 | 현재 규모에는 과하다 | 보류 |

## 구현 전략

하나의 PR에 모두 넣지 않는다. 다음 순서로 작은 PR을 쌓는다.

| 순서 | 목적 | 주요 파일 | 커밋 메시지 예시 |
| --- | --- | --- | --- |
| 1 | 설계 문서 추가 | `docs/plans/2026-06-08-runtime-ui-hardening-design.md` | `docs(plan): 런타임 UI 하드닝 설계 추가` |
| 2 | engine 파생 계산 분리 | `runtime/selectors.ts`, `runtime/export.ts`, engine tests | `refactor(runtime): 파생 계산 경계 분리` |
| 3 | view-model 계산 비용 정리 | `ui/view-model.ts`, view-model tests | `refactor(ui): 패널 view model 계산 정리` |
| 4 | panel 스타일/렌더 분리 | `devtools-panel.ts`, `devtools-panel.styles.ts` | `refactor(ui): DevTools 패널 구조 분리` |
| 5 | global patch helper | `interceptors/global-patch.ts`, interceptor tests | `refactor(interceptors): 전역 패치 복구 경계 정리` |
| 6 | fetch capture failure 처리 | `fetch-stream.ts`, fetch tests | `fix(interceptors): fetch stream 수집 실패 기록` |
| 7 | Vite entry edge tests | `plugin-vite/src/__tests__/injection.test.ts` | `test(plugin-vite): HTML entry 탐지 사례 확장` |

각 PR은 구현과 검증이 끝난 뒤 바로 병합 가능한 크기로 유지한다. 설계 문서와 실제 구현은 분리해도 좋지만, 구현 중 결정이 바뀌면 같은 PR에서 이 문서를 갱신한다.

## 검증 계획

### 기본 검증

```bash
pnpm --filter @browse-sent-event/core test
pnpm --filter @browse-sent-event/plugin-vite test
pnpm typecheck
pnpm lint
pnpm format:check
```

### 통합 검증

```bash
pnpm test
pnpm build
pnpm pack:check
pnpm test:e2e
pnpm docs:build
```

### 리스크별 검증

| 리스크 | 검증 |
| --- | --- |
| engine helper 분리 중 search/export 의미 변경 | 기존 engine behavior test 유지 + selector 단위 테스트 추가 |
| UI 분리 중 closed shadow host 동작 변경 | `mount.test.ts`, Playwright panel host/seeded data 테스트 |
| 전역 patch 복구 중 다른 patch 훼손 | `global-patch.test.ts`에서 current value 변경 케이스 고정 |
| fetch tap 실패가 앱 response를 깨뜨림 | 실패 stream fixture로 response 반환과 metadata를 동시에 검증 |
| Vite injection 누락 | `vite-fixture.test.ts`와 injection helper edge case 테스트 |

## 의식적 부채

| 부채 | 지금 포기하는 것 | 지금 감당 가능한 이유 | 회수 시점 |
| --- | --- | --- | --- |
| notify batching 보류 | burst traffic에서 렌더 빈도 최적화 | 현재 API 동기성이 단순하고, 병목 데이터가 아직 없다 | 1,000개 이상 메시지 UX가 느리다는 E2E/사용자 제보가 생길 때 |
| custom element 분해 보류 | toolbar/timeline/detail의 독립 컴포넌트화 | closed shadow와 event 설계가 먼저 복잡해진다 | panel 기능이 검색/export 이상으로 확장될 때 |
| HTML parser 보류 | 모든 HTML 형태에 대한 견고한 parsing | Vite dev entry의 일반적인 module script만 Phase 1 범위다 | 테스트로 실제 누락 케이스가 확인될 때 |
| diagnostics store 보류 | 수집 실패/patch 충돌을 UI에서 체계적으로 표시 | metadata 기록만으로 1차 관측은 가능하다 | capture failure를 사용자에게 보여줘야 할 때 |
| Firefox/WebKit CI 보류 | 브라우저별 transport 차이 자동 검증 | 현재 CI 비용과 snapshot 안정성을 우선한다 | alpha 전 호환성 기준을 넓히기로 결정할 때 |

## 완료 기준

이 하드닝 묶음은 다음 조건을 만족하면 완료로 본다.

- `devtools-panel.ts`에서 CSS와 큰 render 책임이 분리되어 새 UI 기능을 작은 변경으로 추가할 수 있다.
- engine의 search/export/metrics 의미가 순수 함수 테스트로 고정되어 있다.
- interceptor uninstall이 다른 전역 patch를 덮어쓰지 않는 테스트를 가진다.
- fetch stream tap 실패가 unhandled rejection 없이 connection metadata에 남는다.
- Vite entry 탐지 edge case 테스트가 현재 지원 범위를 설명한다.
- README와 docs index는 최신 상태 요약만 담고, 세부 결정은 이 문서와 ADR/release guide로 연결된다.
