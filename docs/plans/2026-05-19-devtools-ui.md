# DevTools UI 구현 계획

> **Claude용:** 필수 하위 스킬: `superpowers:executing-plans`, `superpowers:test-driven-development`를 사용해 이 계획을 작업 단위로 실행한다.

**목표:** Phase 1 transport 수집 결과를 브라우저 안에서 확인할 수 있는 Shadow DOM 기반 DevTools 패널을 구현한다.

**아키텍처:** `BrowseSentEventEngine`에 구독 API를 추가하고, UI는 engine snapshot과 selector만 읽는다. `packages/core/src/ui/` 아래에 Lit Custom Element를 두되 decorator 없이 `static properties`를 사용해 현재 TS 설정을 유지한다. `installBrowseSentEvent()`는 개발 런타임 설치 시 패널을 mount하고, `uninstall()`에서 인터셉터와 UI를 함께 정리한다.

**기술 스택:** TypeScript 6, Lit 3, Custom Elements, closed Shadow DOM, Vitest 4.1.6, happy-dom, tsdown, pnpm workspace, Turborepo.

---

## 기준 문서

- PRD F2.1: Shadow DOM 플로팅 패널, 토글, 위치 기억.
- PRD F2.2: 연결 목록 뷰, URL/상태/업타임/msg/s 표시.
- PRD F2.3: 메시지 타임라인, 역순 정렬, 방향/timestamp/protocol/type/preview/size 표시, 상세 패널.
- PRD F2.4: 전체/연결별 집계 메트릭.
- PRD F4: payload 대소문자 무시 검색과 방향/프로토콜/연결 필터.
- PRD F5: JSONL/log export.
- ADR-018: Lit 3.x + Shadow DOM closed mode + Custom Elements.
- `.ai/contexts/phase-1-scope.md`: 남은 Phase 1 범위는 Shadow DOM 플로팅 패널, 연결 목록, 메시지 타임라인, 메트릭 UI.

## 설계 결정

1. UI 컴포넌트는 engine 내부 mutable state를 직접 보관하지 않고 `getPanelViewModel()` 결과를 렌더링한다.
2. engine은 `subscribe()`를 제공하고, connection/message/update/clear 시점에 snapshot 이벤트를 알린다.
3. Lit decorator는 쓰지 않는다. 현재 `tsconfig.base.json`에 decorator 설정이 없으므로 `static properties`로 시작한다.
4. Shadow DOM은 ADR대로 closed mode를 목표로 한다. 내부 DOM 직접 단위 테스트가 어려우므로 view model 테스트와 mount 계약 테스트를 중심으로 잡고, 실제 화면 품질은 후속 Playwright fixture에서 강화한다.
5. `panel.autoOpen` 기본값은 기존 옵션대로 `false` 유지한다. 닫힌 상태에서는 작은 토글 버튼만 노출한다.
6. 첫 UI는 “완성된 디자인 시스템”보다 “개발자가 수집된 메시지를 즉시 스캔하는 DevTools 패널”을 우선한다.
7. export는 브라우저 다운로드까지 구현하지 않고, Phase 1 첫 UI에서는 engine export 문자열을 `CustomEvent`로 방출한다. 실제 다운로드 UX는 다음 polish 작업에서 붙인다.

## 비범위

- 디자인 polish, 애니메이션, 드래그 리사이즈.
- Playwright 시각 회귀 테스트.
- 외부 DevTools 페이지 또는 dev server JSON API.
- React/Vue causality, DOM overlay.
- binary payload pretty viewer.
- 클립보드/파일 다운로드 권한 처리.

---

## 작업 1: Engine 구독 API 추가

**파일:**
- 수정: `packages/core/src/runtime/engine.ts`
- 수정: `packages/core/src/index.ts`
- 테스트: `packages/core/src/runtime/__tests__/engine.test.ts`

### 단계 1: 실패하는 테스트 작성

`packages/core/src/runtime/__tests__/engine.test.ts`에 다음 테스트를 추가한다.

```typescript
it("notifies subscribers when the snapshot changes", () => {
  const engine = createDevtoolsEngine({ capacity: 10 });
  const snapshots: unknown[] = [];
  const unsubscribe = engine.subscribe((snapshot) => {
    snapshots.push(snapshot);
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

  unsubscribe();
  engine.clear();

  expect(snapshots).toHaveLength(2);
  expect(snapshots[1]).toEqual(
    expect.objectContaining({
      connections: [expect.objectContaining({ id: connection.id })],
      messages: [expect.objectContaining({ payloadPreview: "hello" })],
    }),
  );
});
```

### 단계 2: RED 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/runtime/__tests__/engine.test.ts
```

기대 결과:

- `engine.subscribe is not a function` 또는 타입 오류로 실패한다.

### 단계 3: snapshot과 subscribe 구현

`packages/core/src/runtime/engine.ts`에 타입을 추가한다.

```typescript
export interface BrowseSentEventEngineSnapshot {
  readonly connections: readonly BrowseSentEventConnection[];
  readonly messages: readonly BrowseSentEventMessage[];
  readonly metrics: BrowseSentEventMetrics;
}

export type BrowseSentEventEngineSubscriber = (
  snapshot: BrowseSentEventEngineSnapshot,
) => void;

export type BrowseSentEventUnsubscribe = () => void;
```

`BrowseSentEventEngine` 인터페이스에 추가한다.

```typescript
getSnapshot(): BrowseSentEventEngineSnapshot;
subscribe(subscriber: BrowseSentEventEngineSubscriber): BrowseSentEventUnsubscribe;
```

`createDevtoolsEngine()` 내부에 subscriber set과 notify 함수를 추가한다.

```typescript
const subscribers = new Set<BrowseSentEventEngineSubscriber>();

function getSnapshot(): BrowseSentEventEngineSnapshot {
  return {
    connections: getConnections(),
    messages: getMessages(),
    metrics: getMetrics(),
  };
}

function notify(): void {
  const snapshot = getSnapshot();

  for (const subscriber of subscribers) {
    subscriber(snapshot);
  }
}

function subscribe(subscriber: BrowseSentEventEngineSubscriber): BrowseSentEventUnsubscribe {
  subscribers.add(subscriber);

  return () => {
    subscribers.delete(subscriber);
  };
}
```

`recordConnection`, `updateConnection`, `recordMessage`, `clear` 끝에서 `notify()`를 호출한다.

`packages/core/src/index.ts`에 새 타입을 export한다.

```typescript
export {
  type BrowseSentEventEngineSnapshot,
  type BrowseSentEventEngineSubscriber,
  type BrowseSentEventUnsubscribe,
} from "./runtime/engine.js";
```

### 단계 4: GREEN 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/runtime/__tests__/engine.test.ts
pnpm --filter @browse-sent-event/core typecheck
pnpm lint
```

기대 결과:

- engine 테스트가 통과한다.
- 타입 검사와 lint가 exit code `0`으로 끝난다.

### 단계 5: 커밋

```bash
git add packages/core/src/runtime/engine.ts packages/core/src/runtime/__tests__/engine.test.ts packages/core/src/index.ts
git commit -m "feat(core): 엔진 구독 API 추가"
```

---

## 작업 2: DevTools UI view model 추가

**파일:**
- 생성: `packages/core/src/ui/view-model.ts`
- 생성: `packages/core/src/ui/__tests__/view-model.test.ts`
- 생성: `packages/core/src/ui/format.ts`
- 생성: `packages/core/src/ui/__tests__/format.test.ts`

### 단계 1: 실패하는 format 테스트 작성

`packages/core/src/ui/__tests__/format.test.ts`를 생성한다.

```typescript
import { describe, expect, it } from "vitest";
import { formatByteSize, formatTimestamp } from "../format.js";

describe("ui format helpers", () => {
  it("formats byte sizes", () => {
    expect(formatByteSize(42)).toBe("42 B");
    expect(formatByteSize(1536)).toBe("1.5 KB");
  });

  it("formats timestamps as time with milliseconds", () => {
    expect(formatTimestamp(3_661_234)).toBe("01:01:01.234");
  });
});
```

### 단계 2: 실패하는 view model 테스트 작성

`packages/core/src/ui/__tests__/view-model.test.ts`를 생성한다.

```typescript
import { describe, expect, it } from "vitest";
import type { BrowseSentEventEngineSnapshot } from "../../runtime/engine.js";
import { getPanelViewModel } from "../view-model.js";

const snapshot: BrowseSentEventEngineSnapshot = {
  connections: [
    {
      id: "conn-1",
      protocol: "websocket",
      url: "wss://example.test/socket",
      state: "open",
      openedAt: 1_000,
      reconnectCount: 0,
      metadata: {},
    },
  ],
  messages: [
    {
      id: "msg-1",
      connectionId: "conn-1",
      timestamp: 2_000,
      direction: "in",
      protocol: "websocket",
      size: 5,
      payload: "hello",
      payloadPreview: "hello",
      metadata: {},
    },
    {
      id: "msg-2",
      connectionId: "conn-1",
      timestamp: 3_000,
      direction: "out",
      protocol: "websocket",
      size: 4,
      payload: "ping",
      payloadPreview: "ping",
      metadata: {},
    },
  ],
  metrics: {
    activeConnectionCount: 1,
    connectionCount: 1,
    droppedMessageCount: 0,
    incomingCount: 1,
    messageCount: 2,
    outgoingCount: 1,
    totalBytes: 9,
  },
};

describe("getPanelViewModel", () => {
  it("sorts messages newest first and applies filters", () => {
    const model = getPanelViewModel(snapshot, {
      direction: "out",
      query: "pin",
      selectedConnectionId: "conn-1",
    });

    expect(model.messages).toEqual([
      expect.objectContaining({
        id: "msg-2",
        directionLabel: "OUT",
        payloadPreview: "ping",
      }),
    ]);
    expect(model.connections[0]).toEqual(
      expect.objectContaining({
        id: "conn-1",
        label: "wss://example.test/socket",
      }),
    );
  });
});
```

### 단계 3: RED 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/ui/__tests__/format.test.ts src/ui/__tests__/view-model.test.ts
```

기대 결과:

- `../format.js` 또는 `../view-model.js`가 없어서 실패한다.

### 단계 4: format helper 구현

`packages/core/src/ui/format.ts`를 생성한다.

```typescript
export function formatByteSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }

  return `${(size / 1024).toFixed(1)} KB`;
}

export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getUTCHours().toString().padStart(2, "0");
  const minutes = date.getUTCMinutes().toString().padStart(2, "0");
  const seconds = date.getUTCSeconds().toString().padStart(2, "0");
  const milliseconds = date.getUTCMilliseconds().toString().padStart(3, "0");

  return `${hours}:${minutes}:${seconds}.${milliseconds}`;
}
```

### 단계 5: view model 구현

`packages/core/src/ui/view-model.ts`를 생성한다.

```typescript
import type {
  BrowseSentEventDirection,
  BrowseSentEventMessage,
} from "../runtime/events.js";
import type { BrowseSentEventEngineSnapshot } from "../runtime/engine.js";
import { formatByteSize, formatTimestamp } from "./format.js";

export interface BrowseSentEventPanelState {
  readonly selectedConnectionId?: string;
  readonly query?: string;
  readonly direction?: BrowseSentEventDirection;
}

export interface BrowseSentEventConnectionViewModel {
  readonly id: string;
  readonly label: string;
  readonly protocol: string;
  readonly state: string;
  readonly messageCount: number;
}

export interface BrowseSentEventMessageViewModel {
  readonly id: string;
  readonly direction: BrowseSentEventDirection;
  readonly directionLabel: "IN" | "OUT";
  readonly timestampLabel: string;
  readonly protocol: string;
  readonly typeLabel: string;
  readonly sizeLabel: string;
  readonly payloadPreview: string;
}

export interface BrowseSentEventPanelViewModel {
  readonly connections: readonly BrowseSentEventConnectionViewModel[];
  readonly messages: readonly BrowseSentEventMessageViewModel[];
  readonly activeConnectionCount: number;
  readonly totalMessageCount: number;
  readonly totalBytesLabel: string;
}

function matchesState(message: BrowseSentEventMessage, state: BrowseSentEventPanelState): boolean {
  if (state.selectedConnectionId && message.connectionId !== state.selectedConnectionId) {
    return false;
  }

  if (state.direction && message.direction !== state.direction) {
    return false;
  }

  if (state.query && !message.payloadPreview.toLowerCase().includes(state.query.toLowerCase())) {
    return false;
  }

  return true;
}

export function getPanelViewModel(
  snapshot: BrowseSentEventEngineSnapshot,
  state: BrowseSentEventPanelState = {},
): BrowseSentEventPanelViewModel {
  return {
    activeConnectionCount: snapshot.metrics.activeConnectionCount,
    totalMessageCount: snapshot.metrics.messageCount,
    totalBytesLabel: formatByteSize(snapshot.metrics.totalBytes),
    connections: snapshot.connections.map((connection) => ({
      id: connection.id,
      label: connection.url,
      protocol: connection.protocol,
      state: connection.state,
      messageCount: snapshot.messages.filter((message) => message.connectionId === connection.id)
        .length,
    })),
    messages: snapshot.messages
      .filter((message) => matchesState(message, state))
      .toSorted((left, right) => right.timestamp - left.timestamp)
      .map((message) => ({
        id: message.id,
        direction: message.direction,
        directionLabel: message.direction === "in" ? "IN" : "OUT",
        timestampLabel: formatTimestamp(message.timestamp),
        protocol: message.protocol,
        typeLabel: message.type ?? "message",
        sizeLabel: formatByteSize(message.size),
        payloadPreview: message.payloadPreview,
      })),
  };
}
```

### 단계 6: GREEN 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/ui/__tests__/format.test.ts src/ui/__tests__/view-model.test.ts
pnpm --filter @browse-sent-event/core typecheck
pnpm lint
```

기대 결과:

- UI format/view model 테스트가 통과한다.
- 타입 검사와 lint가 exit code `0`으로 끝난다.

### 단계 7: 커밋

```bash
git add packages/core/src/ui/format.ts packages/core/src/ui/view-model.ts packages/core/src/ui/__tests__/format.test.ts packages/core/src/ui/__tests__/view-model.test.ts
git commit -m "feat(core): DevTools UI view model 추가"
```

---

## 작업 3: Custom Element 등록과 mount API 추가

**파일:**
- 생성: `packages/core/src/ui/components/devtools-panel.ts`
- 생성: `packages/core/src/ui/register.ts`
- 생성: `packages/core/src/ui/mount.ts`
- 생성: `packages/core/src/ui/__tests__/mount.test.ts`
- 수정: `packages/core/src/index.ts`

### 단계 1: 실패하는 mount 테스트 작성

`packages/core/src/ui/__tests__/mount.test.ts`를 생성한다.

```typescript
import { afterEach, describe, expect, it } from "vitest";
import { createDevtoolsEngine } from "../../runtime/engine.js";
import { mountDevtoolsPanel } from "../mount.js";

describe("mountDevtoolsPanel", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("mounts a custom element host and unmounts it", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });
    const mounted = mountDevtoolsPanel({
      engine,
      options: {
        autoOpen: true,
        hotkey: "cmd+shift+r",
        position: "bottom-right",
      },
      target: window,
    });

    const panel = document.querySelector("bse-devtools-panel");

    expect(panel).not.toBeNull();
    expect(panel?.hasAttribute("open")).toBe(true);

    mounted.unmount();

    expect(document.querySelector("bse-devtools-panel")).toBeNull();
  });
});
```

### 단계 2: RED 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/ui/__tests__/mount.test.ts
```

기대 결과:

- `../mount.js`가 없어서 실패한다.

### 단계 3: 최소 panel element 구현

`packages/core/src/ui/components/devtools-panel.ts`를 생성한다.

```typescript
import { css, html, LitElement, type TemplateResult } from "lit";
import type { BrowseSentEventEngine } from "../../runtime/engine.js";

export class BrowseSentEventDevtoolsPanelElement extends LitElement {
  static override shadowRootOptions: ShadowRootInit = {
    ...LitElement.shadowRootOptions,
    mode: "closed",
  };

  static override styles = css`
    :host {
      all: initial;
      position: fixed;
      z-index: 2147483647;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #f8fafc;
    }

    :host([data-position="bottom-right"]) {
      right: 16px;
      bottom: 16px;
    }

    :host([data-position="bottom-left"]) {
      left: 16px;
      bottom: 16px;
    }

    :host([data-position="top-right"]) {
      top: 16px;
      right: 16px;
    }

    :host([data-position="top-left"]) {
      top: 16px;
      left: 16px;
    }

    .panel {
      width: 520px;
      max-width: calc(100vw - 32px);
      height: 420px;
      max-height: calc(100vh - 32px);
      border: 1px solid #334155;
      border-radius: 8px;
      background: #0f172a;
      box-shadow: 0 18px 56px rgba(15, 23, 42, 0.35);
      overflow: hidden;
    }

    .toggle {
      width: 44px;
      height: 44px;
      border: 1px solid #334155;
      border-radius: 999px;
      background: #0f172a;
      color: #f8fafc;
      cursor: pointer;
    }
  `;

  static override properties = {
    engine: { attribute: false },
    open: { type: Boolean, reflect: true },
  };

  engine?: BrowseSentEventEngine;
  open = false;

  override render(): TemplateResult {
    if (!this.open) {
      return html`<button class="toggle" type="button" @click=${this.#open}>BSE</button>`;
    }

    return html`
      <section class="panel" aria-label="browse-sent-event DevTools">
        <header>
          <strong>browse-sent-event</strong>
          <button type="button" @click=${this.#close}>Close</button>
        </header>
        <main>Waiting for realtime messages...</main>
      </section>
    `;
  }

  #open(): void {
    this.open = true;
  }

  #close(): void {
    this.open = false;
  }
}
```

### 단계 4: register와 mount 구현

`packages/core/src/ui/register.ts`를 생성한다.

```typescript
import { BrowseSentEventDevtoolsPanelElement } from "./components/devtools-panel.js";

export const devtoolsPanelTagName = "bse-devtools-panel";

export function registerDevtoolsElements(target: CustomElementRegistry = customElements): void {
  if (!target.get(devtoolsPanelTagName)) {
    target.define(devtoolsPanelTagName, BrowseSentEventDevtoolsPanelElement);
  }
}
```

`packages/core/src/ui/mount.ts`를 생성한다.

```typescript
import type { BrowseSentEventEngine } from "../runtime/engine.js";
import type { ResolvedBrowseSentEventOptions } from "../runtime/options.js";
import { devtoolsPanelTagName, registerDevtoolsElements } from "./register.js";

export interface MountedDevtoolsPanel {
  readonly element: HTMLElement;
  unmount(): void;
}

export interface MountDevtoolsPanelOptions {
  readonly engine: BrowseSentEventEngine;
  readonly options: ResolvedBrowseSentEventOptions["panel"];
  readonly target: Window & typeof globalThis;
}

export function mountDevtoolsPanel(options: MountDevtoolsPanelOptions): MountedDevtoolsPanel {
  registerDevtoolsElements(options.target.customElements);

  const element = options.target.document.createElement(devtoolsPanelTagName);

  Reflect.set(element, "engine", options.engine);
  Reflect.set(element, "open", options.options.autoOpen);
  element.setAttribute("data-position", options.options.position);

  if (options.options.autoOpen) {
    element.setAttribute("open", "");
  }

  options.target.document.body.append(element);

  return {
    element,
    unmount() {
      element.remove();
    },
  };
}
```

`packages/core/src/index.ts`에 mount 타입을 export한다.

```typescript
export {
  mountDevtoolsPanel,
  type MountedDevtoolsPanel,
  type MountDevtoolsPanelOptions,
} from "./ui/mount.js";
```

### 단계 5: GREEN 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/ui/__tests__/mount.test.ts
pnpm --filter @browse-sent-event/core typecheck
pnpm lint
```

기대 결과:

- mount 테스트가 통과한다.
- 타입 검사와 lint가 exit code `0`으로 끝난다.

### 단계 6: 커밋

```bash
git add packages/core/src/index.ts packages/core/src/ui/components/devtools-panel.ts packages/core/src/ui/register.ts packages/core/src/ui/mount.ts packages/core/src/ui/__tests__/mount.test.ts
git commit -m "feat(core): DevTools custom element 등록 추가"
```

---

## 작업 4: Floating panel shell과 hotkey 연결

**파일:**
- 수정: `packages/core/src/ui/components/devtools-panel.ts`
- 수정: `packages/core/src/ui/mount.ts`
- 수정: `packages/core/src/ui/__tests__/mount.test.ts`

### 단계 1: 실패하는 hotkey 테스트 작성

`packages/core/src/ui/__tests__/mount.test.ts`에 추가한다.

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
    target: window,
  });

  expect(mounted.element.hasAttribute("open")).toBe(false);

  window.dispatchEvent(
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

### 단계 2: RED 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/ui/__tests__/mount.test.ts
```

기대 결과:

- hotkey dispatch 후 `open` attribute가 없어 실패한다.

### 단계 3: panel open 상태 attribute 동기화

`devtools-panel.ts`의 open/close 메서드에서 attribute를 명시적으로 갱신한다.

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

`#open`, `#close`는 `this.setOpen(true/false)`를 호출한다.

### 단계 4: mount hotkey 구현

`mount.ts`에 hotkey matcher를 추가한다.

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

mount 내부에서 listener를 등록한다.

```typescript
const onKeyDown = (event: KeyboardEvent): void => {
  if (!matchesHotkey(event, options.options.hotkey)) {
    return;
  }

  event.preventDefault();
  const nextOpen = !element.hasAttribute("open");

  Reflect.get(element, "setOpen")?.call(element, nextOpen);
};

options.target.addEventListener("keydown", onKeyDown);
```

`unmount()`에서 listener를 제거한다.

### 단계 5: GREEN 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/ui/__tests__/mount.test.ts
pnpm --filter @browse-sent-event/core typecheck
pnpm lint
```

기대 결과:

- hotkey 테스트가 통과한다.
- 타입 검사와 lint가 exit code `0`으로 끝난다.

### 단계 6: 커밋

```bash
git add packages/core/src/ui/components/devtools-panel.ts packages/core/src/ui/mount.ts packages/core/src/ui/__tests__/mount.test.ts
git commit -m "feat(core): 플로팅 패널 shell 추가"
```

---

## 작업 5: 패널이 engine snapshot을 구독하도록 연결

**파일:**
- 수정: `packages/core/src/ui/components/devtools-panel.ts`
- 테스트: `packages/core/src/ui/__tests__/mount.test.ts`

### 단계 1: 실패하는 subscription 테스트 작성

`mount.test.ts`에 추가한다.

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
    target: window,
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

  await mounted.element.updateComplete;

  expect(Reflect.get(mounted.element, "snapshot")?.messages).toHaveLength(1);
});
```

### 단계 2: RED 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/ui/__tests__/mount.test.ts
```

기대 결과:

- `snapshot`이 갱신되지 않아 실패한다.

### 단계 3: panel subscription 구현

`devtools-panel.ts`에 snapshot state와 unsubscribe를 추가한다.

```typescript
import type {
  BrowseSentEventEngine,
  BrowseSentEventEngineSnapshot,
  BrowseSentEventUnsubscribe,
} from "../../runtime/engine.js";

snapshot?: BrowseSentEventEngineSnapshot;
#unsubscribe?: BrowseSentEventUnsubscribe;

override connectedCallback(): void {
  super.connectedCallback();

  if (this.engine) {
    this.snapshot = this.engine.getSnapshot();
    this.#unsubscribe = this.engine.subscribe((snapshot) => {
      this.snapshot = snapshot;
      this.requestUpdate();
    });
  }
}

override disconnectedCallback(): void {
  this.#unsubscribe?.();
  this.#unsubscribe = undefined;
  super.disconnectedCallback();
}
```

`static properties`에 `snapshot: { attribute: false }`를 추가한다.

### 단계 4: GREEN 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/ui/__tests__/mount.test.ts
pnpm --filter @browse-sent-event/core typecheck
pnpm lint
```

기대 결과:

- subscription 테스트가 통과한다.
- 타입 검사와 lint가 exit code `0`으로 끝난다.

### 단계 5: 커밋

```bash
git add packages/core/src/ui/components/devtools-panel.ts packages/core/src/ui/__tests__/mount.test.ts
git commit -m "feat(core): 패널 엔진 구독 연결 추가"
```

---

## 작업 6: 연결 목록과 메트릭 렌더링

**파일:**
- 수정: `packages/core/src/ui/components/devtools-panel.ts`
- 수정: `packages/core/src/ui/view-model.ts`
- 수정: `packages/core/src/ui/__tests__/view-model.test.ts`

### 단계 1: 실패하는 view model 테스트 작성

`view-model.test.ts`에 추가한다.

```typescript
it("marks the selected connection", () => {
  const model = getPanelViewModel(snapshot, {
    selectedConnectionId: "conn-1",
  });

  expect(model.connections[0]).toEqual(expect.objectContaining({ selected: true }));
});
```

### 단계 2: RED 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/ui/__tests__/view-model.test.ts
```

기대 결과:

- `selected` 속성이 없어 실패한다.

### 단계 3: view model 확장

`BrowseSentEventConnectionViewModel`에 추가한다.

```typescript
readonly selected: boolean;
```

connection mapping에 추가한다.

```typescript
selected: connection.id === state.selectedConnectionId,
```

### 단계 4: 패널 렌더링 구현

`devtools-panel.ts`의 `render()`에서 snapshot이 있으면 view model을 만들고 connection list와 metrics를 렌더링한다.

```typescript
import { getPanelViewModel, type BrowseSentEventPanelState } from "../view-model.js";

selectedConnectionId?: string;

// render 내부
const model = this.snapshot ? getPanelViewModel(this.snapshot, {
  selectedConnectionId: this.selectedConnectionId,
}) : undefined;
```

연결 목록 렌더링은 버튼을 사용한다.

```typescript
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
```

### 단계 5: GREEN 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/ui/__tests__/view-model.test.ts src/ui/__tests__/mount.test.ts
pnpm --filter @browse-sent-event/core typecheck
pnpm lint
```

기대 결과:

- view model과 mount 테스트가 통과한다.
- 타입 검사와 lint가 exit code `0`으로 끝난다.

### 단계 6: 커밋

```bash
git add packages/core/src/ui/components/devtools-panel.ts packages/core/src/ui/view-model.ts packages/core/src/ui/__tests__/view-model.test.ts
git commit -m "feat(core): 연결 목록 UI 추가"
```

---

## 작업 7: 메시지 타임라인과 상세 패널 렌더링

**파일:**
- 수정: `packages/core/src/ui/components/devtools-panel.ts`
- 수정: `packages/core/src/ui/view-model.ts`
- 수정: `packages/core/src/ui/__tests__/view-model.test.ts`

### 단계 1: 실패하는 view model 테스트 작성

`view-model.test.ts`에 추가한다.

```typescript
it("returns selected message detail", () => {
  const model = getPanelViewModel(snapshot, {
    selectedMessageId: "msg-1",
  });

  expect(model.selectedMessage).toEqual(
    expect.objectContaining({
      id: "msg-1",
      payloadPreview: "hello",
    }),
  );
});
```

### 단계 2: RED 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/ui/__tests__/view-model.test.ts
```

기대 결과:

- `selectedMessage`가 없어 실패한다.

### 단계 3: view model에 selected message 추가

`BrowseSentEventPanelState`에 추가한다.

```typescript
readonly selectedMessageId?: string;
```

`BrowseSentEventPanelViewModel`에 추가한다.

```typescript
readonly selectedMessage?: BrowseSentEventMessageViewModel;
```

model 생성 시 `selectedMessage`를 계산한다.

```typescript
const mappedMessages = ...;

return {
  ...,
  messages: mappedMessages,
  selectedMessage: mappedMessages.find((message) => message.id === state.selectedMessageId),
};
```

### 단계 4: 타임라인 UI 구현

`devtools-panel.ts`에 `selectedMessageId` state를 추가하고 message row 버튼을 렌더링한다.

```typescript
${model?.messages.map(
  (message) => html`
    <button
      class="message"
      type="button"
      data-direction=${message.direction}
      @click=${() => {
        this.selectedMessageId = message.id;
      }}
    >
      <span>${message.directionLabel}</span>
      <span>${message.timestampLabel}</span>
      <span>${message.protocol}</span>
      <span>${message.typeLabel}</span>
      <span>${message.payloadPreview}</span>
      <span>${message.sizeLabel}</span>
    </button>
  `,
)}
```

상세 패널에는 selected message가 있으면 preview/metadata를 보여준다.

### 단계 5: GREEN 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/ui/__tests__/view-model.test.ts src/ui/__tests__/mount.test.ts
pnpm --filter @browse-sent-event/core typecheck
pnpm lint
```

기대 결과:

- view model과 mount 테스트가 통과한다.
- 타입 검사와 lint가 exit code `0`으로 끝난다.

### 단계 6: 커밋

```bash
git add packages/core/src/ui/components/devtools-panel.ts packages/core/src/ui/view-model.ts packages/core/src/ui/__tests__/view-model.test.ts
git commit -m "feat(core): 메시지 타임라인 UI 추가"
```

---

## 작업 8: 검색, 방향 필터, export control 추가

**파일:**
- 수정: `packages/core/src/ui/components/devtools-panel.ts`
- 수정: `packages/core/src/ui/view-model.ts`
- 수정: `packages/core/src/ui/__tests__/view-model.test.ts`
- 수정: `packages/core/src/ui/__tests__/mount.test.ts`

### 단계 1: 실패하는 export 이벤트 테스트 작성

`mount.test.ts`에 추가한다.

```typescript
it("dispatches an export event with JSONL content", async () => {
  const engine = createDevtoolsEngine({ capacity: 10 });
  const mounted = mountDevtoolsPanel({
    engine,
    options: {
      autoOpen: true,
      hotkey: "cmd+shift+r",
      position: "bottom-right",
    },
    target: window,
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

  const exports: unknown[] = [];

  mounted.element.addEventListener("bse-export", (event) => {
    exports.push((event as CustomEvent).detail);
  });

  Reflect.get(mounted.element, "requestExport")?.call(mounted.element, "jsonl");

  expect(exports).toEqual([
    expect.objectContaining({
      format: "jsonl",
      content: expect.stringContaining("\"payload\":\"hello\""),
    }),
  ]);
});
```

### 단계 2: RED 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/ui/__tests__/mount.test.ts
```

기대 결과:

- `requestExport`가 없거나 이벤트가 발생하지 않아 실패한다.

### 단계 3: UI 상태와 export 구현

`devtools-panel.ts`에 상태를 추가한다.

```typescript
query = "";
direction?: "in" | "out";
```

`requestExport(format: "jsonl" | "log")` 메서드를 추가한다.

```typescript
requestExport(format: "jsonl" | "log"): void {
  if (!this.engine) {
    return;
  }

  const filter = {
    connectionId: this.selectedConnectionId,
    direction: this.direction,
  };
  const content = format === "jsonl" ? this.engine.exportJsonl(filter) : this.engine.exportLog(filter);

  this.dispatchEvent(
    new CustomEvent("bse-export", {
      bubbles: false,
      composed: false,
      detail: {
        content,
        format,
      },
    }),
  );
}
```

검색 input, 방향 버튼, export 버튼을 패널 toolbar에 렌더링한다.

### 단계 4: GREEN 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/ui/__tests__/view-model.test.ts src/ui/__tests__/mount.test.ts
pnpm --filter @browse-sent-event/core typecheck
pnpm lint
```

기대 결과:

- view model과 mount 테스트가 통과한다.
- 타입 검사와 lint가 exit code `0`으로 끝난다.

### 단계 5: 커밋

```bash
git add packages/core/src/ui/components/devtools-panel.ts packages/core/src/ui/view-model.ts packages/core/src/ui/__tests__/view-model.test.ts packages/core/src/ui/__tests__/mount.test.ts
git commit -m "feat(core): 타임라인 제어 UI 추가"
```

---

## 작업 9: runtime install에 panel mount 연결

**파일:**
- 수정: `packages/core/src/runtime/install.ts`
- 수정: `packages/core/src/runtime/__tests__/install.test.ts`

### 단계 1: 실패하는 테스트 작성

`packages/core/src/runtime/__tests__/install.test.ts`에 추가한다.

```typescript
it("mounts and unmounts the DevTools panel in a browser window", () => {
  const runtime = installBrowseSentEvent({
    panel: {
      autoOpen: true,
    },
  });

  expect(runtime.installed).toBe(true);
  expect(document.querySelector("bse-devtools-panel")).not.toBeNull();

  runtime.uninstall();

  expect(document.querySelector("bse-devtools-panel")).toBeNull();
});
```

### 단계 2: RED 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/runtime/__tests__/install.test.ts
```

기대 결과:

- panel element가 mount되지 않아 실패한다.

### 단계 3: runtime install에 mount 연결

`install.ts`에서 `resolveOptions`와 `mountDevtoolsPanel`을 사용한다.

```typescript
import { mountDevtoolsPanel, type MountedDevtoolsPanel } from "../ui/mount.js";
import { resolveOptions } from "./options.js";
```

runtime 생성 전에 resolved options를 만든다.

```typescript
const resolvedOptions = resolveOptions(options);
let mountedPanel: MountedDevtoolsPanel | undefined;
```

runtime 생성 뒤 panel을 mount한다.

```typescript
mountedPanel = mountDevtoolsPanel({
  engine: runtime.engine,
  options: resolvedOptions.panel,
  target,
});
```

`uninstall()`에 panel cleanup을 추가한다.

```typescript
mountedPanel?.unmount();
```

### 단계 4: GREEN 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/runtime/__tests__/install.test.ts src/ui/__tests__/mount.test.ts
pnpm --filter @browse-sent-event/core typecheck
pnpm lint
```

기대 결과:

- install/mount 테스트가 통과한다.
- 타입 검사와 lint가 exit code `0`으로 끝난다.

### 단계 5: 커밋

```bash
git add packages/core/src/runtime/install.ts packages/core/src/runtime/__tests__/install.test.ts
git commit -m "feat(core): runtime 패널 마운트 연결"
```

---

## 작업 10: 문서와 에이전트 컨텍스트 정리

**파일:**
- 수정: `README.md`
- 수정: `.ai/contexts/phase-1-scope.md`

### 단계 1: README 상태 갱신

`README.md`의 현재 구현 상태에 DevTools UI를 추가한다.

```markdown
- Shadow DOM DevTools 패널 MVP
- 연결 목록, 메시지 타임라인, 검색/방향 필터, export 이벤트
```

### 단계 2: `.ai/contexts/phase-1-scope.md` 갱신

구현됨에 추가한다.

```markdown
- Shadow DOM DevTools panel MVP
```

남음에는 polish와 성능 검증을 남긴다.

```markdown
- UI polish와 resize/position persistence
- Playwright 기반 실제 브라우저 UI 검증
- Phase 1 성능 기준 검증
```

### 단계 3: 문서 검증

실행:

```bash
pnpm format:check
git diff --check
```

기대 결과:

- format check가 exit code `0`.
- whitespace error가 없다.

### 단계 4: 커밋

```bash
git add README.md .ai/contexts/phase-1-scope.md
git commit -m "docs(core): DevTools UI 구현 범위 문서화"
```

---

## 작업 11: 최종 검증

### 단계 1: lockfile 검증

실행:

```bash
pnpm install --frozen-lockfile
```

기대 결과:

- exit code `0`.
- lockfile 변경 없음.
- Corepack `url.parse()` deprecation warning은 현재 알려진 외부 warning이므로 실패로 보지 않는다.

### 단계 2: 전체 테스트

실행:

```bash
pnpm test
pnpm exec turbo run test --force
```

기대 결과:

- 모든 package test가 통과한다.
- cache bypass 테스트도 exit code `0`.

### 단계 3: 타입 검사와 빌드

실행:

```bash
pnpm exec turbo run typecheck --force
pnpm exec turbo run build --force
```

기대 결과:

- 모든 package typecheck가 통과한다.
- core와 plugin-vite build가 통과한다.

### 단계 4: lint/format/diff 검사

실행:

```bash
pnpm lint
pnpm format:check
git diff --check
```

기대 결과:

- lint warning/error 0개.
- format check 통과.
- whitespace error 없음.

### 단계 5: 산출물 확인

실행:

```bash
ls -l packages/core/dist/index.mjs packages/core/dist/index.d.mts packages/plugin-vite/dist/index.mjs packages/plugin-vite/dist/index.d.mts
```

기대 결과:

- 네 파일이 모두 존재한다.

### 단계 6: 최종 상태 확인

실행:

```bash
git status --short
```

기대 결과:

- 출력이 비어 있다.

## 의식적 기술 부채

| 부채 | 지금 포기하는 것 | 지금 감당 가능한 이유 | 회수 시점 |
| --- | --- | --- | --- |
| closed Shadow DOM 내부 렌더링 단위 테스트 제한 | 컴포넌트 내부 DOM의 세밀한 unit assertion | ADR-018 격리 요구가 우선이며, view model 테스트로 핵심 변환을 검증 가능 | Playwright fixture를 추가할 때 |
| drag resize 미구현 | 패널 크기 조절 UX | 첫 데모는 메시지 표시가 핵심이고, 고정 크기 패널로 충분히 검증 가능 | UI polish 작업 |
| localStorage 위치 기억 최소화 | 드래그 위치 저장 | drag resize/drag move가 없으므로 위치 옵션만 사용 | drag/move 구현 시 |
| export 다운로드 미구현 | 파일 저장 UX | engine export와 UI 이벤트 연결만으로 기능 경계를 검증 가능 | export UX polish 작업 |
| Shadow DOM 화면 품질 수동 확인 | 자동 screenshot 회귀 | 이번 계획은 core package 단위 MVP이며, browser fixture는 별도 계획으로 분리하는 편이 안전 | DevTools UI polish 또는 demo fixture 계획 |

## 완료 기준

- `installBrowseSentEvent()` 호출 후 `bse-devtools-panel`이 mount된다.
- `panel.autoOpen`과 hotkey로 패널을 열고 닫을 수 있다.
- engine에 기록된 connection/message가 UI view model과 패널에 연결된다.
- 검색, 방향 필터, export 이벤트가 최소 동작한다.
- 모든 변경은 기능 단위 커밋으로 분리되어 있다.
