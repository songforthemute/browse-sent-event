# XMLHttpRequest 인터셉터 설계

**목표:** Axios 기본 브라우저 어댑터를 포함한 `XMLHttpRequest` 기반 HTTP 요청의 요청 본문, 최종 응답, 종료 상태를 기존 transport 타임라인에서 관찰할 수 있게 한다.

**아키텍처:** Axios 전용 API에 결합하지 않고 `window.XMLHttpRequest` 생성자를 Proxy로 감싼다. 실제 XHR 인스턴스의 `open()`과 `send()`를 인스턴스 단위로 래핑하고 표준 lifecycle event를 관찰해, 기존 `DevtoolsEngine`에 `xhr` connection과 message를 기록한다.

**기술 스택:** TypeScript 6, Vitest 4, happy-dom, Playwright, Vite 8, pnpm workspace.

---

## 배경

현재 `browse-sent-event`는 다음 브라우저 transport를 관찰한다.

- `window.WebSocket`
- `window.fetch`
- `window.EventSource`

Axios는 브라우저 기본 어댑터에서 `new XMLHttpRequest()`, `open()`, `send()`를 사용한다. 따라서 일반적인 Axios 요청은 현재 fetch 인터셉터를 통과하지 않는다. 사용자가 Axios에 `adapter: "fetch"`를 명시하면 관찰할 수 있지만, 라이브러리 사용자가 기존 네트워크 설정을 바꿔야 한다는 점에서 근본적인 해결책은 아니다.

이 설계는 Axios 전용 interceptor를 추가하는 대신 XHR transport 자체를 관찰한다. 이 선택은 Axios뿐 아니라 XHR을 사용하는 다른 HTTP 클라이언트와 직접 작성된 XHR 요청도 같은 경로로 지원한다.

## 현재 구조

```text
Vite dev server
  -> @browse-sent-event/plugin-vite
    -> installBrowseSentEvent()
      -> installWebSocketInterceptor()
      -> installFetchStreamInterceptor()
      -> installEventSourceInterceptor()
      -> mountDevtoolsPanel()

Browser transport
  -> interceptor
    -> engine.recordConnection()
    -> engine.recordMessage()
    -> engine.updateConnection()
      -> DevTools panel / search / export
```

XHR 지원은 새로운 engine이나 Axios adapter를 만들지 않고 이 구조에 transport interceptor 하나를 추가한다.

## 목표와 비목표

### 목표

- 설치 이후 생성된 main thread XHR 요청을 관찰한다.
- 요청 method, URL, 요청 본문, 최종 응답, HTTP 상태와 종료 원인을 기록한다.
- Axios 기본 XHR 어댑터의 일반적인 JSON/text 요청을 지원한다.
- XHR 인스턴스의 identity, native 반환값, 예외, 사용자 event handler를 보존한다.
- 기존 전역 patch ownership 정책을 재사용한다.
- 실제 Chromium에서 XHR 수집 경로를 검증한다.

### 비목표

- `progress` 이벤트마다 중간 응답 청크를 기록하지 않는다.
- Axios config, interceptor, retry 횟수처럼 Axios 계층에서만 알 수 있는 정보는 기록하지 않는다.
- 요청과 응답의 전체 header를 기록하지 않는다.
- 설치 전에 생성된 XHR 인스턴스는 소급해 관찰하지 않는다.
- Web Worker의 XHR은 지원하지 않는다.
- 동기 XHR 사용을 새로 권장하거나 별도 최적화하지 않는다.

## 접근 대안

| 접근 | 장점 | 단점 | 판단 |
| --- | --- | --- | --- |
| `window.XMLHttpRequest` 생성자 Proxy | 모든 XHR 호출을 지원하고 기존 interceptor 구조와 일치한다 | 인스턴스별 lifecycle 상태 관리가 필요하다 | 선택 |
| Axios interceptor 또는 plugin | Axios config와 retry 정보에 접근할 수 있다 | Axios에 결합되고 다른 XHR 호출을 놓친다 | 후속 확장 후보 |
| `XMLHttpRequest.prototype` 직접 patch | 전역 생성자 참조를 바꾸지 않는다 | 공유 prototype 충돌과 안전한 복구가 어렵다 | 제외 |

## 제안 아키텍처

```text
installBrowseSentEvent()
  -> installXmlHttpRequestInterceptor(context)
    -> installGlobalPatch(target, "XMLHttpRequest", ...)
      -> Proxy(OriginalXMLHttpRequest)
        -> Reflect.construct(...)
          -> instrumentXmlHttpRequest(instance)

instrumented instance
  open(method, url, async, ...)
    -> native open()
    -> 성공한 요청 설정 저장

  send(body)
    -> xhr connection 생성
    -> outgoing message 기록
    -> native send()

  loadstart
    -> connection open

  load | error | abort | timeout
    -> 종료 원인 저장

  loadend
    -> 성공 응답 message 기록
    -> connection closed
```

핵심 구현 파일은 `packages/core/src/interceptors/xml-http-request.ts`다. 전역 설치와 복구는 `packages/core/src/interceptors/global-patch.ts`를 그대로 사용한다.

## 공개 이벤트 모델

`BrowseSentEventProtocol`에 `"xhr"`를 추가한다.

```ts
export type BrowseSentEventProtocol =
  | "websocket"
  | "fetch-stream"
  | "eventsource"
  | "xhr";
```

이는 runtime 데이터와 TypeScript 공개 타입의 additive 변경이다. 다만 외부 사용자가 exhaustive switch와 `never` 검사를 사용한다면 새 protocol case를 추가해야 한다. 첫 공개 배포 전인 현재 시점에는 transport 모델을 바로 확장하는 편이 별도 호환 계층을 만드는 것보다 단순하다.

### Connection

`send()` 호출 한 번을 connection 하나로 표현한다.

| 필드 | 값 |
| --- | --- |
| `protocol` | `"xhr"` |
| `url` | 성공한 마지막 `open()`에 전달된 URL |
| 초기 `state` | `"connecting"` |
| `metadata.method` | 정규화된 HTTP method |
| `metadata.async` | `open()`의 async 인자 |
| `metadata.timeout` | `send()` 시점의 timeout |
| `metadata.withCredentials` | `send()` 시점의 credential 설정 |

같은 XHR 인스턴스에 `open()`과 `send()`를 다시 호출하면 새 connection을 만든다. engine의 기존 URL/protocol 기반 reconnect 계산은 그대로 적용된다.

### Outgoing message

모든 유효한 `send()` 호출에 outgoing message 하나를 기록한다. GET이나 body가 없는 요청도 요청 자체가 타임라인에 보이도록 빈 문자열 payload를 사용한다.

```text
direction: "out"
protocol:  "xhr"
type:      "request"
metadata:  { method, bodyType }
```

### Incoming message

`load`로 성공한 요청은 `loadend`에서 최종 응답 message 하나를 기록한다. HTTP 4xx/5xx도 XHR 관점에서는 `load`이므로 incoming message를 남기고 status로 구분한다.

```text
direction: "in"
protocol:  "xhr"
type:      "response"
metadata:  { status, statusText, responseType, contentType }
```

`error`, `abort`, `timeout`은 실제 응답 payload가 없으므로 incoming message를 만들지 않고 connection metadata에 종료 원인을 기록한다.

## XHR 수명주기

### 생성

`Proxy`의 `construct` trap은 `Reflect.construct(target, args, newTarget)`으로 실제 XHR 인스턴스를 만든다. 반환값은 native 인스턴스이므로 다음 특성을 보존한다.

- `instanceof OriginalXMLHttpRequest`
- native getter와 setter의 receiver
- `XMLHttpRequest` 생성자의 static ready-state 상수
- 선행 patch가 반환한 instrumentable XHR 인스턴스

인스턴스가 `addEventListener`, `open`, `send`를 제공하지 않으면 `TypeError`를 던진다. 이는 WebSocket과 EventSource interceptor의 방어 방식과 일치한다.

### `open()`

래퍼는 native `open()`을 먼저 호출한다. native 호출이 성공한 뒤에만 method, URL, async 값을 저장하고 이전 요청 상태를 초기화한다.

이 순서는 잘못된 method, URL, 동기 XHR 제한 등 native validation 결과를 그대로 보존한다. `open()`이 예외를 던지면 connection이나 message를 기록하지 않는다.

### `send()`

래퍼는 성공한 `open()` 설정이 있고 해당 `open()` 이후 첫 `send()`일 때만 관찰을 시작한다.

1. connection을 `connecting`으로 생성한다.
2. 요청 body를 앱에서 소비하지 않는 방식으로 변환한다.
3. outgoing message를 기록한다.
4. native `send()`를 원래 인자와 함께 호출한다.

connection을 native `send()`보다 먼저 만들어야 동기 XHR이나 즉시 발생하는 `loadstart` 이벤트도 연결할 수 있다. native `send()`가 예외를 던지면 connection을 `closed`로 전환하고 `outcome: "send-threw"`를 남긴 뒤 같은 예외를 다시 던진다.

같은 `open()`에 두 번째 `send()`가 호출되면 새 record를 만들지 않고 native 메서드에 위임해 원래의 `InvalidStateError`를 보존한다.

### 종료 event

인터셉터는 `onloadend` 같은 event handler property를 덮어쓰지 않고 `addEventListener()`만 사용한다.

| event | 처리 |
| --- | --- |
| `loadstart` | connection을 `open`으로 전환 |
| `load` | `outcome: "load"` 저장 |
| `error` | `outcome: "error"` 저장 |
| `abort` | `outcome: "abort"` 저장 |
| `timeout` | `outcome: "timeout"` 저장 |
| `loadend` | 성공 응답 기록 후 connection 종료 |

`loadend`는 성공과 실패를 모두 포괄한다. 종료 metadata에는 가능한 범위에서 다음 값을 저장한다.

```text
outcome
status
statusText
responseURL
responseType
contentType
```

## Payload 변환

관찰을 위해 body를 소비하거나 native 객체를 변경하지 않는다.

### 요청

| body | 기록 |
| --- | --- |
| `null`, `undefined` | 빈 문자열 |
| `string` | 원문 문자열 |
| `URLSearchParams` | `toString()` 결과 |
| `ArrayBuffer` | 복사한 `ArrayBuffer` |
| typed array, `DataView` | 해당 byte range를 복사한 `ArrayBuffer` |
| `Blob` | type과 size를 포함한 요약 문자열 |
| `FormData` | 값은 펼치지 않고 entry 수와 field 이름을 요약 |
| `Document` | document type 중심의 요약 문자열 |
| 기타 | 안전한 문자열 변환 결과 |

`FormData`와 `Blob`을 실제 wire format으로 재직렬화하지 않는다. 브라우저가 생성하는 multipart boundary와 binary body를 정확히 복제하려면 추가 비용과 민감 정보 노출이 생기기 때문이다.

### 응답

| `responseType` | 기록 |
| --- | --- |
| `""`, `"text"` | `responseText` |
| `"arraybuffer"` | 복사한 `ArrayBuffer` |
| `"json"` | 안전하게 직렬화한 `response` |
| `"blob"` | type과 size를 포함한 요약 문자열 |
| `"document"` | document type 중심의 요약 문자열 |

Axios의 일반적인 JSON 응답은 XHR에 `responseType: "json"`을 설정하지 않고 `responseText`를 읽은 뒤 Axios 계층에서 파싱한다. 따라서 빈 response type의 text 경로가 Axios JSON 응답을 원문 그대로 포착한다.

## 오류 격리

인터셉터의 목적은 관찰이며 앱 요청의 성공 여부를 바꾸면 안 된다.

- native `open()`과 `send()`의 반환값과 예외를 그대로 보존한다.
- payload 요약이나 metadata 읽기가 실패하면 fallback 문자열 또는 `captureError`를 사용한다.
- `responseText`는 `responseType`이 빈 문자열 또는 `text`일 때만 읽는다.
- observer 내부 오류는 사용자 event handler 실행을 막지 않는다.
- 실패한 관찰을 위해 response body를 다시 요청하거나 소비하지 않는다.

native `send()` 자체가 던진 예외는 삼키지 않는다. 관찰 실패와 앱 transport 실패를 구분한다.

## 전역 patch 공존

XHR 생성자 patch는 기존 `installGlobalPatch()`의 정책을 따른다.

```text
설치:
  original = target.XMLHttpRequest
  replacement = Proxy(original)
  target.XMLHttpRequest = replacement

제거:
  if target.XMLHttpRequest === replacement:
    target.XMLHttpRequest = original
  else:
    후행 patch를 보존
```

선행 patch는 captured original로 취급하므로 그 위에 BSE가 설치된다. 후행 patch가 전역 생성자를 바꾸면 BSE uninstall은 이를 덮어쓰지 않는다.

uninstall 전에 생성된 XHR 인스턴스에는 이미 event listener와 instance method wrapper가 있으므로 해당 요청이 끝날 때까지 관찰이 계속될 수 있다. 강제로 제거하려면 모든 활성 인스턴스를 추적해야 하고 앱 lifecycle을 방해할 수 있으므로 현재 정책은 새 인스턴스 생성을 막는 범위로 제한한다.

## 보안과 개인정보

XHR 관찰은 요청과 응답 payload를 메모리에 저장하므로 기존 transport와 같은 민감 정보 취급이 필요하다.

- 요청 header 전체를 수집하지 않는다.
- `Authorization`, cookie와 같은 credential을 별도 metadata로 복사하지 않는다.
- `FormData`의 값은 기본적으로 펼치지 않는다.
- 응답 header는 전체 문자열 대신 CORS로 노출된 `content-type`만 읽는다.
- 기존 ring buffer capacity와 clear/export 정책을 그대로 적용한다.

향후 header 관찰을 추가하려면 allowlist 또는 redaction 정책을 먼저 설계해야 한다.

## 파일 경계

| 파일 | 변경 |
| --- | --- |
| `packages/core/src/runtime/events.ts` | `"xhr"` protocol 추가 |
| `packages/core/src/interceptors/xml-http-request.ts` | XHR 생성자와 lifecycle 관찰 구현 |
| `packages/core/src/interceptors/__tests__/xml-http-request.test.ts` | interceptor 단위 테스트 |
| `packages/core/src/runtime/install.ts` | XHR interceptor 설치와 제거 연결 |
| `packages/core/src/runtime/__tests__/install.test.ts` | runtime 통합과 복구 검증 |
| `examples/devtools-browser-fixture/src/fixture-probe.ts` | 실제 XHR 실행 probe |
| `examples/devtools-browser-fixture/vite.config.ts` | XHR 응답 endpoint |
| `examples/devtools-browser-fixture/src/main.ts` | fixture bridge 노출 |
| `e2e/devtools-panel.spec.ts` | Chromium XHR 수집 검증 |
| 관련 README와 docs | 지원 transport와 제한 갱신 |

UI는 protocol 문자열을 일반적으로 렌더링하므로 XHR 전용 컴포넌트를 추가하지 않는다.

## 검증 전략

### 단위 테스트

- text GET 요청의 빈 outgoing payload와 incoming response
- string POST body
- `URLSearchParams`, `ArrayBuffer`, typed array 요청 body
- text, JSON, ArrayBuffer, Blob 응답
- HTTP 4xx/5xx 응답
- `error`, `abort`, `timeout`
- native `open()`과 `send()` 예외 보존
- 동일 XHR 인스턴스 재사용
- 동일 `open()`에 대한 중복 `send()`
- `instanceof`와 static 상수 보존
- interceptor uninstall과 후행 patch 보존

### Runtime 테스트

- `installBrowseSentEvent()`가 XHR 생성자를 한 번만 patch한다.
- `runtime.uninstall()`이 현재 소유한 XHR patch를 복구한다.
- 재설치 시 새 runtime과 새 interceptor를 만든다.

### 브라우저 E2E

Chromium fixture에서 native XHR로 JSON POST 요청을 실행한다.

```text
POST /__bse-fixture/xhr
  request:  {"message":"xhr hello"}
  response: {"message":"xhr goodbye"}
```

engine snapshot에서 다음을 확인한다.

- protocol이 `xhr`인 connection 하나
- outgoing request message 하나
- incoming response message 하나
- method `POST`
- status `200`
- request와 response payload preview

Axios를 fixture dependency로 추가하지 않는다. 표준 XHR 호출을 실제 브라우저에서 검증하면 Axios가 의존하는 transport 계약을 직접 검증할 수 있고, 테스트 전용 공급망과 버전 유지 비용을 늘리지 않는다.

## 의식적 부채

| 부채 | 지금 포기하는 것 | 지금 감당 가능한 이유 | 회수 시점 |
| --- | --- | --- | --- |
| XHR progress 미수집 | streaming XHR의 중간 응답 관찰 | 목표는 Axios 기본 요청의 최종 응답이며 브라우저별 부분 `responseText` 차이를 피할 수 있다 | 실제 streaming XHR 사례나 사용자 요구가 확인될 때 |
| 요청 header 미수집 | header 기반 디버깅 | 인증 정보 노출 위험이 payload보다 높다 | redaction/allowlist 정책을 설계할 때 |
| FormData 값 요약 | multipart field value 확인 | 파일과 credential을 무분별하게 복제하지 않는다 | opt-in 민감 정보 정책이 생길 때 |
| 활성 인스턴스 강제 해제 없음 | uninstall 즉시 모든 관찰 listener 제거 | 활성 요청 추적과 method 복구가 앱 동작을 흔들 수 있다 | 장기 실행 앱에서 실제 누수 증거가 확인될 때 |
| Worker XHR 미지원 | worker 내부 HTTP 요청 관찰 | 현재 bootstrap과 runtime이 main thread 전용이다 | Worker bootstrap을 설계할 때 |
| Axios 전용 metadata 미지원 | config, retry, interceptor 단계 관찰 | transport 지원만으로 Axios 기본 호환 목표를 달성한다 | causality가 Axios 계층까지 확장될 때 |

## 완료 기준

- `BrowseSentEventProtocol`이 `"xhr"`를 포함한다.
- 설치 이후 생성된 XHR의 요청과 최종 응답이 engine에 기록된다.
- 성공, HTTP 오류 상태, network error, abort, timeout이 구분된다.
- Axios 기본 JSON 요청에 해당하는 빈 response type의 text 응답이 기록된다.
- native identity, event handler, 반환값과 예외가 보존된다.
- uninstall이 후행 전역 patch를 덮어쓰지 않는다.
- Chromium E2E에서 실제 XHR request/response를 검증한다.
- format, lint, typecheck, unit test, build, docs build, Playwright E2E가 통과한다.

## 참고 자료

- [WHATWG XMLHttpRequest Standard](https://xhr.spec.whatwg.org/)
- [Axios XHR adapter](https://github.com/axios/axios/blob/v1.x/lib/adapters/xhr.js)
- [Axios defaults](https://github.com/axios/axios/blob/v1.x/lib/defaults/index.js)
