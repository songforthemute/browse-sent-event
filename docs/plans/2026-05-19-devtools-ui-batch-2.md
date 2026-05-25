# DevTools UI 배치 2 구현 및 검증 계획

> **Claude용:** `executing-plans`, `test-driven-development`, `verification-before-completion`를 사용해 작업별 RED/GREEN/검증/커밋 순서로 실행한다.

**목표:** 기존 DevTools UI 계획의 작업 4~6을 실행해 패널 토글, engine snapshot 구독, 연결 목록/메트릭 렌더링까지 완성한다.

**아키텍처:** `mountDevtoolsPanel()`은 custom element host 생성과 외부 이벤트 연결만 담당한다. `BrowseSentEventDevtoolsPanelElement`는 public 메서드와 Lit reactive property로 패널 상태를 관리하고, 렌더링 데이터는 `getPanelViewModel()`에서 계산한다. closed Shadow DOM 내부를 테스트에서 직접 파고들지 않고, public 계약과 view model을 중심으로 검증한다.

**기술 스택:** TypeScript 6, Lit 3, Custom Elements, closed Shadow DOM, Vitest 4.1.6, happy-dom, Oxlint, Oxfmt, pnpm workspace.

---

## 현재 코드 상태

| 영역 | 현재 상태 | 이번 배치에서 할 일 |
| --- | --- | --- |
| `packages/core/src/ui/components/devtools-panel.ts` | `engine`, `open` reactive property와 기본 toggle/panel shell만 있음 | `setOpen()`, snapshot 구독, connection/metrics 렌더링 추가 |
| `packages/core/src/ui/mount.ts` | element 생성, `engine/open/data-position` 설정, body append만 수행 | hotkey listener 등록/해제 추가 |
| `packages/core/src/ui/view-model.ts` | messages 정렬/필터와 기본 metrics label 제공 | connection `selected` 상태 추가 |
| `packages/core/src/ui/__tests__/mount.test.ts` | mount/unmount 계약만 검증 | hotkey, snapshot 구독 생명주기 검증 |
| `packages/core/src/ui/__tests__/view-model.test.ts` | 메시지 필터/정렬 검증 | selected connection 검증 |

## 설계 원칙

1. production code보다 테스트를 먼저 작성한다.
2. 패널 내부 DOM은 closed Shadow DOM이므로 단위 테스트에서 직접 query하지 않는다.
3. 테스트에서는 기존 lint 패턴대로 `globalThis.window`, `globalThis.document`를 사용한다.
4. Lit property는 class field shadowing을 피하기 위해 `declare`와 constructor 초기화를 사용한다.
5. `static properties`와 `static styles`는 `isolatedDeclarations`를 위해 명시 타입을 유지한다.
6. 각 작업은 하나의 기능 커밋으로 분리한다.

---

## 구현 계획

### 작업 4: Floating panel shell과 hotkey 연결

**파일:**
- 수정: `packages/core/src/ui/components/devtools-panel.ts`
- 수정: `packages/core/src/ui/mount.ts`
- 수정: `packages/core/src/ui/__tests__/mount.test.ts`

**사용자 가치:** 닫힌 패널을 키보드로 빠르게 열고 닫을 수 있다.

#### 4-1. 실패하는 hotkey 테스트 작성

`packages/core/src/ui/__tests__/mount.test.ts`에 테스트를 추가한다.

```typescript
it("toggles the panel with the configured hotkey", () => {
  const engine = createDevtoolsEngine({ capacity: 10 });
  const mounted = mountDevtoolsPanel({
    engine,
    options: {
      autoOpen: false,
      hotkey: "cmd+shift+r",
      position: "bottom-right",
    },
    target: globalThis.window,
  });

  expect(mounted.element.hasAttribute("open")).toBe(false);

  globalThis.window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "r",
      metaKey: true,
      shiftKey: true,
    }),
  );

  expect(mounted.element.hasAttribute("open")).toBe(true);

  mounted.unmount();
});
```

RED 실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/ui/__tests__/mount.test.ts
```

기대 실패:

- hotkey dispatch 이후에도 `open` attribute가 없어 실패한다.

#### 4-2. 패널 open 상태 동기화 구현

`BrowseSentEventDevtoolsPanelElement`에 public 메서드를 추가한다.

```typescript
setOpen(open: boolean): void {
  this.open = open;

  if (open) {
    this.setAttribute("open", "");
  } else {
    this.removeAttribute("open");
  }
}
```

private handler는 직접 `this.open`을 바꾸지 않고 `setOpen()`을 호출한다.

```typescript
#open(): void {
  this.setOpen(true);
}

#close(): void {
  this.setOpen(false);
}
```

#### 4-3. mount hotkey listener 구현

`packages/core/src/ui/mount.ts`에 matcher를 추가한다.

```typescript
function matchesHotkey(event: KeyboardEvent, hotkey: string): boolean {
  const normalized = hotkey.toLowerCase();

  return (
    normalized === "cmd+shift+r" &&
    (event.metaKey || event.ctrlKey) &&
    event.shiftKey &&
    event.key.toLowerCase() === "r"
  );
}
```

`mountDevtoolsPanel()` 내부에서 listener를 등록한다.

```typescript
const onKeyDown = (event: KeyboardEvent): void => {
  if (!matchesHotkey(event, options.options.hotkey)) {
    return;
  }

  event.preventDefault();

  const setOpen = Reflect.get(element, "setOpen");

  if (typeof setOpen === "function") {
    setOpen.call(element, !element.hasAttribute("open"));
  }
};

options.target.addEventListener("keydown", onKeyDown);
```

`unmount()`에서 listener를 제거한다.

```typescript
unmount() {
  options.target.removeEventListener("keydown", onKeyDown);
  element.remove();
}
```

#### 4-4. GREEN 검증과 커밋

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/ui/__tests__/mount.test.ts
pnpm --filter @browse-sent-event/core typecheck
pnpm lint
```

기대 결과:

- mount 테스트 통과.
- typecheck exit code `0`.
- lint `0 warnings`, `0 errors`.

커밋:

```bash
git add packages/core/src/ui/components/devtools-panel.ts packages/core/src/ui/mount.ts packages/core/src/ui/__tests__/mount.test.ts
git commit -m "feat(core): 플로팅 패널 shell 추가"
```

---

### 작업 5: 패널과 engine snapshot 구독 연결

**파일:**
- 수정: `packages/core/src/ui/components/devtools-panel.ts`
- 수정: `packages/core/src/ui/__tests__/mount.test.ts`

**사용자 가치:** 패널이 mount된 뒤 runtime engine에 기록되는 연결/메시지 상태를 실시간으로 받는다.

#### 5-1. 실패하는 snapshot 구독 테스트 작성

`packages/core/src/ui/__tests__/mount.test.ts`에 테스트를 추가한다.

```typescript
it("subscribes to engine snapshots while mounted", async () => {
  const engine = createDevtoolsEngine({ capacity: 10 });
  const mounted = mountDevtoolsPanel({
    engine,
    options: {
      autoOpen: true,
      hotkey: "cmd+shift+r",
      position: "bottom-right",
    },
    target: globalThis.window,
  });

  const connection = engine.recordConnection({
    protocol: "websocket",
    url: "wss://example.test/socket",
  });
  engine.recordMessage({
    connectionId: connection.id,
    direction: "in",
    protocol: "websocket",
    payload: "hello",
  });

  await Reflect.get(mounted.element, "updateComplete");

  expect(Reflect.get(mounted.element, "snapshot")?.messages).toHaveLength(1);

  mounted.unmount();
});
```

RED 실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/ui/__tests__/mount.test.ts
```

기대 실패:

- `snapshot`이 설정되지 않아 실패한다.

#### 5-2. unmount 이후 구독 해제 테스트 작성

같은 파일에 생명주기 테스트를 추가한다.

```typescript
it("unsubscribes from engine snapshots when unmounted", async () => {
  const engine = createDevtoolsEngine({ capacity: 10 });
  const mounted = mountDevtoolsPanel({
    engine,
    options: {
      autoOpen: true,
      hotkey: "cmd+shift+r",
      position: "bottom-right",
    },
    target: globalThis.window,
  });

  const connection = engine.recordConnection({
    protocol: "websocket",
    url: "wss://example.test/socket",
  });

  await Reflect.get(mounted.element, "updateComplete");
  const snapshotBeforeUnmount = Reflect.get(mounted.element, "snapshot");

  mounted.unmount();

  engine.recordMessage({
    connectionId: connection.id,
    direction: "in",
    protocol: "websocket",
    payload: "after unmount",
  });

  expect(Reflect.get(mounted.element, "snapshot")).toBe(snapshotBeforeUnmount);
});
```

#### 5-3. panel subscription 구현

`packages/core/src/ui/components/devtools-panel.ts`의 type import를 확장한다.

```typescript
import type {
  BrowseSentEventEngine,
  BrowseSentEventEngineSnapshot,
  BrowseSentEventUnsubscribe,
} from "../../runtime/engine.js";
```

reactive property와 필드를 추가한다.

```typescript
static override properties: PropertyDeclarations = {
  engine: { attribute: false },
  open: { type: Boolean, reflect: true },
  snapshot: { attribute: false },
};

declare snapshot?: BrowseSentEventEngineSnapshot;

#unsubscribe?: BrowseSentEventUnsubscribe;
```

constructor에 초기값을 둔다.

```typescript
constructor() {
  super();
  this.open = false;
  this.snapshot = undefined;
}
```

연결 생명주기를 추가한다.

```typescript
override connectedCallback(): void {
  super.connectedCallback();

  if (!this.engine || this.#unsubscribe) {
    return;
  }

  this.snapshot = this.engine.getSnapshot();
  this.#unsubscribe = this.engine.subscribe((snapshot) => {
    this.snapshot = snapshot;
  });
}

override disconnectedCallback(): void {
  this.#unsubscribe?.();
  this.#unsubscribe = undefined;
  super.disconnectedCallback();
}
```

#### 5-4. GREEN 검증과 커밋

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/ui/__tests__/mount.test.ts
pnpm --filter @browse-sent-event/core typecheck
pnpm lint
```

기대 결과:

- mount 테스트 통과.
- typecheck exit code `0`.
- lint `0 warnings`, `0 errors`.

커밋:

```bash
git add packages/core/src/ui/components/devtools-panel.ts packages/core/src/ui/__tests__/mount.test.ts
git commit -m "feat(core): 패널 엔진 구독 연결 추가"
```

---

### 작업 6: 연결 목록과 메트릭 렌더링

**파일:**
- 수정: `packages/core/src/ui/components/devtools-panel.ts`
- 수정: `packages/core/src/ui/view-model.ts`
- 수정: `packages/core/src/ui/__tests__/view-model.test.ts`

**사용자 가치:** 패널에서 현재 연결 수, 메시지 수, 바이트 합계, 연결별 메시지 수와 상태를 확인할 수 있다.

#### 6-1. 실패하는 selected connection view model 테스트 작성

`packages/core/src/ui/__tests__/view-model.test.ts`에 테스트를 추가한다.

```typescript
it("marks the selected connection", () => {
  const model = getPanelViewModel(snapshot, {
    selectedConnectionId: "conn-1",
  });

  expect(model.connections[0]).toEqual(expect.objectContaining({ selected: true }));
});
```

RED 실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/ui/__tests__/view-model.test.ts
```

기대 실패:

- `selected` 속성이 없어 실패한다.

#### 6-2. view model 확장

`BrowseSentEventConnectionViewModel`에 추가한다.

```typescript
readonly selected: boolean;
```

connection mapping에 추가한다.

```typescript
selected: connection.id === state.selectedConnectionId,
```

#### 6-3. 패널 상태 추가

`BrowseSentEventDevtoolsPanelElement`에 선택 상태를 추가한다.

```typescript
static override properties: PropertyDeclarations = {
  engine: { attribute: false },
  open: { type: Boolean, reflect: true },
  selectedConnectionId: { attribute: false },
  snapshot: { attribute: false },
};

declare selectedConnectionId?: string;
```

constructor에 초기값을 둔다.

```typescript
this.selectedConnectionId = undefined;
```

#### 6-4. 패널 렌더링 구현

`devtools-panel.ts`에 view model import를 추가한다.

```typescript
import { getPanelViewModel } from "../view-model.js";
```

`render()`에서 snapshot 기반 model을 만든다.

```typescript
const model = this.snapshot
  ? getPanelViewModel(this.snapshot, {
      selectedConnectionId: this.selectedConnectionId,
    })
  : undefined;
```

패널 내부를 metrics와 connection list 중심으로 바꾼다.

```typescript
return html`
  <section class="panel" aria-label="browse-sent-event DevTools">
    <header class="header">
      <strong>browse-sent-event</strong>
      <button type="button" @click=${() => this.#close()}>Close</button>
    </header>
    <main class="layout">
      <section class="metrics" aria-label="Metrics">
        <span>${model?.activeConnectionCount ?? 0} active</span>
        <span>${model?.totalMessageCount ?? 0} messages</span>
        <span>${model?.totalBytesLabel ?? "0 B"}</span>
      </section>
      <section class="connections" aria-label="Connections">
        ${model?.connections.map(
          (connection) => html`
            <button
              class="connection"
              type="button"
              ?aria-pressed=${connection.selected}
              @click=${() => {
                this.selectedConnectionId = connection.id;
              }}
            >
              <span>${connection.protocol}</span>
              <span>${connection.label}</span>
              <span>${connection.state}</span>
              <span>${connection.messageCount}</span>
            </button>
          `,
        )}
      </section>
    </main>
  </section>
`;
```

CSS는 DevTools 성격에 맞춰 고밀도, 낮은 장식, 명확한 구획을 유지한다.

- `.header`: 40px 내외, title/close 정렬.
- `.metrics`: 3열 compact summary.
- `.connections`: 세로 목록, overflow auto.
- `.connection`: grid columns로 protocol/url/state/count를 안정적으로 배치.

#### 6-5. GREEN 검증과 커밋

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/ui/__tests__/view-model.test.ts src/ui/__tests__/mount.test.ts
pnpm --filter @browse-sent-event/core typecheck
pnpm lint
```

기대 결과:

- view model 테스트 통과.
- mount 테스트 통과.
- typecheck exit code `0`.
- lint `0 warnings`, `0 errors`.

커밋:

```bash
git add packages/core/src/ui/components/devtools-panel.ts packages/core/src/ui/view-model.ts packages/core/src/ui/__tests__/view-model.test.ts
git commit -m "feat(core): 연결 목록 UI 추가"
```

---

## 검증 계획

### 작업별 검증

| 작업 | RED 확인 | GREEN 확인 | 추가 확인 |
| --- | --- | --- | --- |
| 작업 4 | hotkey 후 `open` attribute가 없어 실패 | mount 테스트 통과 | `unmount()` 후 listener 제거 코드 확인 |
| 작업 5 | `snapshot`이 없어 실패 | mount 테스트 통과 | unmount 후 snapshot reference가 유지되는지 확인 |
| 작업 6 | connection `selected`가 없어 실패 | view model + mount 테스트 통과 | closed Shadow DOM 직접 query를 피했는지 확인 |

### 배치 완료 검증

작업 4~6 커밋 후 다음 명령을 새로 실행한다.

```bash
pnpm --filter @browse-sent-event/core test -- src/ui/__tests__/mount.test.ts src/ui/__tests__/view-model.test.ts
pnpm --filter @browse-sent-event/core test -- src/runtime/__tests__/engine.test.ts
pnpm --filter @browse-sent-event/core typecheck
pnpm lint
pnpm format:check
git diff --check
git status --short
```

기대 결과:

- 모든 명령 exit code `0`.
- Vitest는 지정한 테스트 파일이 모두 pass.
- `pnpm lint`는 `0 warnings`, `0 errors`.
- `pnpm format:check`는 모든 파일 formatted.
- `git diff --check` 출력 없음.
- 커밋까지 완료했다면 `git status --short` 출력 없음.

### 실패 시 디버깅 기준

1. Lit class field shadowing 경고가 나오면 `declare` field와 constructor 초기화를 확인한다.
2. `isolatedDeclarations` 오류가 나오면 `static styles`, `static properties`의 명시 타입을 확인한다.
3. DOM global lint 오류가 나오면 테스트에서 `window/document` 직접 참조 대신 `globalThis.window/document`를 사용한다.
4. snapshot 테스트가 불안정하면 `await Reflect.get(element, "updateComplete")`로 Lit update 완료를 기다린다.
5. closed Shadow DOM 내부 검증이 필요해지면 단위 테스트를 억지로 늘리지 않고, 후속 Playwright fixture 계획으로 넘긴다.

### 완료 기준

- `cmd+shift+r`가 패널 `open` 상태를 토글한다.
- `unmount()`가 DOM element와 hotkey listener를 정리한다.
- 패널이 mount 시점의 engine snapshot을 받고, 이후 record/update 이벤트를 구독한다.
- `unmount()` 이후 engine 변경이 패널 snapshot에 반영되지 않는다.
- view model이 선택된 connection을 표시한다.
- 패널 render가 metrics와 connection list를 생성할 수 있다.
- 작업 4, 5, 6이 각각 별도 기능 커밋으로 남는다.

## 의식적 기술 부채

| 부채 | 지금 감수하는 이유 | 회수 시점 |
| --- | --- | --- |
| closed Shadow DOM 내부 화면을 단위 테스트로 직접 검증하지 않음 | 현재 단계는 mount 계약과 view model 정확성이 더 중요함 | Playwright fixture를 추가하는 UI 검증 배치 |
| hotkey parser는 `cmd+shift+r`만 지원 | 옵션 기본값 외 조합을 아직 요구하지 않음 | 사용자 지정 hotkey UX를 확장할 때 |
| 연결 목록 클릭의 시각 상태는 view model 중심으로 검증 | closed Shadow DOM 때문에 DOM 내부 assertion 비용이 큼 | 메시지 타임라인과 함께 브라우저 기반 검증을 붙일 때 |
