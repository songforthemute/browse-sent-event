# Protocol Interceptors 구현 계획

> **Claude용:** 필수 하위 스킬: `superpowers:executing-plans`, `superpowers:test-driven-development`를 사용해 이 계획을 작업 단위로 실행한다.

**목표:** Phase 1의 WebSocket, fetch ReadableStream, EventSource 활동을 `packages/core` 런타임에서 수집하고, UI 없이도 테스트와 export API로 검증 가능한 이벤트 수집 기반을 만든다.

**아키텍처:** `installBrowseSentEvent()`는 명시적으로 호출될 때만 브라우저 전역 transport를 Proxy로 감싼다. 인터셉터는 transport별 파일에 격리하고, 모든 이벤트는 `DevtoolsEngine` 경계로만 기록한다. 엔진은 고정 용량 링 버퍼, connection registry, 단순 검색/export API를 제공하며, 이후 Lit UI는 이 엔진 API만 읽는다.

**기술 스택:** TypeScript 6, Vitest 4.1.6, happy-dom, tsdown, pnpm workspace, Turborepo, Vite 8 주입 경로.

---

## 기준 문서

- PRD F1.1: `window.WebSocket` Proxy 래핑, 연결/상태/메시지 메타데이터 캡처.
- PRD F1.2: `window.fetch` 래핑, `ReadableStream` response chunk 캡처, `text/event-stream` SSE 분류.
- PRD F1.3: `window.EventSource` Proxy 래핑, `Last-Event-ID`, event type 캡처.
- PRD F3: 기본 10,000개 고정 용량 링 버퍼.
- PRD F4: payload 대소문자 무시 부분 문자열 검색과 구조적 필터.
- PRD F5: JSONL export와 grep 친화 log export.
- ADR-007: `sideEffects: false` 유지. 단순 import는 patch를 실행하지 않고, 명시적 install만 patch한다.
- ADR-016: Oxlint + oxlint-tsgolint + Oxfmt.
- `.ai/contexts/phase-1-scope.md`: Phase 1은 Vite 전용, main thread 전용.

## 설계 결정

1. 인터셉터는 직접 storage를 만지지 않고 `BrowseSentEventEngine` API만 호출한다.
2. `installBrowseSentEvent()`는 같은 window에서 한 번만 설치하고, 재호출 시 기존 runtime을 반환한다.
3. `uninstall()`은 테스트와 개발 중 재설치를 위해 원본 전역 API를 복구한다.
4. payload preview는 Phase 1에서 100자 문자열로 제한한다.
5. binary payload는 원본 `ArrayBuffer`와 byte size를 보존하고, preview는 `[binary N bytes]` 형식으로 둔다.
6. fetch stream은 앱 소비 경로를 보존하기 위해 `response.clone().body`를 비동기 tap한다.
7. `Content-Type: text/event-stream`인 fetch stream은 protocol을 `eventsource`, metadata source를 `fetch`로 기록한다.
8. native `EventSource`는 raw stream을 노출하지 않으므로 `retry` 값은 Phase 1 native 인터셉터에서 캡처하지 않는다. 이 부채는 문서화하고, fetch SSE parser 또는 별도 SSE parser 도입 시 회수한다.

## 비범위

- DevTools UI 렌더링.
- Worker 내부 WebSocket/fetch/EventSource.
- React/Vue causality, Zustand/Pinia middleware.
- DOM overlay, Message Lifecycle Detection.
- Dev server JSON API.
- IndexedDB cold storage.
- binary payload base64 export.
- native EventSource `retry` 값 완전 캡처.

## 작업 1: Transport 이벤트 타입과 payload helper 추가

**파일:**
- 생성: `packages/core/src/runtime/events.ts`
- 생성: `packages/core/src/runtime/payload.ts`
- 생성: `packages/core/src/runtime/__tests__/payload.test.ts`
- 수정: `packages/core/src/index.ts`

### 단계 1: 실패하는 payload 테스트 작성

`packages/core/src/runtime/__tests__/payload.test.ts`를 생성한다.

```typescript
import { describe, expect, it } from "vitest";
import { createPayloadSummary, serializePayloadForExport } from "../payload.js";

describe("payload helpers", () => {
  it("summarizes text payloads with byte size and a 100 character preview", () => {
    const payload = "a".repeat(120);

    expect(createPayloadSummary(payload)).toEqual({
      payload,
      payloadPreview: "a".repeat(100),
      size: 120,
    });
  });

  it("summarizes ArrayBuffer payloads without stringifying binary data", () => {
    const payload = new Uint8Array([1, 2, 3]).buffer;

    expect(createPayloadSummary(payload)).toEqual({
      payload,
      payloadPreview: "[binary 3 bytes]",
      size: 3,
    });
  });

  it("serializes binary payloads for JSONL export", () => {
    const payload = new Uint8Array([1, 2, 3]).buffer;

    expect(serializePayloadForExport(payload)).toEqual({
      type: "array-buffer",
      byteLength: 3,
    });
  });
});
```

### 단계 2: RED 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/runtime/__tests__/payload.test.ts
```

기대 결과:

- 실패한다.
- 실패 이유에 `../payload.js`가 없다는 내용이 포함된다.

### 단계 3: 이벤트 타입과 payload helper 구현

`packages/core/src/runtime/events.ts`를 생성한다.

```typescript
export type BrowseSentEventProtocol = "websocket" | "fetch-stream" | "eventsource";
export type BrowseSentEventDirection = "in" | "out";
export type BrowseSentEventConnectionState = "connecting" | "open" | "closing" | "closed";
export type BrowseSentEventPayload = string | ArrayBuffer;

export interface BrowseSentEventMessage {
  readonly id: string;
  readonly connectionId: string;
  readonly timestamp: number;
  readonly direction: BrowseSentEventDirection;
  readonly protocol: BrowseSentEventProtocol;
  readonly type?: string;
  readonly size: number;
  readonly payload: BrowseSentEventPayload;
  readonly payloadPreview: string;
  readonly metadata: Record<string, unknown>;
}

export interface BrowseSentEventConnection {
  readonly id: string;
  readonly protocol: BrowseSentEventProtocol;
  readonly url: string;
  readonly state: BrowseSentEventConnectionState;
  readonly openedAt: number;
  readonly closedAt?: number;
  readonly closeCode?: number;
  readonly reconnectCount: number;
  readonly metadata: Record<string, unknown>;
}

export interface BrowseSentEventMessageFilter {
  readonly connectionId?: string;
  readonly protocol?: BrowseSentEventProtocol;
  readonly direction?: BrowseSentEventDirection;
  readonly urlIncludes?: string;
  readonly fromTimestamp?: number;
  readonly toTimestamp?: number;
}

export interface BrowseSentEventSearchQuery extends BrowseSentEventMessageFilter {
  readonly text?: string;
}

export interface BrowseSentEventMetrics {
  readonly activeConnectionCount: number;
  readonly connectionCount: number;
  readonly messageCount: number;
  readonly incomingCount: number;
  readonly outgoingCount: number;
  readonly droppedMessageCount: number;
  readonly totalBytes: number;
}
```

`packages/core/src/runtime/payload.ts`를 생성한다.

```typescript
import type { BrowseSentEventPayload } from "./events.js";

export interface BrowseSentEventPayloadSummary {
  readonly payload: BrowseSentEventPayload;
  readonly payloadPreview: string;
  readonly size: number;
}

export interface SerializedArrayBufferPayload {
  readonly type: "array-buffer";
  readonly byteLength: number;
}

const textEncoder = new TextEncoder();
const previewLength = 100;

export function createPayloadSummary(payload: BrowseSentEventPayload): BrowseSentEventPayloadSummary {
  if (typeof payload === "string") {
    return {
      payload,
      payloadPreview: payload.slice(0, previewLength),
      size: textEncoder.encode(payload).byteLength,
    };
  }

  return {
    payload,
    payloadPreview: `[binary ${payload.byteLength} bytes]`,
    size: payload.byteLength,
  };
}

export function serializePayloadForExport(
  payload: BrowseSentEventPayload,
): string | SerializedArrayBufferPayload {
  if (typeof payload === "string") {
    return payload;
  }

  return {
    type: "array-buffer",
    byteLength: payload.byteLength,
  };
}
```

`packages/core/src/index.ts`에 export를 추가한다.

```typescript
export type {
  BrowseSentEventConnection,
  BrowseSentEventConnectionState,
  BrowseSentEventDirection,
  BrowseSentEventMessage,
  BrowseSentEventMessageFilter,
  BrowseSentEventMetrics,
  BrowseSentEventPayload,
  BrowseSentEventProtocol,
  BrowseSentEventSearchQuery,
} from "./runtime/events.js";
```

### 단계 4: GREEN 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/runtime/__tests__/payload.test.ts
pnpm --filter @browse-sent-event/core typecheck
```

기대 결과:

- payload 테스트가 통과한다.
- 타입 검사가 exit code `0`으로 끝난다.

### 단계 5: 커밋

```bash
git add packages/core/src/index.ts packages/core/src/runtime/events.ts packages/core/src/runtime/payload.ts packages/core/src/runtime/__tests__/payload.test.ts
git commit -m "feat(core): transport 이벤트 타입 추가"
```

---

## 작업 2: 고정 용량 RingBuffer 추가

**파일:**
- 생성: `packages/core/src/runtime/ring-buffer.ts`
- 생성: `packages/core/src/runtime/__tests__/ring-buffer.test.ts`

### 단계 1: 실패하는 테스트 작성

`packages/core/src/runtime/__tests__/ring-buffer.test.ts`를 생성한다.

```typescript
import { describe, expect, it } from "vitest";
import { RingBuffer } from "../ring-buffer.js";

describe("RingBuffer", () => {
  it("keeps items in insertion order", () => {
    const buffer = new RingBuffer<number>(3);

    buffer.push(1);
    buffer.push(2);

    expect(buffer.toArray()).toEqual([1, 2]);
    expect(buffer.length).toBe(2);
  });

  it("drops the oldest item when capacity is exceeded", () => {
    const buffer = new RingBuffer<number>(2);

    buffer.push(1);
    buffer.push(2);
    buffer.push(3);

    expect(buffer.toArray()).toEqual([2, 3]);
    expect(buffer.droppedCount).toBe(1);
  });

  it("clears stored items and drop count", () => {
    const buffer = new RingBuffer<number>(1);

    buffer.push(1);
    buffer.push(2);
    buffer.clear();

    expect(buffer.toArray()).toEqual([]);
    expect(buffer.length).toBe(0);
    expect(buffer.droppedCount).toBe(0);
  });
});
```

### 단계 2: RED 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/runtime/__tests__/ring-buffer.test.ts
```

기대 결과:

- 실패한다.
- 실패 이유에 `../ring-buffer.js`가 없다는 내용이 포함된다.

### 단계 3: RingBuffer 구현

`packages/core/src/runtime/ring-buffer.ts`를 생성한다.

```typescript
export class RingBuffer<T> {
  readonly #items: (T | undefined)[];
  #start = 0;
  #length = 0;
  #droppedCount = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("RingBuffer capacity must be a positive integer.");
    }

    this.#items = new Array<T | undefined>(capacity);
  }

  get length(): number {
    return this.#length;
  }

  get droppedCount(): number {
    return this.#droppedCount;
  }

  push(item: T): void {
    if (this.#length < this.capacity) {
      this.#items[(this.#start + this.#length) % this.capacity] = item;
      this.#length += 1;
      return;
    }

    this.#items[this.#start] = item;
    this.#start = (this.#start + 1) % this.capacity;
    this.#droppedCount += 1;
  }

  toArray(): T[] {
    const result: T[] = [];

    for (let index = 0; index < this.#length; index += 1) {
      const item = this.#items[(this.#start + index) % this.capacity];

      if (item !== undefined) {
        result.push(item);
      }
    }

    return result;
  }

  clear(): void {
    this.#items.fill(undefined);
    this.#start = 0;
    this.#length = 0;
    this.#droppedCount = 0;
  }
}
```

### 단계 4: GREEN 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/runtime/__tests__/ring-buffer.test.ts
pnpm --filter @browse-sent-event/core typecheck
```

기대 결과:

- RingBuffer 테스트가 통과한다.
- 타입 검사가 exit code `0`으로 끝난다.

### 단계 5: 커밋

```bash
git add packages/core/src/runtime/ring-buffer.ts packages/core/src/runtime/__tests__/ring-buffer.test.ts
git commit -m "feat(core): 메시지 링 버퍼 추가"
```

---

## 작업 3: DevtoolsEngine 추가

**파일:**
- 생성: `packages/core/src/runtime/engine.ts`
- 생성: `packages/core/src/runtime/__tests__/engine.test.ts`
- 수정: `packages/core/src/index.ts`

### 단계 1: 실패하는 테스트 작성

`packages/core/src/runtime/__tests__/engine.test.ts`를 생성한다.

```typescript
import { describe, expect, it } from "vitest";
import { createDevtoolsEngine } from "../engine.js";

describe("createDevtoolsEngine", () => {
  it("records connections and messages", () => {
    const engine = createDevtoolsEngine({ capacity: 2 });
    const connection = engine.recordConnection({
      protocol: "websocket",
      url: "wss://example.test/socket",
    });

    const message = engine.recordMessage({
      connectionId: connection.id,
      direction: "in",
      protocol: "websocket",
      payload: "hello",
    });

    expect(engine.getConnections()).toEqual([
      expect.objectContaining({
        id: connection.id,
        protocol: "websocket",
        state: "connecting",
        url: "wss://example.test/socket",
      }),
    ]);
    expect(engine.getMessages()).toEqual([
      expect.objectContaining({
        id: message.id,
        connectionId: connection.id,
        payloadPreview: "hello",
        size: 5,
      }),
    ]);
  });

  it("filters, searches, and exports messages", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });
    const connection = engine.recordConnection({
      protocol: "fetch-stream",
      url: "https://example.test/stream",
    });

    engine.recordMessage({
      connectionId: connection.id,
      direction: "in",
      protocol: "fetch-stream",
      payload: "First Token",
    });

    expect(engine.search({ text: "token" })).toHaveLength(1);
    expect(engine.exportJsonl()).toContain("\"payload\":\"First Token\"");
    expect(engine.exportLog()).toContain("IN [fetch-stream]");
  });

  it("reports metrics and dropped messages", () => {
    const engine = createDevtoolsEngine({ capacity: 1 });
    const connection = engine.recordConnection({
      protocol: "websocket",
      url: "wss://example.test/socket",
    });

    engine.recordMessage({
      connectionId: connection.id,
      direction: "in",
      protocol: "websocket",
      payload: "one",
    });
    engine.recordMessage({
      connectionId: connection.id,
      direction: "out",
      protocol: "websocket",
      payload: "two",
    });

    expect(engine.getMessages()).toHaveLength(1);
    expect(engine.getMetrics()).toEqual(
      expect.objectContaining({
        droppedMessageCount: 1,
        incomingCount: 0,
        messageCount: 1,
        outgoingCount: 1,
      }),
    );
  });
});
```

### 단계 2: RED 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/runtime/__tests__/engine.test.ts
```

기대 결과:

- 실패한다.
- 실패 이유에 `../engine.js`가 없다는 내용이 포함된다.

### 단계 3: 엔진 구현

`packages/core/src/runtime/engine.ts`를 생성한다.

```typescript
import type {
  BrowseSentEventConnection,
  BrowseSentEventConnectionState,
  BrowseSentEventMessage,
  BrowseSentEventMessageFilter,
  BrowseSentEventMetrics,
  BrowseSentEventPayload,
  BrowseSentEventProtocol,
  BrowseSentEventSearchQuery,
} from "./events.js";
import { createPayloadSummary, serializePayloadForExport } from "./payload.js";
import { RingBuffer } from "./ring-buffer.js";

export interface BrowseSentEventEngineOptions {
  readonly capacity: number;
}

export interface BrowseSentEventConnectionInput {
  readonly protocol: BrowseSentEventProtocol;
  readonly url: string;
  readonly state?: BrowseSentEventConnectionState;
  readonly openedAt?: number;
  readonly metadata?: Record<string, unknown>;
}

export interface BrowseSentEventConnectionPatch {
  readonly state?: BrowseSentEventConnectionState;
  readonly closedAt?: number;
  readonly closeCode?: number;
  readonly metadata?: Record<string, unknown>;
}

export interface BrowseSentEventMessageInput {
  readonly connectionId: string;
  readonly direction: "in" | "out";
  readonly protocol: BrowseSentEventProtocol;
  readonly payload: BrowseSentEventPayload;
  readonly type?: string;
  readonly timestamp?: number;
  readonly metadata?: Record<string, unknown>;
}

export interface BrowseSentEventEngine {
  readonly capacity: number;
  recordConnection(input: BrowseSentEventConnectionInput): BrowseSentEventConnection;
  updateConnection(id: string, patch: BrowseSentEventConnectionPatch): BrowseSentEventConnection | undefined;
  recordMessage(input: BrowseSentEventMessageInput): BrowseSentEventMessage;
  getConnections(): BrowseSentEventConnection[];
  getMessages(filter?: BrowseSentEventMessageFilter): BrowseSentEventMessage[];
  getMetrics(connectionId?: string): BrowseSentEventMetrics;
  search(query: BrowseSentEventSearchQuery): BrowseSentEventMessage[];
  exportJsonl(filter?: BrowseSentEventMessageFilter): string;
  exportLog(filter?: BrowseSentEventMessageFilter): string;
  clear(): void;
}

let sequence = 0;

function now(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function createId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

function formatDirection(direction: "in" | "out"): string {
  return direction === "in" ? "IN" : "OUT";
}

export function createDevtoolsEngine(options: BrowseSentEventEngineOptions): BrowseSentEventEngine {
  const messages = new RingBuffer<BrowseSentEventMessage>(options.capacity);
  const connections = new Map<string, BrowseSentEventConnection>();

  function getConnectionForMessage(message: BrowseSentEventMessage): BrowseSentEventConnection | undefined {
    return connections.get(message.connectionId);
  }

  function matchesFilter(message: BrowseSentEventMessage, filter: BrowseSentEventMessageFilter = {}): boolean {
    const connection = getConnectionForMessage(message);

    if (filter.connectionId && message.connectionId !== filter.connectionId) {
      return false;
    }

    if (filter.protocol && message.protocol !== filter.protocol) {
      return false;
    }

    if (filter.direction && message.direction !== filter.direction) {
      return false;
    }

    if (filter.urlIncludes && !connection?.url.includes(filter.urlIncludes)) {
      return false;
    }

    if (filter.fromTimestamp !== undefined && message.timestamp < filter.fromTimestamp) {
      return false;
    }

    if (filter.toTimestamp !== undefined && message.timestamp > filter.toTimestamp) {
      return false;
    }

    return true;
  }

  return {
    capacity: options.capacity,

    recordConnection(input) {
      const previousReconnects = [...connections.values()].filter(
        (connection) =>
          connection.protocol === input.protocol &&
          connection.url === input.url &&
          connection.state === "closed",
      ).length;
      const connection: BrowseSentEventConnection = {
        id: createId("conn"),
        protocol: input.protocol,
        url: input.url,
        state: input.state ?? "connecting",
        openedAt: input.openedAt ?? now(),
        reconnectCount: previousReconnects,
        metadata: input.metadata ?? {},
      };

      connections.set(connection.id, connection);

      return connection;
    },

    updateConnection(id, patch) {
      const current = connections.get(id);

      if (!current) {
        return undefined;
      }

      const next: BrowseSentEventConnection = {
        ...current,
        ...patch,
        metadata: {
          ...current.metadata,
          ...patch.metadata,
        },
      };

      connections.set(id, next);

      return next;
    },

    recordMessage(input) {
      const summary = createPayloadSummary(input.payload);
      const message: BrowseSentEventMessage = {
        id: createId("msg"),
        connectionId: input.connectionId,
        timestamp: input.timestamp ?? now(),
        direction: input.direction,
        protocol: input.protocol,
        type: input.type,
        size: summary.size,
        payload: summary.payload,
        payloadPreview: summary.payloadPreview,
        metadata: input.metadata ?? {},
      };

      messages.push(message);

      return message;
    },

    getConnections() {
      return [...connections.values()];
    },

    getMessages(filter) {
      return messages.toArray().filter((message) => matchesFilter(message, filter));
    },

    getMetrics(connectionId) {
      const selectedMessages = this.getMessages(connectionId ? { connectionId } : undefined);
      const selectedConnections = connectionId
        ? this.getConnections().filter((connection) => connection.id === connectionId)
        : this.getConnections();

      return {
        activeConnectionCount: selectedConnections.filter((connection) => connection.state !== "closed").length,
        connectionCount: selectedConnections.length,
        messageCount: selectedMessages.length,
        incomingCount: selectedMessages.filter((message) => message.direction === "in").length,
        outgoingCount: selectedMessages.filter((message) => message.direction === "out").length,
        droppedMessageCount: messages.droppedCount,
        totalBytes: selectedMessages.reduce((total, message) => total + message.size, 0),
      };
    },

    search(query) {
      const normalizedText = query.text?.toLowerCase();

      return this.getMessages(query).filter((message) => {
        if (!normalizedText) {
          return true;
        }

        const payloadText = typeof message.payload === "string" ? message.payload : message.payloadPreview;

        return payloadText.toLowerCase().includes(normalizedText);
      });
    },

    exportJsonl(filter) {
      return this.getMessages(filter)
        .map((message) =>
          JSON.stringify({
            ...message,
            payload: serializePayloadForExport(message.payload),
          }),
        )
        .join("\n");
    },

    exportLog(filter) {
      return this.getMessages(filter)
        .map((message) => {
          const timestamp = message.timestamp.toFixed(3);

          return `${timestamp} ${formatDirection(message.direction)} [${message.protocol}] ${message.type ?? "message"} - ${message.payloadPreview}`;
        })
        .join("\n");
    },

    clear() {
      messages.clear();
      connections.clear();
    },
  };
}
```

`packages/core/src/index.ts`에 export를 추가한다.

```typescript
export {
  createDevtoolsEngine,
  type BrowseSentEventConnectionInput,
  type BrowseSentEventConnectionPatch,
  type BrowseSentEventEngine,
  type BrowseSentEventEngineOptions,
  type BrowseSentEventMessageInput,
} from "./runtime/engine.js";
```

### 단계 4: GREEN 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/runtime/__tests__/engine.test.ts
pnpm --filter @browse-sent-event/core typecheck
```

기대 결과:

- 엔진 테스트가 통과한다.
- 타입 검사가 exit code `0`으로 끝난다.

### 단계 5: 커밋

```bash
git add packages/core/src/index.ts packages/core/src/runtime/engine.ts packages/core/src/runtime/__tests__/engine.test.ts
git commit -m "feat(core): 이벤트 수집 엔진 추가"
```

---

## 작업 4: runtime과 engine 연결

**파일:**
- 수정: `packages/core/src/runtime/create-engine.ts`
- 수정: `packages/core/src/runtime/install.ts`
- 수정: `packages/core/src/runtime/__tests__/create-engine.test.ts`
- 수정: `packages/core/src/runtime/__tests__/install.test.ts`

### 단계 1: 실패하는 테스트 작성

`packages/core/src/runtime/__tests__/create-engine.test.ts`에 engine 검증을 추가한다.

```typescript
it("creates a devtools engine with the resolved capacity", () => {
  const runtime = createBrowseSentEventRuntime({ capacity: 128 });

  expect(runtime.engine.capacity).toBe(128);
  expect(runtime.engine.getMessages()).toEqual([]);
});
```

`packages/core/src/runtime/__tests__/install.test.ts`에 uninstall 검증을 추가한다.

```typescript
it("removes the installed runtime when uninstalled", () => {
  const runtime = installBrowseSentEvent();

  runtime.uninstall();

  const next = installBrowseSentEvent();

  expect(next).not.toBe(runtime);
});
```

### 단계 2: RED 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/runtime/__tests__/create-engine.test.ts src/runtime/__tests__/install.test.ts
```

기대 결과:

- 실패한다.
- 실패 이유에 `engine` 또는 `uninstall` 속성이 없다는 내용이 포함된다.

### 단계 3: runtime 구조 확장

`packages/core/src/runtime/create-engine.ts`를 수정한다.

```typescript
import { createDevtoolsEngine, type BrowseSentEventEngine } from "./engine.js";
import { resolveOptions, type BrowseSentEventOptions } from "./options.js";

export interface BrowseSentEventRuntime {
  readonly capacity: number;
  readonly engine: BrowseSentEventEngine;
  readonly installed: boolean;
  uninstall(): void;
}

export interface BrowseSentEventRuntimeFactoryOptions {
  readonly installed?: boolean;
  readonly uninstall?: () => void;
}

export function createBrowseSentEventRuntime(
  options?: BrowseSentEventOptions,
  factoryOptions: BrowseSentEventRuntimeFactoryOptions = {},
): BrowseSentEventRuntime {
  const resolved = resolveOptions(options);

  return {
    capacity: resolved.capacity,
    engine: createDevtoolsEngine({ capacity: resolved.capacity }),
    installed: factoryOptions.installed ?? false,
    uninstall: factoryOptions.uninstall ?? (() => undefined),
  };
}
```

`packages/core/src/runtime/install.ts`에서 runtime key 제거를 `uninstall()`에 연결한다.

```typescript
const runtime: BrowseSentEventRuntime = createBrowseSentEventRuntime(options, {
  installed: true,
  uninstall() {
    Reflect.deleteProperty(target, runtimeKey);
  },
});
```

### 단계 4: GREEN 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/runtime/__tests__/create-engine.test.ts src/runtime/__tests__/install.test.ts
pnpm --filter @browse-sent-event/core typecheck
```

기대 결과:

- runtime 테스트가 통과한다.
- 타입 검사가 exit code `0`으로 끝난다.

### 단계 5: 커밋

```bash
git add packages/core/src/runtime/create-engine.ts packages/core/src/runtime/install.ts packages/core/src/runtime/__tests__/create-engine.test.ts packages/core/src/runtime/__tests__/install.test.ts
git commit -m "feat(core): runtime 엔진 연결 추가"
```

---

## 작업 5: WebSocket 인터셉터 추가

**파일:**
- 생성: `packages/core/src/interceptors/types.ts`
- 생성: `packages/core/src/interceptors/websocket.ts`
- 생성: `packages/core/src/interceptors/__tests__/websocket.test.ts`
- 수정: `packages/core/src/runtime/install.ts`

### 단계 1: 실패하는 테스트 작성

`packages/core/src/interceptors/__tests__/websocket.test.ts`를 생성한다.

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDevtoolsEngine } from "../../runtime/engine.js";
import { installWebSocketInterceptor } from "../websocket.js";

const originalWebSocket = globalThis.window.WebSocket;

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readonly protocol = "";
  readyState = FakeWebSocket.CONNECTING;
  binaryType: BinaryType = "blob";
  readonly sent: unknown[] = [];

  constructor(url: string | URL) {
    super();
    this.url = String(url);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this.sent.push(data);
  }

  close(code?: number): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent("close", { code }));
  }
}

describe("installWebSocketInterceptor", () => {
  beforeEach(() => {
    Reflect.set(globalThis.window, "WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    Reflect.set(globalThis.window, "WebSocket", originalWebSocket);
  });

  it("records connection lifecycle and in/out messages", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });
    const installed = installWebSocketInterceptor({
      engine,
      target: globalThis.window,
    });
    const socket = new globalThis.window.WebSocket("wss://example.test/socket");

    socket.dispatchEvent(new Event("open"));
    socket.send("client-message");
    socket.dispatchEvent(new MessageEvent("message", { data: "server-message" }));
    socket.close(1000);

    expect(installed?.name).toBe("websocket");
    expect(engine.getConnections()).toEqual([
      expect.objectContaining({
        protocol: "websocket",
        state: "closed",
        url: "wss://example.test/socket",
        closeCode: 1000,
      }),
    ]);
    expect(engine.getMessages()).toEqual([
      expect.objectContaining({ direction: "out", payloadPreview: "client-message" }),
      expect.objectContaining({ direction: "in", payloadPreview: "server-message" }),
    ]);

    installed?.uninstall();
    expect(globalThis.window.WebSocket).toBe(originalWebSocket);
  });
});
```

### 단계 2: RED 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/interceptors/__tests__/websocket.test.ts
```

기대 결과:

- 실패한다.
- 실패 이유에 `../websocket.js`가 없다는 내용이 포함된다.

### 단계 3: 인터셉터 계약과 WebSocket 구현

`packages/core/src/interceptors/types.ts`를 생성한다.

```typescript
import type { BrowseSentEventEngine } from "../runtime/engine.js";

export interface BrowseSentEventInterceptorContext {
  readonly engine: BrowseSentEventEngine;
  readonly target: Window;
}

export interface InstalledBrowseSentEventInterceptor {
  readonly name: string;
  uninstall(): void;
}
```

`packages/core/src/interceptors/websocket.ts`를 생성한다.

```typescript
import type { BrowseSentEventPayload } from "../runtime/events.js";
import type {
  BrowseSentEventInterceptorContext,
  InstalledBrowseSentEventInterceptor,
} from "./types.js";

function toPayload(data: unknown): BrowseSentEventPayload {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return data;
  }

  if (ArrayBuffer.isView(data)) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }

  return String(data);
}

export function installWebSocketInterceptor(
  context: BrowseSentEventInterceptorContext,
): InstalledBrowseSentEventInterceptor | undefined {
  const OriginalWebSocket = context.target.WebSocket;

  if (!OriginalWebSocket) {
    return undefined;
  }

  const ProxiedWebSocket = new Proxy(OriginalWebSocket, {
    construct(target, args, newTarget) {
      const socket = Reflect.construct(target, args, newTarget) as WebSocket;
      const url = String(args[0]);
      const connection = context.engine.recordConnection({
        protocol: "websocket",
        url,
        state: "connecting",
      });

      socket.addEventListener("open", () => {
        context.engine.updateConnection(connection.id, { state: "open" });
      });
      socket.addEventListener("close", (event) => {
        const closeEvent = event as CloseEvent;

        context.engine.updateConnection(connection.id, {
          state: "closed",
          closedAt: globalThis.performance?.now() ?? Date.now(),
          closeCode: closeEvent.code,
        });
      });
      socket.addEventListener("message", (event) => {
        const messageEvent = event as MessageEvent<unknown>;

        context.engine.recordMessage({
          connectionId: connection.id,
          direction: "in",
          protocol: "websocket",
          payload: toPayload(messageEvent.data),
          metadata: { url },
        });
      });

      const originalSend = socket.send.bind(socket);

      Reflect.set(socket, "send", (data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
        context.engine.recordMessage({
          connectionId: connection.id,
          direction: "out",
          protocol: "websocket",
          payload: toPayload(data),
          metadata: { url },
        });

        originalSend(data);
      });

      return socket;
    },
  });

  Reflect.set(context.target, "WebSocket", ProxiedWebSocket);

  return {
    name: "websocket",
    uninstall() {
      Reflect.set(context.target, "WebSocket", OriginalWebSocket);
    },
  };
}
```

### 단계 4: runtime 설치 경로에 WebSocket 연결

`packages/core/src/runtime/install.ts`에서 runtime 생성 직후 WebSocket 인터셉터를 설치하고, `uninstall()`에서 복구한다.

```typescript
const installedInterceptors = [
  installWebSocketInterceptor({
    engine: runtime.engine,
    target,
  }),
].filter((interceptor): interceptor is InstalledBrowseSentEventInterceptor => interceptor !== undefined);

const runtime: BrowseSentEventRuntime = createBrowseSentEventRuntime(options, {
  installed: true,
  uninstall() {
    for (const interceptor of installedInterceptors.toReversed()) {
      interceptor.uninstall();
    }

    Reflect.deleteProperty(target, runtimeKey);
  },
});
```

실제 구현에서는 `runtime` 선언 순서 때문에 먼저 `createBrowseSentEventRuntime()`를 만들고, 그 뒤 인터셉터를 설치한 다음 `uninstall` 가능한 runtime 객체를 구성한다. 순서가 애매하면 작은 helper `createInstalledRuntime()`을 `install.ts` 내부에 둔다.

### 단계 5: GREEN 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/interceptors/__tests__/websocket.test.ts src/runtime/__tests__/install.test.ts
pnpm --filter @browse-sent-event/core typecheck
pnpm lint
```

기대 결과:

- WebSocket 인터셉터 테스트가 통과한다.
- runtime install 테스트가 통과한다.
- 타입 검사와 lint가 exit code `0`으로 끝난다.

### 단계 6: 커밋

```bash
git add packages/core/src/runtime/install.ts packages/core/src/interceptors/types.ts packages/core/src/interceptors/websocket.ts packages/core/src/interceptors/__tests__/websocket.test.ts
git commit -m "feat(core): WebSocket 인터셉터 추가"
```

---

## 작업 6: fetch ReadableStream 인터셉터 추가

**파일:**
- 생성: `packages/core/src/interceptors/fetch-stream.ts`
- 생성: `packages/core/src/interceptors/__tests__/fetch-stream.test.ts`
- 수정: `packages/core/src/runtime/install.ts`

### 단계 1: 실패하는 테스트 작성

`packages/core/src/interceptors/__tests__/fetch-stream.test.ts`를 생성한다.

```typescript
import { afterEach, describe, expect, it } from "vitest";
import { createDevtoolsEngine } from "../../runtime/engine.js";
import { installFetchStreamInterceptor } from "../fetch-stream.js";

const originalFetch = globalThis.window.fetch;

function createStreamResponse(chunks: string[], contentType = "text/plain"): Response {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }

        controller.close();
      },
    }),
    {
      headers: {
        "content-type": contentType,
      },
    },
  );
}

describe("installFetchStreamInterceptor", () => {
  afterEach(() => {
    Reflect.set(globalThis.window, "fetch", originalFetch);
  });

  it("records readable stream chunks without consuming the app response", async () => {
    const engine = createDevtoolsEngine({ capacity: 10 });

    Reflect.set(globalThis.window, "fetch", () =>
      Promise.resolve(createStreamResponse(["first", "second"])),
    );

    installFetchStreamInterceptor({
      engine,
      target: globalThis.window,
    });

    const response = await globalThis.window.fetch("https://example.test/stream");
    await expect(response.text()).resolves.toBe("firstsecond");
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));

    expect(engine.getConnections()).toEqual([
      expect.objectContaining({
        protocol: "fetch-stream",
        state: "closed",
        url: "https://example.test/stream",
      }),
    ]);
    expect(engine.getMessages()).toEqual([
      expect.objectContaining({ payloadPreview: "first" }),
      expect.objectContaining({ payloadPreview: "second" }),
    ]);
  });

  it("classifies text/event-stream fetch responses as eventsource", async () => {
    const engine = createDevtoolsEngine({ capacity: 10 });

    Reflect.set(globalThis.window, "fetch", () =>
      Promise.resolve(createStreamResponse(["data: hello\\n\\n"], "text/event-stream")),
    );

    installFetchStreamInterceptor({
      engine,
      target: globalThis.window,
    });

    const response = await globalThis.window.fetch("https://example.test/sse");
    await response.text();
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));

    expect(engine.getConnections()[0]).toEqual(
      expect.objectContaining({
        protocol: "eventsource",
        metadata: expect.objectContaining({ source: "fetch" }),
      }),
    );
  });
});
```

### 단계 2: RED 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/interceptors/__tests__/fetch-stream.test.ts
```

기대 결과:

- 실패한다.
- 실패 이유에 `../fetch-stream.js`가 없다는 내용이 포함된다.

### 단계 3: fetch stream 구현

`packages/core/src/interceptors/fetch-stream.ts`를 생성한다.

```typescript
import type { BrowseSentEventPayload, BrowseSentEventProtocol } from "../runtime/events.js";
import type {
  BrowseSentEventInterceptorContext,
  InstalledBrowseSentEventInterceptor,
} from "./types.js";

const textDecoder = new TextDecoder();

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

function isTextContentType(contentType: string | null): boolean {
  return contentType?.includes("text/") === true || contentType?.includes("json") === true;
}

function classifyProtocol(contentType: string | null): BrowseSentEventProtocol {
  return contentType?.includes("text/event-stream") === true ? "eventsource" : "fetch-stream";
}

function toPayload(chunk: Uint8Array, contentType: string | null): BrowseSentEventPayload {
  if (isTextContentType(contentType)) {
    return textDecoder.decode(chunk);
  }

  return chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
}

async function recordReadableStream(
  stream: ReadableStream<Uint8Array>,
  context: BrowseSentEventInterceptorContext,
  connectionId: string,
  protocol: BrowseSentEventProtocol,
  contentType: string | null,
): Promise<void> {
  const reader = stream.getReader();

  try {
    while (true) {
      const result = await reader.read();

      if (result.done) {
        break;
      }

      context.engine.recordMessage({
        connectionId,
        direction: "in",
        protocol,
        payload: toPayload(result.value, contentType),
        metadata: { contentType },
      });
    }
  } finally {
    context.engine.updateConnection(connectionId, {
      state: "closed",
      closedAt: globalThis.performance?.now() ?? Date.now(),
    });
    reader.releaseLock();
  }
}

export function installFetchStreamInterceptor(
  context: BrowseSentEventInterceptorContext,
): InstalledBrowseSentEventInterceptor | undefined {
  const originalFetch = context.target.fetch;

  if (!originalFetch) {
    return undefined;
  }

  Reflect.set(context.target, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await originalFetch(input, init);
    const body = response.body;

    if (!body) {
      return response;
    }

    const contentType = response.headers.get("content-type");
    const protocol = classifyProtocol(contentType);
    const connection = context.engine.recordConnection({
      protocol,
      url: getRequestUrl(input),
      state: "open",
      metadata: {
        contentType,
        source: protocol === "eventsource" ? "fetch" : "fetch",
      },
    });
    const clonedBody = response.clone().body;

    if (clonedBody) {
      void recordReadableStream(clonedBody, context, connection.id, protocol, contentType);
    }

    return response;
  });

  return {
    name: "fetch-stream",
    uninstall() {
      Reflect.set(context.target, "fetch", originalFetch);
    },
  };
}
```

### 단계 4: runtime 설치 경로에 fetch 연결

`packages/core/src/runtime/install.ts`의 interceptor 설치 목록에 `installFetchStreamInterceptor()`를 추가한다.

### 단계 5: GREEN 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/interceptors/__tests__/fetch-stream.test.ts src/runtime/__tests__/install.test.ts
pnpm --filter @browse-sent-event/core typecheck
pnpm lint
```

기대 결과:

- fetch stream 테스트가 통과한다.
- runtime install 테스트가 통과한다.
- 타입 검사와 lint가 exit code `0`으로 끝난다.

### 단계 6: 커밋

```bash
git add packages/core/src/runtime/install.ts packages/core/src/interceptors/fetch-stream.ts packages/core/src/interceptors/__tests__/fetch-stream.test.ts
git commit -m "feat(core): fetch stream 인터셉터 추가"
```

---

## 작업 7: EventSource 인터셉터 추가

**파일:**
- 생성: `packages/core/src/interceptors/eventsource.ts`
- 생성: `packages/core/src/interceptors/__tests__/eventsource.test.ts`
- 수정: `packages/core/src/runtime/install.ts`

### 단계 1: 실패하는 테스트 작성

`packages/core/src/interceptors/__tests__/eventsource.test.ts`를 생성한다.

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDevtoolsEngine } from "../../runtime/engine.js";
import { installEventSourceInterceptor } from "../eventsource.js";

const originalEventSource = globalThis.window.EventSource;

class FakeEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readonly url: string;
  readonly withCredentials = false;
  readyState = FakeEventSource.CONNECTING;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }
}

describe("installEventSourceInterceptor", () => {
  beforeEach(() => {
    Reflect.set(globalThis.window, "EventSource", FakeEventSource);
  });

  afterEach(() => {
    Reflect.set(globalThis.window, "EventSource", originalEventSource);
  });

  it("records EventSource lifecycle and message events", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });

    installEventSourceInterceptor({
      engine,
      target: globalThis.window,
    });

    const source = new globalThis.window.EventSource("https://example.test/events");

    source.dispatchEvent(new Event("open"));
    source.dispatchEvent(
      new MessageEvent("message", {
        data: "server-event",
        lastEventId: "event-1",
      }),
    );
    source.close();

    expect(engine.getConnections()).toEqual([
      expect.objectContaining({
        protocol: "eventsource",
        state: "closed",
        url: "https://example.test/events",
      }),
    ]);
    expect(engine.getMessages()).toEqual([
      expect.objectContaining({
        payloadPreview: "server-event",
        type: "message",
        metadata: expect.objectContaining({
          lastEventId: "event-1",
        }),
      }),
    ]);
  });
});
```

### 단계 2: RED 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/interceptors/__tests__/eventsource.test.ts
```

기대 결과:

- 실패한다.
- 실패 이유에 `../eventsource.js`가 없다는 내용이 포함된다.

### 단계 3: EventSource 구현

`packages/core/src/interceptors/eventsource.ts`를 생성한다.

```typescript
import type {
  BrowseSentEventInterceptorContext,
  InstalledBrowseSentEventInterceptor,
} from "./types.js";

export function installEventSourceInterceptor(
  context: BrowseSentEventInterceptorContext,
): InstalledBrowseSentEventInterceptor | undefined {
  const OriginalEventSource = context.target.EventSource;

  if (!OriginalEventSource) {
    return undefined;
  }

  const ProxiedEventSource = new Proxy(OriginalEventSource, {
    construct(target, args, newTarget) {
      const source = Reflect.construct(target, args, newTarget) as EventSource;
      const url = String(args[0]);
      const connection = context.engine.recordConnection({
        protocol: "eventsource",
        url,
        state: "connecting",
        metadata: { source: "eventsource" },
      });

      source.addEventListener("open", () => {
        context.engine.updateConnection(connection.id, { state: "open" });
      });
      source.addEventListener("error", () => {
        if (source.readyState === EventSource.CLOSED) {
          context.engine.updateConnection(connection.id, {
            state: "closed",
            closedAt: globalThis.performance?.now() ?? Date.now(),
          });
        }
      });
      source.addEventListener("message", (event) => {
        const messageEvent = event as MessageEvent<string>;

        context.engine.recordMessage({
          connectionId: connection.id,
          direction: "in",
          protocol: "eventsource",
          payload: messageEvent.data,
          type: "message",
          metadata: {
            lastEventId: messageEvent.lastEventId,
            url,
          },
        });
      });

      const originalClose = source.close.bind(source);

      Reflect.set(source, "close", () => {
        context.engine.updateConnection(connection.id, {
          state: "closed",
          closedAt: globalThis.performance?.now() ?? Date.now(),
        });

        originalClose();
      });

      return source;
    },
  });

  Reflect.set(context.target, "EventSource", ProxiedEventSource);

  return {
    name: "eventsource",
    uninstall() {
      Reflect.set(context.target, "EventSource", OriginalEventSource);
    },
  };
}
```

### 단계 4: runtime 설치 경로에 EventSource 연결

`packages/core/src/runtime/install.ts`의 interceptor 설치 목록에 `installEventSourceInterceptor()`를 추가한다.

### 단계 5: GREEN 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/interceptors/__tests__/eventsource.test.ts src/runtime/__tests__/install.test.ts
pnpm --filter @browse-sent-event/core typecheck
pnpm lint
```

기대 결과:

- EventSource 테스트가 통과한다.
- runtime install 테스트가 통과한다.
- 타입 검사와 lint가 exit code `0`으로 끝난다.

### 단계 6: 커밋

```bash
git add packages/core/src/runtime/install.ts packages/core/src/interceptors/eventsource.ts packages/core/src/interceptors/__tests__/eventsource.test.ts
git commit -m "feat(core): EventSource 인터셉터 추가"
```

---

## 작업 8: 문서와 에이전트 컨텍스트 정리

**파일:**
- 수정: `README.md`
- 수정: `.ai/contexts/phase-1-scope.md`
- 수정: `.ai/tasks/add-interceptor.md`

### 단계 1: README Phase 1 상태 갱신

`README.md`에 현재 구현 범위를 갱신한다.

```markdown
## 현재 구현 상태

- Vite 개발 서버 entry bootstrap 주입
- core runtime 설치 API
- WebSocket, fetch ReadableStream, EventSource 이벤트 수집
- in-memory ring buffer, 단순 검색, JSONL/log export

아직 DevTools UI는 구현 전이다.
```

### 단계 2: 에이전트 컨텍스트 갱신

`.ai/contexts/phase-1-scope.md`에 “구현됨/남음” 구분을 추가한다.

```markdown
구현됨:

- Vite plugin injection
- core runtime install
- transport event collection

남음:

- Shadow DOM 플로팅 패널
- 연결 목록, 메시지 타임라인, 메트릭 UI
```

`.ai/tasks/add-interceptor.md`에는 새 인터셉터 추가 시 따라야 할 engine boundary를 명시한다.

```markdown
- 인터셉터는 storage를 직접 수정하지 않고 `BrowseSentEventEngine`의 `recordConnection`, `updateConnection`, `recordMessage`만 호출한다.
- 인터셉터는 `InstalledBrowseSentEventInterceptor`를 반환하고 `uninstall()`에서 원본 API를 복구한다.
```

### 단계 3: 문서 검증

실행:

```bash
pnpm format:check
git diff --check
```

기대 결과:

- format check가 exit code `0`으로 끝난다.
- whitespace error가 없다.

### 단계 4: 커밋

```bash
git add README.md .ai/contexts/phase-1-scope.md .ai/tasks/add-interceptor.md
git commit -m "docs(core): 인터셉터 구현 범위 문서화"
```

---

## 작업 9: 최종 검증

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
| native EventSource `retry` 값 미캡처 | `retry:` 필드의 완전한 관찰 | 브라우저 native EventSource API가 raw SSE frame을 노출하지 않음 | fetch SSE parser 또는 custom EventSource transport를 도입할 때 |
| binary payload preview 단순화 | binary 본문의 사람이 읽을 수 있는 preview | Phase 1 UI는 size와 방향 확인만으로 충분하고, base64는 메모리 비용 증가 | binary 상세 보기 요구가 확인될 때 |
| fetch stream tap 오류 비노출 | clone stream read 실패를 UI에 에러 이벤트로 표시 | 앱 응답 경로를 보존하는 것이 우선이며, 실패해도 앱 동작은 깨지지 않음 | DevTools UI error row를 만들 때 |
| reconnect 감지 휴리스틱 | 동일 URL/프로토콜 기반의 정확하지 않은 reconnect count | Phase 1은 “재연결이 있었는지” 힌트만 필요 | 연결 세션 모델을 UI와 함께 정교화할 때 |

## 완료 기준

- `installBrowseSentEvent()` 호출 후 WebSocket, fetch ReadableStream, EventSource 이벤트가 engine에 기록된다.
- `runtime.engine.getMessages()`, `search()`, `exportJsonl()`, `exportLog()`로 UI 없이 수집 결과를 검증할 수 있다.
- production bundle no-op 요구는 기존 Vite fixture 테스트가 계속 보장한다.
- 모든 변경은 기능 단위 커밋으로 분리되어 있다.
