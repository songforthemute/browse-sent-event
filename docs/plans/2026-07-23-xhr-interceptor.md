---
search: false
---

# XMLHttpRequest 인터셉터 구현 계획

> **Claude용:** 구현 단계에서는 `superpowers:executing-plans`, `superpowers:test-driven-development`, `superpowers:verification-before-completion`을 사용해 작업 단위로 진행한다.

**목표:** Axios 기본 브라우저 어댑터를 포함한 `XMLHttpRequest` 요청의 요청 본문, 최종 응답, 종료 상태를 기존 transport 타임라인에 추가한다.

**아키텍처:** `window.XMLHttpRequest` 생성자를 Proxy로 감싸 실제 XHR 인스턴스를 보존하고, 인스턴스의 `open()`과 `send()` 및 표준 lifecycle event를 관찰한다. 각 `send()`를 `xhr` connection 하나로 기록하며, payload 변환 실패와 native transport 실패를 분리한다.

**기술 스택:** TypeScript 6, Vitest 4, happy-dom, Playwright, Vite 8, pnpm workspace, Turborepo.

**설계 문서:** `docs/plans/2026-07-23-xhr-interceptor-design.md`

---

## 구현 원칙

1. 테스트를 먼저 작성하고 예상한 이유로 실패하는지 확인한다.
2. native XHR 인스턴스, 반환값, 예외와 사용자 event handler를 바꾸지 않는다.
3. 관찰 실패가 앱의 `open()` 또는 `send()`를 막지 않게 한다.
4. 요청 header와 `FormData` 값은 수집하지 않는다.
5. Axios를 dependency나 fixture dependency로 추가하지 않는다.
6. 기존 `filter.excludeUrls` 미적용 문제는 이 작업에 섞지 않는다.
7. 각 커밋은 하나의 책임만 포함한다.

## 커밋 구성

| 순서 | 책임 | 커밋 메시지 |
| --- | --- | --- |
| 1 | 기본 XHR 요청/응답 수집 | `feat(interceptors): XHR 요청 응답 수집 추가` |
| 2 | payload와 종료 경계 하드닝 | `fix(interceptors): XHR 수명주기 경계 보강` |
| 3 | runtime 설치와 복구 연결 | `feat(core): XHR 인터셉터 런타임 연결` |
| 4 | 실제 Chromium 수집 검증 | `test(e2e): 브라우저 XHR 수집 검증 추가` |
| 5 | 사용자 문서와 changeset | `docs(core): XHR 지원 범위 반영` |

---

## 작업 1: 기본 XHR 요청과 응답 수집

**파일:**

- 수정: `packages/core/src/runtime/events.ts:1`
- 생성: `packages/core/src/interceptors/xml-http-request.ts`
- 생성: `packages/core/src/interceptors/__tests__/xml-http-request.test.ts`

### 단계 1: 성공 요청에 대한 실패 테스트 작성

`packages/core/src/interceptors/__tests__/xml-http-request.test.ts`를 만든다. Fake 구현은 테스트가 직접 event 발생 시점과 응답 값을 통제할 수 있게 한다.

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDevtoolsEngine } from "../../runtime/engine.js";
import { installXmlHttpRequestInterceptor } from "../xml-http-request.js";

const originalXmlHttpRequest = globalThis.window.XMLHttpRequest;

class FakeXmlHttpRequest extends globalThis.EventTarget {
  static readonly UNSENT = 0;
  static readonly OPENED = 1;
  static readonly HEADERS_RECEIVED = 2;
  static readonly LOADING = 3;
  static readonly DONE = 4;

  readonly UNSENT = FakeXmlHttpRequest.UNSENT;
  readonly OPENED = FakeXmlHttpRequest.OPENED;
  readonly HEADERS_RECEIVED = FakeXmlHttpRequest.HEADERS_RECEIVED;
  readonly LOADING = FakeXmlHttpRequest.LOADING;
  readonly DONE = FakeXmlHttpRequest.DONE;

  readyState = FakeXmlHttpRequest.UNSENT;
  response: unknown = "";
  responseText = "";
  responseType: XMLHttpRequestResponseType = "";
  responseURL = "";
  status = 0;
  statusText = "";
  timeout = 0;
  withCredentials = false;
  readonly sentBodies: (Document | XMLHttpRequestBodyInit | null)[] = [];
  openedWith:
    | {
        readonly method: string;
        readonly url: string | URL;
        readonly async: boolean;
      }
    | undefined;

  open(method: string, url: string | URL, async = true): void {
    this.openedWith = { method, url, async };
    this.readyState = FakeXmlHttpRequest.OPENED;
  }

  send(body: Document | XMLHttpRequestBodyInit | null = null): void {
    this.sentBodies.push(body);
    this.dispatchEvent(new globalThis.ProgressEvent("loadstart"));
  }

  getResponseHeader(name: string): string | null {
    return name.toLowerCase() === "content-type" ? "application/json" : null;
  }

  succeed(responseText: string, status = 200): void {
    this.status = status;
    this.statusText = status === 200 ? "OK" : "ERROR";
    this.responseText = responseText;
    this.response = responseText;
    this.responseURL = "https://example.test/items";
    this.readyState = FakeXmlHttpRequest.DONE;
    this.dispatchEvent(new globalThis.ProgressEvent("load"));
    this.dispatchEvent(new globalThis.ProgressEvent("loadend"));
  }
}

describe("installXmlHttpRequestInterceptor", () => {
  beforeEach(() => {
    Reflect.set(globalThis.window, "XMLHttpRequest", FakeXmlHttpRequest);
  });

  afterEach(() => {
    Reflect.set(globalThis.window, "XMLHttpRequest", originalXmlHttpRequest);
  });

  it("records a completed XHR request and response", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });
    const installed = installXmlHttpRequestInterceptor({
      engine,
      target: globalThis.window,
    });
    const request = new globalThis.window.XMLHttpRequest();

    request.open("post", "https://example.test/items");
    request.send('{"name":"sample"}');
    Reflect.get(request, "succeed")('{"id":"item-1"}');

    expect(installed?.name).toBe("xhr");
    expect(engine.getConnections()).toEqual([
      expect.objectContaining({
        protocol: "xhr",
        state: "closed",
        url: "https://example.test/items",
        metadata: expect.objectContaining({
          method: "POST",
          outcome: "load",
          status: 200,
        }),
      }),
    ]);
    expect(engine.getMessages()).toEqual([
      expect.objectContaining({
        direction: "out",
        payloadPreview: '{"name":"sample"}',
        protocol: "xhr",
        type: "request",
      }),
      expect.objectContaining({
        direction: "in",
        payloadPreview: '{"id":"item-1"}',
        protocol: "xhr",
        type: "response",
      }),
    ]);

    installed?.uninstall();
    expect(globalThis.window.XMLHttpRequest).toBe(FakeXmlHttpRequest);
  });

  it("preserves the native instance identity and static constants", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });

    installXmlHttpRequestInterceptor({
      engine,
      target: globalThis.window,
    });

    const request = new globalThis.window.XMLHttpRequest();

    expect(request).toBeInstanceOf(FakeXmlHttpRequest);
    expect(globalThis.window.XMLHttpRequest.DONE).toBe(FakeXmlHttpRequest.DONE);
  });
});
```

테스트에서 Fake 전용 helper 호출은 `Reflect.get()`으로 접근해 production XHR 타입에 테스트 메서드를 추가하지 않는다.

### 단계 2: 테스트가 예상한 이유로 실패하는지 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/interceptors/__tests__/xml-http-request.test.ts
```

예상 결과:

```text
FAIL
Cannot find module '../xml-http-request.js'
```

모듈 부재가 아닌 다른 이유로 실패하면 테스트 설정을 먼저 수정한다.

### 단계 3: 공개 protocol에 `xhr` 추가

`packages/core/src/runtime/events.ts`의 protocol union을 확장한다.

```ts
export type BrowseSentEventProtocol =
  | "websocket"
  | "fetch-stream"
  | "eventsource"
  | "xhr";
```

### 단계 4: 최소 XHR 인터셉터 구현

`packages/core/src/interceptors/xml-http-request.ts`를 만든다.

초기 구현은 text 요청과 text 응답, 성공 lifecycle, 설치와 제거만 통과시킨다. edge case는 다음 작업에서 테스트로 확장한다.

```ts
import type {
  BrowseSentEventConnection,
  BrowseSentEventPayload,
} from "../runtime/events.js";
import type {
  BrowseSentEventInterceptorContext,
  InstalledBrowseSentEventInterceptor,
} from "./types.js";
import { installGlobalPatch } from "./global-patch.js";

interface XmlHttpRequestDescriptor {
  readonly method: string;
  readonly url: string;
  readonly async: boolean;
  sent: boolean;
}

interface ActiveXmlHttpRequest {
  readonly connection: BrowseSentEventConnection;
  outcome?: "load" | "error" | "abort" | "timeout";
  finalized: boolean;
}

function isInstrumentableXmlHttpRequest(value: unknown): value is XMLHttpRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "addEventListener" in value &&
    "open" in value &&
    "send" in value
  );
}

function now(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function toRequestPayload(body: Document | XMLHttpRequestBodyInit | null): BrowseSentEventPayload {
  return typeof body === "string" ? body : body === null ? "" : String(body);
}

function toResponsePayload(request: XMLHttpRequest): BrowseSentEventPayload {
  return request.responseText;
}

function instrumentXmlHttpRequest(
  request: XMLHttpRequest,
  context: BrowseSentEventInterceptorContext,
): void {
  const originalOpen = request.open;
  const originalSend = request.send;
  let descriptor: XmlHttpRequestDescriptor | undefined;
  let active: ActiveXmlHttpRequest | undefined;

  request.addEventListener("loadstart", () => {
    if (active) {
      context.engine.updateConnection(active.connection.id, { state: "open" });
    }
  });
  request.addEventListener("load", () => {
    if (active) {
      active.outcome = "load";
    }
  });
  request.addEventListener("error", () => {
    if (active) {
      active.outcome = "error";
    }
  });
  request.addEventListener("abort", () => {
    if (active) {
      active.outcome = "abort";
    }
  });
  request.addEventListener("timeout", () => {
    if (active) {
      active.outcome = "timeout";
    }
  });
  request.addEventListener("loadend", () => {
    const current = active;

    if (!current || current.finalized) {
      return;
    }

    current.finalized = true;

    if (current.outcome === "load") {
      context.engine.recordMessage({
        connectionId: current.connection.id,
        direction: "in",
        protocol: "xhr",
        payload: toResponsePayload(request),
        type: "response",
        metadata: {
          contentType: request.getResponseHeader("content-type"),
          status: request.status,
          statusText: request.statusText,
        },
      });
    }

    context.engine.updateConnection(current.connection.id, {
      state: "closed",
      closedAt: now(),
      metadata: {
        contentType: request.getResponseHeader("content-type"),
        outcome: current.outcome ?? "unknown",
        responseType: request.responseType,
        responseURL: request.responseURL,
        status: request.status,
        statusText: request.statusText,
      },
    });
    active = undefined;
  });

  Reflect.set(request, "open", (...args: unknown[]) => {
    const result = Reflect.apply(originalOpen, request, args);
    const [method, url, async = true] = args;

    descriptor = {
      method: String(method).toUpperCase(),
      url: String(url),
      async: Boolean(async),
      sent: false,
    };
    active = undefined;

    return result;
  });

  Reflect.set(request, "send", (...args: unknown[]) => {
    if (!descriptor || descriptor.sent) {
      return Reflect.apply(originalSend, request, args);
    }

    descriptor.sent = true;

    const connection = context.engine.recordConnection({
      protocol: "xhr",
      url: descriptor.url,
      state: "connecting",
      metadata: {
        async: descriptor.async,
        method: descriptor.method,
        timeout: request.timeout,
        withCredentials: request.withCredentials,
      },
    });
    const body = (args[0] ?? null) as Document | XMLHttpRequestBodyInit | null;

    active = {
      connection,
      finalized: false,
    };
    context.engine.recordMessage({
      connectionId: connection.id,
      direction: "out",
      protocol: "xhr",
      payload: toRequestPayload(body),
      type: "request",
      metadata: {
        method: descriptor.method,
      },
    });

    return Reflect.apply(originalSend, request, args);
  });
}

export function installXmlHttpRequestInterceptor(
  context: BrowseSentEventInterceptorContext,
): InstalledBrowseSentEventInterceptor | undefined {
  const OriginalXmlHttpRequest = context.target.XMLHttpRequest;

  if (!OriginalXmlHttpRequest) {
    return undefined;
  }

  const ProxiedXmlHttpRequest = new Proxy(OriginalXmlHttpRequest, {
    construct(target, args, newTarget) {
      const request: unknown = Reflect.construct(target, args, newTarget);

      if (!isInstrumentableXmlHttpRequest(request)) {
        throw new TypeError("Expected XMLHttpRequest instance.");
      }

      instrumentXmlHttpRequest(request, context);

      return request;
    },
  });
  const patch = installGlobalPatch(
    context.target,
    "XMLHttpRequest",
    () => ProxiedXmlHttpRequest,
  );

  return {
    name: "xhr",
    uninstall() {
      patch.uninstall();
    },
  };
}
```

### 단계 5: 기본 테스트 통과 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/interceptors/__tests__/xml-http-request.test.ts
```

예상 결과:

```text
PASS
2 tests passed
```

### 단계 6: 타입 검사

실행:

```bash
pnpm --filter @browse-sent-event/core typecheck
```

예상 결과: exit code 0.

overload 또는 DOM 타입 오류가 나면 `Reflect.apply()`의 인자 타입을 좁히되 native 인자 개수는 바꾸지 않는다.

### 단계 7: 커밋

```bash
git add packages/core/src/runtime/events.ts packages/core/src/interceptors/xml-http-request.ts packages/core/src/interceptors/__tests__/xml-http-request.test.ts
git commit -m "feat(interceptors): XHR 요청 응답 수집 추가"
```

---

## 작업 2: Payload와 종료 경계 하드닝

**파일:**

- 수정: `packages/core/src/interceptors/xml-http-request.ts`
- 수정: `packages/core/src/interceptors/__tests__/xml-http-request.test.ts`

### 단계 1: Payload 변환 실패 테스트 추가

다음 사례를 하나씩 테스트에 추가하고 각 사례가 현재 최소 구현에서 실패하는지 확인한다.

```ts
it("copies ArrayBuffer request and response payloads", () => {
  const engine = createDevtoolsEngine({ capacity: 10 });

  installXmlHttpRequestInterceptor({
    engine,
    target: globalThis.window,
  });

  const request = new globalThis.window.XMLHttpRequest();
  const requestBody = new Uint8Array([1, 2, 3]);

  request.open("POST", "https://example.test/binary");
  request.responseType = "arraybuffer";
  request.send(requestBody);

  Reflect.set(request, "response", new Uint8Array([4, 5]).buffer);
  Reflect.set(request, "status", 200);
  request.dispatchEvent(new globalThis.ProgressEvent("load"));
  request.dispatchEvent(new globalThis.ProgressEvent("loadend"));

  const [outgoing, incoming] = engine.getMessages();

  expect(outgoing?.payload).toEqual(new Uint8Array([1, 2, 3]).buffer);
  expect(incoming?.payload).toEqual(new Uint8Array([4, 5]).buffer);
  expect(outgoing?.payload).not.toBe(requestBody.buffer);
});

it("summarizes FormData without exposing field values", () => {
  const engine = createDevtoolsEngine({ capacity: 10 });
  const formData = new globalThis.FormData();

  formData.append("token", "secret-value");
  formData.append("file", new globalThis.Blob(["content"], { type: "text/plain" }));

  installXmlHttpRequestInterceptor({
    engine,
    target: globalThis.window,
  });

  const request = new globalThis.window.XMLHttpRequest();

  request.open("POST", "https://example.test/form");
  request.send(formData);

  const payload = engine.getMessages()[0]?.payload;

  expect(payload).toContain("FormData");
  expect(payload).toContain("token");
  expect(payload).not.toContain("secret-value");
});

it("serializes a json response without reading responseText", () => {
  const engine = createDevtoolsEngine({ capacity: 10 });

  installXmlHttpRequestInterceptor({
    engine,
    target: globalThis.window,
  });

  const request = new globalThis.window.XMLHttpRequest();

  request.open("GET", "https://example.test/json");
  request.responseType = "json";
  request.send();
  Reflect.set(request, "response", { id: "item-1" });
  Reflect.set(request, "status", 200);
  request.dispatchEvent(new globalThis.ProgressEvent("load"));
  request.dispatchEvent(new globalThis.ProgressEvent("loadend"));

  expect(engine.getMessages()[1]).toEqual(
    expect.objectContaining({
      payloadPreview: '{"id":"item-1"}',
    }),
  );
});
```

### 단계 2: Payload 테스트 실패 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/interceptors/__tests__/xml-http-request.test.ts
```

예상 결과:

- typed array가 문자열로 기록되어 실패
- `FormData` 값 비노출 요약이 없어 실패
- `responseType: "json"`에서 `responseText` 접근 또는 결과 불일치로 실패

### 단계 3: 소비하지 않는 Payload 변환 구현

`xml-http-request.ts`에 다음 정책을 구현하는 내부 helper를 추가한다.

- `ArrayBuffer`와 view는 관찰 시점에 별도 `ArrayBuffer`로 복사한다.
- 문자열은 그대로 기록하고 `null`은 빈 문자열로 기록한다.
- `URLSearchParams`, `Blob`, `FormData`, `Document`는 대상 `window`와 실행 realm의 prototype intrinsic으로 brand를 확인하고 읽는다.
- 인스턴스가 덮어쓴 `toString()`, `entries()`, `size`, `type`, `contentType`은 호출하지 않는다.
- `FormData`는 값을 기록하지 않고 필드명만 최대 20개, 각 64자로 제한한다.
- `responseType`별로 `responseText`, 복사한 `ArrayBuffer`, JSON 직렬화, Blob 요약, Document 요약을 선택한다.
- 변환 실패의 예외 메시지는 기록하지 않고 고정된 unavailable placeholder를 사용한다.
- GET과 HEAD의 body는 브라우저가 폐기하므로 빈 payload로 기록한다.

기타 임의 body는 `String(body)`로 재변환하지 않고 unsupported placeholder로 남긴다. 이 결정에 수반되는 의식적 부채는 다음과 같다.

- 포기하는 것: 표준 `XMLHttpRequestBodyInit` 범위를 벗어난 사용자 정의 body의 내용과 제한을 초과한 `FormData` 필드명은 기록하지 않는다.
- 지금 감당 가능한 이유: 표준 body 형식은 모두 별도로 처리하며, 추가 문자열 변환이나 override 가능한 멤버 호출이 실제 전송 body와 애플리케이션 상태를 바꾸는 위험이 더 크다.
- 회수 조건: 브라우저가 Web IDL 변환 이후의 body를 부작용 없이 읽는 API를 제공하거나, 라이브러리에 명시적 사용자 serializer와 redaction 정책을 추가할 때 다시 검토한다.

### 단계 4: 종료 원인과 예외 보존 테스트 추가

```ts
it.each(["error", "abort", "timeout"] as const)(
  "closes the connection on %s without recording a response",
  (outcome) => {
    const engine = createDevtoolsEngine({ capacity: 10 });

    installXmlHttpRequestInterceptor({
      engine,
      target: globalThis.window,
    });

    const request = new globalThis.window.XMLHttpRequest();

    request.open("GET", `https://example.test/${outcome}`);
    request.send();
    request.dispatchEvent(new globalThis.ProgressEvent(outcome));
    request.dispatchEvent(new globalThis.ProgressEvent("loadend"));

    expect(engine.getMessages()).toHaveLength(1);
    expect(engine.getConnections()[0]).toEqual(
      expect.objectContaining({
        state: "closed",
        metadata: expect.objectContaining({ outcome }),
      }),
    );
  },
);

it("rethrows a native send error and closes the attempted connection", () => {
  class ThrowingXmlHttpRequest extends FakeXmlHttpRequest {
    override send(): void {
      throw new DOMException("Already sent", "InvalidStateError");
    }
  }

  Reflect.set(globalThis.window, "XMLHttpRequest", ThrowingXmlHttpRequest);

  const engine = createDevtoolsEngine({ capacity: 10 });

  installXmlHttpRequestInterceptor({
    engine,
    target: globalThis.window,
  });

  const request = new globalThis.window.XMLHttpRequest();

  request.open("POST", "https://example.test/failing-send");

  expect(() => request.send("body")).toThrowError(
    expect.objectContaining({ name: "InvalidStateError" }),
  );
  expect(engine.getConnections()[0]).toEqual(
    expect.objectContaining({
      state: "closed",
      metadata: expect.objectContaining({ outcome: "send-threw" }),
    }),
  );
});

it("creates a new connection when the same instance is reopened", () => {
  const engine = createDevtoolsEngine({ capacity: 10 });

  installXmlHttpRequestInterceptor({
    engine,
    target: globalThis.window,
  });

  const request = new globalThis.window.XMLHttpRequest();

  request.open("GET", "https://example.test/reused");
  request.send();
  Reflect.get(request, "succeed")("first");
  request.open("GET", "https://example.test/reused");
  request.send();
  Reflect.get(request, "succeed")("second");

  expect(engine.getConnections()).toHaveLength(2);
  expect(engine.getConnections()[1]?.reconnectCount).toBe(1);
  expect(engine.getMessages()).toHaveLength(4);
});
```

중복 `send()`는 Fake에 `sendInvoked` 상태를 추가해 두 번째 호출에서 native `InvalidStateError`를 발생시키고, engine record 수가 늘지 않는지 확인한다.

### 단계 5: 종료 처리와 capture 격리 구현

다음 규칙을 구현한다.

- `load`, `error`, `abort`, `timeout`은 사용자 이벤트 핸들러보다 먼저 해당 세대의 응답과 metadata snapshot을 저장하고 종료 대기열에 넣는다.
- `loadend`는 대기열에서 같은 세대의 snapshot을 꺼내 한 번만 finalize한다.
- terminal event 핸들러가 같은 XHR 인스턴스를 즉시 `open()`/`send()`해도 이전 `loadend`가 새 connection을 닫지 않는다.
- outcome이 `load`일 때만 incoming message를 기록한다.
- metadata getter와 payload 변환은 observer 내부에서 예외가 새지 않게 한다.
- native `send()`가 던지면 connection을 `send-threw`로 닫고 같은 예외를 다시 던진다.
- native `send()`의 인자 변환이 실패하면 descriptor의 `sent`를 되돌려 같은 `open()`의 정상 재시도를 새 connection으로 기록한다.
- engine subscriber가 `recordConnection()` 도중 던져도 이미 저장된 connection을 회수해 이후 종료 이벤트와 연결한다.
- `open()` 성공 전에는 descriptor를 바꾸지 않는다.
- 같은 `open()`에 중복 `send()`가 들어오면 record를 추가하지 않고 native 호출에 위임한다.
- 재사용을 위해 새 `open()` 성공 시 `sent`와 active state를 초기화한다.

observer callback은 다음 형태의 guard를 사용한다.

```ts
function observeSafely(callback: () => void): void {
  try {
    callback();
  } catch {
    // 관찰 실패는 앱의 XHR event dispatch를 중단하지 않는다.
  }
}
```

주석은 왜 오류를 삼키는지 설명하는 이 지점에만 남긴다.

### 단계 6: interceptor 테스트 전체 통과 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/interceptors/__tests__/xml-http-request.test.ts src/interceptors/__tests__/global-patch.test.ts
```

예상 결과: 모든 XHR와 global patch 테스트 통과.

### 단계 7: core 회귀 검증

실행:

```bash
pnpm --filter @browse-sent-event/core test
pnpm --filter @browse-sent-event/core typecheck
pnpm lint
```

예상 결과: exit code 0.

### 단계 8: 커밋

```bash
git add packages/core/src/interceptors/xml-http-request.ts packages/core/src/interceptors/__tests__/xml-http-request.test.ts
git commit -m "fix(interceptors): XHR 수명주기 경계 보강"
```

---

## 작업 3: Runtime 설치와 복구 연결

**파일:**

- 수정: `packages/core/src/runtime/install.ts:6-99`
- 수정: `packages/core/src/runtime/__tests__/install.test.ts`

### 단계 1: Runtime 설치 실패 테스트 추가

`packages/core/src/runtime/__tests__/install.test.ts`에서 원본 생성자를 보존하고 각 테스트가 runtime을 확실히 제거하도록 정리한다.

```ts
const originalXmlHttpRequest = globalThis.window.XMLHttpRequest;

beforeEach(() => {
  globalThis.document.body.replaceChildren();

  const installedRuntime = Reflect.get(globalThis.window, "__browseSentEventRuntime__");

  if (
    typeof installedRuntime === "object" &&
    installedRuntime !== null &&
    "uninstall" in installedRuntime
  ) {
    Reflect.get(installedRuntime, "uninstall")();
  }

  Reflect.set(globalThis.window, "XMLHttpRequest", originalXmlHttpRequest);
});
```

설치와 복구 테스트를 추가한다.

```ts
it("patches XMLHttpRequest once and restores it on uninstall", () => {
  const beforeInstall = globalThis.window.XMLHttpRequest;
  const runtime = installBrowseSentEvent();
  const afterInstall = globalThis.window.XMLHttpRequest;

  expect(afterInstall).not.toBe(beforeInstall);
  expect(installBrowseSentEvent()).toBe(runtime);
  expect(globalThis.window.XMLHttpRequest).toBe(afterInstall);

  runtime.uninstall();

  expect(globalThis.window.XMLHttpRequest).toBe(beforeInstall);
});
```

### 단계 2: Runtime 테스트 실패 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/runtime/__tests__/install.test.ts
```

예상 결과: `XMLHttpRequest`가 설치 전과 같아서 실패.

### 단계 3: Runtime 설치 목록에 XHR 추가

`packages/core/src/runtime/install.ts`에 import를 추가한다.

```ts
import { installXmlHttpRequestInterceptor } from "../interceptors/xml-http-request.js";
```

EventSource 설치 뒤, panel mount 전에 설치한다.

```ts
const xmlHttpRequestInterceptor = installXmlHttpRequestInterceptor({
  engine: runtime.engine,
  target,
});

if (xmlHttpRequestInterceptor) {
  installedInterceptors.push(xmlHttpRequestInterceptor);
}
```

uninstall은 기존 `installedInterceptors.toReversed()` 경로를 그대로 사용한다. XHR 전용 제거 분기를 만들지 않는다.

### 단계 4: Runtime 테스트 통과 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/runtime/__tests__/install.test.ts src/interceptors/__tests__/xml-http-request.test.ts
```

예상 결과: 모든 대상 테스트 통과.

### 단계 5: core 전체 검증

실행:

```bash
pnpm --filter @browse-sent-event/core test
pnpm --filter @browse-sent-event/core typecheck
pnpm --filter @browse-sent-event/core build
```

예상 결과: exit code 0.

### 단계 6: 커밋

```bash
git add packages/core/src/runtime/install.ts packages/core/src/runtime/__tests__/install.test.ts
git commit -m "feat(core): XHR 인터셉터 런타임 연결"
```

---

## 작업 4: 실제 Chromium XHR 수집 검증

**파일:**

- 수정: `examples/devtools-browser-fixture/src/fixture-probe.ts:3-170`
- 수정: `examples/devtools-browser-fixture/src/main.ts:1-17`
- 수정: `examples/devtools-browser-fixture/vite.config.ts:1-55`
- 수정: `e2e/devtools-panel.spec.ts:1-104`

### 단계 1: XHR E2E 실패 테스트 작성

`e2e/devtools-panel.spec.ts`에 실제 XHR 기록을 검증하는 테스트를 추가한다.

```ts
test("records XMLHttpRequest request and response in a real browser", async ({ page }) => {
  await page.goto("/");

  const capture = await page.evaluate(async () => {
    const fixture = Reflect.get(globalThis, "__bseFixture");

    if (typeof fixture !== "object" || fixture === null) {
      throw new Error("Fixture bridge is missing");
    }

    const runXmlHttpRequest = Reflect.get(fixture, "runXmlHttpRequest");
    const getXmlHttpRequestCapture = Reflect.get(fixture, "getXmlHttpRequestCapture");

    if (
      typeof runXmlHttpRequest !== "function" ||
      typeof getXmlHttpRequestCapture !== "function"
    ) {
      throw new Error("XMLHttpRequest fixture bridge is missing");
    }

    await runXmlHttpRequest();

    return getXmlHttpRequestCapture();
  });

  expect(capture.connection).toMatchObject({
    protocol: "xhr",
    state: "closed",
    metadata: {
      method: "POST",
      outcome: "load",
      status: 200,
    },
  });
  expect(capture.messages).toEqual([
    expect.objectContaining({
      direction: "out",
      payloadPreview: '{"message":"xhr hello"}',
      type: "request",
    }),
    expect.objectContaining({
      direction: "in",
      payloadPreview: '{"message":"xhr goodbye"}',
      type: "response",
    }),
  ]);
});
```

### 단계 2: E2E가 fixture bridge 부재로 실패하는지 확인

실행:

```bash
pnpm exec playwright test e2e/devtools-panel.spec.ts --grep "records XMLHttpRequest"
```

예상 결과:

```text
FAIL
XMLHttpRequest fixture bridge is missing
```

### 단계 3: JSON XHR endpoint 추가

`examples/devtools-browser-fixture/vite.config.ts`에 요청 body를 읽고 JSON을 반환하는 helper를 추가한다.

```ts
function writeXmlHttpRequestResponse(req: IncomingMessage, res: ServerResponse): void {
  let body = "";

  req.setEncoding("utf8");
  req.on("data", (chunk: string) => {
    body += chunk;
  });
  req.on("end", () => {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        message: body.includes("xhr hello") ? "xhr goodbye" : "unexpected request",
      }),
    );
  });
}
```

`IncomingMessage` 타입 import를 추가하고 middleware에 route를 연결한다.

```ts
if (pathname === "/__bse-fixture/xhr" && req.method === "POST") {
  writeXmlHttpRequestResponse(req, res);
  return;
}
```

### 단계 4: Fixture probe와 capture 조회 추가

`examples/devtools-browser-fixture/src/fixture-probe.ts`에 직렬화 가능한 capture 타입을 추가한다.

```ts
export interface BrowseSentEventXmlHttpRequestCapture {
  readonly connection:
    | {
        readonly protocol: string;
        readonly state: string;
        readonly metadata: Record<string, unknown>;
      }
    | undefined;
  readonly messages: readonly {
    readonly direction: string;
    readonly payloadPreview: string;
    readonly type?: string;
  }[];
}
```

실제 XHR 실행 함수를 추가한다.

```ts
export async function runXmlHttpRequest(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();

    request.open("POST", "/__bse-fixture/xhr");
    request.setRequestHeader("content-type", "application/json");
    request.addEventListener("load", () => {
      if (request.status === 200) {
        resolve();
        return;
      }

      reject(new Error(`XMLHttpRequest fixture returned ${request.status}`));
    });
    request.addEventListener("error", () => {
      reject(new Error("XMLHttpRequest fixture failed"));
    });
    request.send('{"message":"xhr hello"}');
  });

  await waitForSnapshotCounts({ connections: 1, messages: 2 });
}

export function getXmlHttpRequestCapture(): BrowseSentEventXmlHttpRequestCapture {
  const snapshot = getRuntime().engine.getSnapshot();
  const connection = snapshot.connections.find(({ protocol }) => protocol === "xhr");
  const messages = snapshot.messages
    .filter(({ protocol }) => protocol === "xhr")
    .map(({ direction, payloadPreview, type }) => ({
      direction,
      payloadPreview,
      type,
    }));

  return {
    connection: connection
      ? {
          protocol: connection.protocol,
          state: connection.state,
          metadata: connection.metadata,
        }
      : undefined,
    messages,
  };
}
```

`examples/devtools-browser-fixture/src/main.ts`의 import와 bridge에 두 함수를 추가한다.

### 단계 5: 대상 E2E 통과 확인

실행:

```bash
pnpm exec playwright test e2e/devtools-panel.spec.ts --grep "records XMLHttpRequest"
```

예상 결과:

```text
1 passed
```

### 단계 6: 기존 transport E2E 회귀 확인

실행:

```bash
pnpm test:e2e
```

예상 결과: 기존 테스트와 새 XHR 테스트가 모두 통과한다.

### 단계 7: 예제 타입 검사

실행:

```bash
pnpm typecheck
```

예상 결과: exit code 0.

### 단계 8: 커밋

```bash
git add examples/devtools-browser-fixture/src/fixture-probe.ts examples/devtools-browser-fixture/src/main.ts examples/devtools-browser-fixture/vite.config.ts e2e/devtools-panel.spec.ts
git commit -m "test(e2e): 브라우저 XHR 수집 검증 추가"
```

---

## 작업 5: 사용자 문서와 Changeset 갱신

**파일:**

- 수정: `README.md:1-58`
- 수정: `docs/index.md:5-40`
- 수정: `docs/browse-sent-event-prd.md:94-110,157`
- 수정: `docs/browse-sent-event-v2.md`
- 수정: `packages/core/package.json:4-12`
- 수정: `packages/plugin-vite/package.json:4-14`
- 생성: `.changeset/<generated-name>.md`

### 단계 1: 지원 transport 표현 전수 조사

실행:

```bash
rg -n "WebSocket, fetch|WebSocket/fetch|fetch ReadableStream|EventSource의|eventsource.*fetch.*websocket" README.md docs packages/core/package.json packages/plugin-vite/package.json
```

목적:

- 현재 상태를 설명하는 문서만 갱신한다.
- 과거 시점의 구현 계획 예시는 역사 기록으로 유지한다.
- PRD와 v2 문서의 현재 protocol union과 Phase 1 scope는 XHR을 포함하도록 바꾼다.

### 단계 2: README와 docs index 갱신

다음 현재 상태 표현에 `XMLHttpRequest`를 추가한다.

```text
WebSocket, fetch ReadableStream, EventSource, XMLHttpRequest
```

`docs/index.md`의 최근 구현 계획 맨 위에 다음 링크를 추가한다.

```md
- [XMLHttpRequest 인터셉터 설계](./plans/2026-07-23-xhr-interceptor-design.md)
- [XMLHttpRequest 인터셉터 구현 계획](./plans/2026-07-23-xhr-interceptor.md)
```

### 단계 3: PRD와 v2 범위 갱신

PRD F1 아래에 추가한다.

```md
**F1.4 XMLHttpRequest 인터셉트**

- `window.XMLHttpRequest` 생성자를 Proxy로 래핑
- 각 `send()`의 요청 body와 최종 응답을 기록
- `load`, HTTP status, network error, abort, timeout을 구분
- 요청 header와 progress chunk는 초기 범위에서 제외
```

protocol filter와 공개 타입 예시의 union에 `"xhr"`를 추가한다.

v2 문서의 transport 설명에는 XHR을 별도 항목으로 추가하고 Axios 기본 브라우저 어댑터를 지원하는 이유를 한 문단으로 제한한다. 장기 제품 설명 전체를 Axios 중심으로 바꾸지 않는다.

### 단계 4: Package metadata 갱신

`packages/core/package.json`:

```json
{
  "description": "Core runtime for observing WebSocket, fetch stream, EventSource, and XMLHttpRequest traffic in browser dev builds.",
  "keywords": ["devtools", "eventsource", "fetch", "realtime", "stream", "websocket", "xhr"]
}
```

`packages/plugin-vite/package.json` keywords에도 `"xhr"`를 추가한다. plugin description은 역할이 injection이므로 그대로 유지한다.

### 단계 5: Changeset 생성

사용자에게 보이는 backward-compatible runtime feature이고 plugin을 통해 자동 주입되므로 두 패키지에 minor changeset을 남긴다.

`.changeset/<generated-name>.md`:

```md
---
"@browse-sent-event/core": minor
"@browse-sent-event/plugin-vite": minor
---

XMLHttpRequest 기반 요청과 최종 응답 수집을 추가해 Axios 기본 브라우저 어댑터와 XHR 기반 HTTP 클라이언트를 관찰합니다.
```

대화형 `pnpm changeset` 대신 파일을 직접 작성해 package와 bump 종류를 명시적으로 검토한다.

### 단계 6: 문서와 changeset 검증

실행:

```bash
pnpm format:check
pnpm docs:build
pnpm changeset status
```

예상 결과:

- format 검사 통과
- VitePress build exit code 0
- core와 plugin-vite의 minor release가 표시됨

### 단계 7: 커밋

실제 `rg` 결과에 따라 바뀐 파일만 명시적으로 stage한다.

```bash
git add README.md docs/index.md docs/browse-sent-event-prd.md docs/browse-sent-event-v2.md packages/core/package.json packages/plugin-vite/package.json .changeset
git commit -m "docs(core): XHR 지원 범위 반영"
```

---

## 작업 6: 전체 검증과 완료 판단

**파일:**

- 수정 없음
- 실패 시 원인에 해당하는 파일만 수정하고 별도 fix commit 생성

### 단계 1: 변경 범위와 커밋 경계 확인

실행:

```bash
git status --short
git log --oneline --decorate origin/main..HEAD
git diff --stat origin/main...HEAD
```

확인:

- 의도하지 않은 파일이 없다.
- 설계, 기본 기능, 하드닝, runtime, E2E, 문서가 책임별 커밋으로 나뉜다.
- lockfile과 dependency 변경이 없다.

### 단계 2: Frozen install과 공급망 확인

실행:

```bash
corepack pnpm install --frozen-lockfile
pnpm audit --audit-level moderate
```

예상 결과:

- lockfile 변경 없음
- moderate 이상 취약점 0

네트워크 제한으로 audit가 실패하면 권한을 받아 같은 명령을 다시 실행하고, 실패를 취약점 0으로 해석하지 않는다.

### 단계 3: 정적 검증

실행:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
```

예상 결과: 모두 exit code 0.

### 단계 4: 테스트와 build

실행:

```bash
pnpm test
pnpm build
pnpm docs:build
```

예상 결과:

- core를 포함한 모든 workspace test 통과
- package build 통과
- VitePress build 통과

기존 VueUse `PURE` comment warning은 exit code 0이면 비차단 경고로 기록한다. 새로운 warning이 생기면 원인을 확인한다.

### 단계 5: Release tarball 검증

실행:

```bash
pnpm pack:check
pnpm test:release
```

예상 결과:

- core tarball에 XHR protocol 타입과 runtime 코드가 포함됨
- plugin tarball의 core dependency가 배포 가능한 형태로 변환됨
- release 검증 테스트 통과

### 단계 6: 실제 브라우저 전체 검증

실행:

```bash
pnpm test:e2e
```

예상 결과: 기존 panel, fetch stream, EventSource, WebSocket과 새 XHR 테스트가 모두 통과한다.

### 단계 7: 최종 상태 확인

실행:

```bash
git status --short --branch
git log --oneline --decorate origin/main..HEAD
```

완료 기준:

- worktree가 clean이다.
- 모든 검증 명령이 현재 HEAD에서 통과했다.
- XHR 요청/응답 수집, 오류 종료, uninstall ownership을 단위 테스트가 고정한다.
- Chromium E2E가 실제 XHR 수집을 검증한다.
- changeset과 사용자 문서가 공개 동작을 설명한다.

검증 중 수정이 필요하면 기존 커밋을 amend하지 않는다. 원인에 맞는 `fix(...)`, `test(...)`, `docs(...)` 새 커밋을 만든다.
