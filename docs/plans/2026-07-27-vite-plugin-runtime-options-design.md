# Vite plugin runtime 옵션 설계

**작성일:** 2026-07-27
**상태:** 승인됨

## 배경

공개 alpha의 Vite plugin은 `enabled`만 받으며 virtual bootstrap에서
`installBrowseSentEvent()`를 기본 옵션으로 호출한다. 반면 core의 공개
`BrowseSentEventOptions`에는 `capacity`, panel 설정과 URL 제외 필터가 이미
선언돼 있다.

이 차이 때문에 Vite plugin 사용자는 core가 제공하는 설정을 전달할 수 없다.
plugin bootstrap이 먼저 runtime을 설치하면 이후 애플리케이션 코드에서
`installBrowseSentEvent(options)`를 호출해도 첫 설치가 가진 기본 설정이
유지된다. 또한 `panel.hotkey`는 기본값 외 문자열을 받지만 matcher가
`cmd+shift+r`만 인식하고, `filter.excludeUrls`는 resolve만 될 뿐 interceptor에
전달되지 않는다.

이번 설계는 세 문제를 하나의 공개 옵션 계약으로 정렬한다.

1. Vite plugin에서 core runtime 옵션을 전달한다.
2. 공개 타입에 있는 custom hotkey를 실제로 해석한다.
3. URL 제외 필터를 모든 interceptor에 같은 의미로 적용한다.

## 목표

- `BrowseSentEventOptions`를 core와 Vite plugin 설정의 SSOT로 사용한다.
- plugin의 Node 설정을 안전하고 결정적인 browser module 코드로 변환한다.
- 문자열과 `RegExp` URL 필터를 WebSocket, EventSource, streaming fetch,
  XMLHttpRequest에 같은 의미로 적용한다.
- custom hotkey 문자열의 지원 문법과 실패 동작을 명확히 정의한다.
- 제외된 통신과 잘못된 설정 때문에 애플리케이션의 native 동작이 바뀌지 않게
  한다.
- 타입, runtime, package README와 사용자 가이드가 같은 동작을 설명하게 한다.

## 비목표

- 설치된 runtime의 옵션을 HMR 중 동적으로 바꾸지 않는다.
- production build에 runtime을 주입하지 않는다.
- Worker 내부 transport를 계측하지 않는다.
- URL을 절대 URL로 정규화하거나 URL pattern 문법을 새로 정의하지 않는다.
- request 또는 response payload의 field 단위 redaction을 구현하지 않는다.
- plugin 전용 transport descriptor를 core 공개 API에 추가하지 않는다.
- 모든 가능한 키보드 layout을 추상화하는 단축키 시스템을 만들지 않는다.

## 접근법 비교

### JSON 직렬화

옵션 전체를 `JSON.stringify()`로 직렬화하면 구현은 단순하지만 `RegExp`가 빈
객체로 바뀐다. plugin과 core가 같은 공개 옵션을 지원해야 한다는 목표를
충족하지 못하므로 채택하지 않는다.

### 스키마 기반 코드 생성

plugin이 알고 있는 작은 옵션 스키마를 따라 일반 값은 JSON으로 직렬화하고
`RegExp`만 `source`와 `flags`로 분해해 `new RegExp()` 식을 생성한다. core의
공개 API를 늘리지 않고도 기존 옵션을 그대로 복원할 수 있다.

현재 옵션 구조가 작고 변경 빈도가 낮으며 생성 코드의 모든 분기를 unit test로
고정할 수 있으므로 이 방식을 채택한다.

### 별도 descriptor와 hydration API

Node 설정을 JSON-safe descriptor로 바꾸고 browser에서 전용 hydration 함수로
복원할 수 있다. 옵션 종류가 많아지면 확장에는 유리하지만, 현재는 전송 전용
타입과 browser runtime entry를 core 또는 plugin package에 추가해야 한다.
사용자 API와 package export가 전송 세부사항을 알게 되는 비용이 더 크므로
도입하지 않는다.

## 전체 구조

```text
vite.config.ts
    |
    v
BrowseSentEventVitePluginOptions
    |
    | enabled 소비 + core 옵션 스키마 기반 직렬화
    v
virtual:browse-sent-event/bootstrap
    |
    | installBrowseSentEvent(options)
    v
resolveOptions()
    +-------------------------+
    |                         |
    v                         v
createUrlFilter()         panel 설정
    |                     위치 / 자동 열기 / 단축키
    v
WebSocket / EventSource / fetch / XHR
```

## 공개 옵션 경계

`BrowseSentEventVitePluginOptions`는 core의 `BrowseSentEventOptions`를
확장하고 plugin 고유 옵션인 `enabled`만 추가한다.

```ts
import type { BrowseSentEventOptions } from "@browse-sent-event/core";

export interface BrowseSentEventVitePluginOptions extends BrowseSentEventOptions {
  readonly enabled?: boolean;
}
```

plugin은 `enabled`를 설치 여부 판단에만 사용한다. bootstrap 생성에는
`capacity`, `panel`, `filter`만 전달한다. core의 공개 타입이 바뀌면 plugin의
상위 타입도 즉시 따라가지만, 직렬화 스키마와 테스트도 의도적으로 수정해야 한다.

다음 사용법을 지원한다.

```ts
browseSentEvent({
  enabled: true,
  capacity: 5_000,
  panel: {
    autoOpen: true,
    position: "bottom-left",
    hotkey: "cmd+shift+b",
  },
  filter: {
    excludeUrls: ["/health", /\/internal\/events(?:\?|$)/],
  },
});
```

## Bootstrap 직렬화

`createBootstrapModuleCode()`가 core 옵션을 입력받고 다음 원칙으로 JavaScript
module source를 생성한다.

- number, boolean, string과 일반 object 구조는 `JSON.stringify()`를 사용한다.
- `undefined`인 property는 생성 코드에서 생략한다.
- 정규식은 `source`와 `flags`를 각각 `JSON.stringify()`한 뒤
  `new RegExp(source, flags)`로 복원한다.
- 문자열을 JavaScript source에 직접 이어 붙이지 않는다.
- `eval`, `Function` constructor 또는 함수 직렬화를 사용하지 않는다.
- `enabled`는 생성 코드에 포함하지 않는다.

정규식 literal이 아니라 constructor를 사용하면 `/`, 줄바꿈, quote와 Unicode
문자를 별도 escape 규칙 없이 JSON 문자열 규칙으로 처리할 수 있다. 생성된
module은 `@browse-sent-event/core`에서 `installBrowseSentEvent`를 import하고
복원한 옵션을 첫 호출에 전달한다.

기존 `apply: "serve"`와 HTML entry transform 경계는 유지한다. production
build에서는 virtual bootstrap import가 추가되지 않는다.

## 설치 불변성

`installBrowseSentEvent()`는 같은 window에서 첫 설치가 가진 runtime을 계속
반환한다. plugin 옵션 전달을 위해 이 규칙을 바꾸지 않는다.

- 같은 module graph에서 bootstrap이 여러 번 참조돼도 ESM module은 한 번
  평가된다.
- 애플리케이션 코드가 다시 설치를 요청해도 runtime과 옵션은 바뀌지 않는다.
- Vite 설정 변경은 dev server 재시작과 page reload 이후 새 runtime에 반영한다.
- uninstall 뒤 재설치하는 명시적 흐름은 기존처럼 새 옵션을 받을 수 있다.

capacity 변경과 interceptor 재설치는 기존 message와 connection 상태를 어떻게
이전할지 별도 규칙이 필요하다. 이번 작업에서 live reconfiguration을 암묵적으로
도입하지 않는다.

## URL 제외 판정

core에 URL 판정 책임을 한곳으로 모으는 `createUrlFilter()`를 둔다. 설치 시
resolved `excludeUrls`로 matcher를 한 번 만들고, interceptor context에는
원본 설정 대신 다음 predicate를 전달한다.

```ts
shouldExcludeUrl(url: string): boolean;
```

문자열 pattern은 interceptor가 기록할 URL 원문에 대한 대소문자 구분 부분
문자열 일치로 정의한다. 예를 들어 `"/health"`는
`"https://example.test/health?ready=1"`을 제외한다.

`RegExp` pattern은 JavaScript `RegExp.test()` 의미를 따른다. 설치 시
`source`와 `flags`로 새 정규식을 만들어 호출자가 보유한 객체와 상태를
분리한다. `g` 또는 `y` flag가 반복 판정 결과를 바꾸지 않도록 각 검사 전후에
`lastIndex`를 `0`으로 되돌린다.

matcher 내부의 관찰 실패는 제외하지 않는 결과로 처리한다. 필터 판정 실패가
native transport 호출이나 애플리케이션 이벤트 흐름을 중단해서는 안 된다.

## Interceptor 적용

URL 필터는 네트워크 접근 제어가 아니라 DevTools 관찰 제외 기능이다. 일치한
요청도 native API에는 그대로 전달하며 connection, message와 상태 변화만
기록하지 않는다.

| Interceptor | URL | 필터 적용 시점 | 제외 시 동작 |
| --- | --- | --- | --- |
| WebSocket | constructor 첫 인자의 문자열 표현 | native 생성 성공 후, listener와 `send()` 계측 전 | 원본 socket을 그대로 반환 |
| EventSource | constructor 첫 인자의 문자열 표현 | native 생성 성공 후, listener와 `close()` 계측 전 | 원본 source를 그대로 반환 |
| streaming fetch | 기존 `getRequestUrl(input)` 결과 | native 응답 수신 후, body clone과 기록 전 | 원본 response를 그대로 반환 |
| XMLHttpRequest | 문자열 `open()` URL | `send()`에서 connection과 payload 기록 전 | 원본 `send()`만 실행 |

native 호출보다 먼저 URL을 강제 변환하지 않는다. 기존 호출이 던지는 순서와
값 변환 부수 효과를 보존하기 위해서다. XHR은 현재와 같이 문자열 URL만
계측하므로 `URL` 객체 지원 확대는 별도 작업으로 남긴다.

## 단축키 문법

custom hotkey는 `modifier+...+key` 형식으로 해석한다.

| 토큰 | 의미 |
| --- | --- |
| `cmd` | 기존 호환성을 위한 portable primary modifier, `Meta` 또는 `Control` |
| `meta` | `KeyboardEvent.metaKey` |
| `ctrl` | `KeyboardEvent.ctrlKey` |
| `alt` | `KeyboardEvent.altKey` |
| `shift` | `KeyboardEvent.shiftKey` |
| 그 밖의 단일 토큰 | `KeyboardEvent.key`와 대소문자 없이 비교할 key |

- 토큰의 대소문자, 순서와 바깥 공백은 무시한다.
- modifier는 중복할 수 없고 key는 정확히 하나여야 한다.
- 설정하지 않은 modifier가 추가로 눌리면 일치하지 않는다.
- `cmd+meta`, `cmd+ctrl`처럼 portable modifier와 구체 modifier를 함께 쓴
  조합은 모호하므로 유효하지 않다.
- `cmd+shift+r`, `ctrl+alt+k`, `meta+f8`을 지원 예로 삼는다.

parser는 설치 시 한 번 hotkey descriptor를 만든다. 문법이 잘못되면 keyboard
listener만 활성화하지 않고 launcher와 panel은 정상 mount한다. 개발 도구 설정
오류가 애플리케이션 entry 평가를 막아서는 안 된다.

## 오류 격리

- 필터가 제외한 transport는 계측용 listener 또는 method wrapper를 붙이지
  않는다.
- URL 판정 실패는 해당 transport를 기록하는 쪽으로 안전하게 퇴행한다.
- custom hotkey parsing 실패는 단축키만 비활성화한다.
- plugin 직렬화는 지원된 공개 옵션만 처리하고 임의 실행 가능한 값을 받지
  않는다.
- runtime과 interceptor가 가진 기존의 "관찰 실패가 애플리케이션 흐름을
  중단하지 않는다"는 원칙을 유지한다.

## 테스트 전략

### Plugin

- `BrowseSentEventVitePluginOptions`가 core 옵션을 받는 typecheck fixture
- `enabled: false`일 때 기존처럼 주입하지 않는 회귀 테스트
- 생략값, 중첩 panel 설정과 capacity 직렬화
- quote, slash, 줄바꿈과 Unicode가 든 문자열의 안전한 직렬화
- 정규식 source와 flags의 복원
- 생성된 bootstrap에 `enabled`가 포함되지 않는지 확인
- production build 경계가 유지되는지 확인

### URL filter

- 빈 목록과 일치하지 않는 문자열
- 부분 문자열의 대소문자 구분 일치
- 정규식 flag와 반복 호출
- `g`, `y` 정규식의 결정적인 결과
- 호출자가 전달한 정규식의 `lastIndex` 불변
- matcher 관찰 실패 격리

### Interceptor

- WebSocket과 EventSource가 제외 URL에서 native instance를 그대로 반환하고
  engine에 기록하거나 method를 덮지 않는지 확인
- fetch가 제외 URL에서 response body를 clone하지 않고 원본 response를
  반환하는지 확인
- XHR이 제외 URL에서도 `open()`과 `send()`를 실행하지만 request와 response를
  기록하지 않는지 확인
- 포함 URL의 기존 connection, message와 상태 변화 회귀 테스트

### Panel

- 기본 `cmd+shift+r` 호환성
- `cmd`, `meta`, `ctrl`, `alt`, `shift` 조합
- 대소문자와 토큰 순서
- 선언하지 않은 추가 modifier
- modifier 중복, key 누락, key 중복과 모호한 조합
- 잘못된 hotkey에서도 panel mount와 launcher 사용 가능

### 통합 검증

- lint, typecheck, unit test와 package build
- plugin이 생성한 bootstrap 코드의 parse 및 실행 계약
- package tarball에 예상 export와 dependency range만 포함되는지 확인
- VitePress build와 문서 내부 link
- `git diff --check`

## 문서 갱신

실제 동작을 설명하는 다음 문서를 같은 기능 PR에서 갱신한다.

- `README.md`
- `packages/core/README.md`
- `packages/plugin-vite/README.md`
- `docs/guides/configuration-and-limitations.md`
- `docs/release/github-release.md`

문서에는 Vite plugin 전체 옵션 예제, 단축키 문법, 문자열과 정규식 URL 필터
의미, 첫 설치 우선 규칙과 page reload 요구사항을 포함한다. URL 제외는 payload
redaction이나 network 차단이 아니며, 포함된 endpoint의 민감한 payload를
보호하지 않는다는 점도 명시한다.

과거 구현 계획은 당시 기록이므로 본문을 다시 쓰지 않는다. 계획 인덱스에서
이번 설계와 구현 계획을 현재 후속 작업으로 연결한다.

## 의식적인 부채

### 명시적 serializer 유지

- 포기하는 것: core 옵션이 추가돼도 plugin 생성 코드가 자동으로 모든 값을
  직렬화하지 않는다.
- 지금 감당 가능한 이유: 공개 옵션 구조가 작고, 지원 schema를 명시하는 편이
  임의 값 직렬화보다 안전하며 모든 분기를 unit test로 고정할 수 있다.
- 회수 시점: 옵션에 callback, class instance 또는 세 번째 비 JSON 자료형이
  추가될 때 descriptor와 hydration API 도입을 다시 검토한다.

### HMR live reconfiguration 미지원

- 포기하는 것: 설정 파일을 바꾼 뒤 기존 page runtime의 capacity, panel과
  interceptor 옵션을 즉시 갱신하지 않는다.
- 지금 감당 가능한 이유: Vite 설정 변경은 일반적으로 dev server restart와
  page reload를 동반하며, 상태 이전 없는 재설치는 디버깅 기록을 잃게 한다.
- 회수 시점: runtime lifecycle과 상태 이전 계약을 별도 공개 API로 설계할 때
  다룬다.

### 사용자 정규식 실행 비용

- 포기하는 것: 병적인 backtracking을 일으키는 사용자 정규식의 실행 시간을
  별도 제한하지 않는다.
- 지금 감당 가능한 이유: filter는 개발자가 직접 작성하는 개발 서버 설정이며
  production 자동 주입 경로에는 포함되지 않는다.
- 회수 시점: 외부 입력으로 filter를 구성하거나 pattern 편집 UI를 제공할 때
  안전한 pattern 제한 또는 실행 격리를 도입한다.

### XHR URL 객체 제외

- 포기하는 것: `XMLHttpRequest.open()`에 `URL` 객체를 전달한 호출은 기존처럼
  계측과 필터 적용 대상이 아니다.
- 지금 감당 가능한 이유: 이번 작업은 공개 필터 계약을 현재 계측 범위에
  연결하는 것이며, XHR의 native 변환 순서 보존은 별도 호환성 검증이 필요하다.
- 회수 시점: XHR URL 입력 범위를 확대하는 기능에서 native conversion과
  reentrancy 테스트를 추가한다.

## 완료 조건

- Vite plugin에서 모든 기존 core runtime 옵션을 전달할 수 있다.
- 문자열과 정규식 URL 제외가 네 interceptor에서 같은 의미로 동작한다.
- custom hotkey가 정의된 문법대로 작동하고 잘못된 값이 앱을 중단하지 않는다.
- 포함 URL의 기존 계측 동작과 production build 제외 계약이 유지된다.
- 사용자 문서가 제거된 alpha 제한을 더 이상 미지원으로 표시하지 않는다.
- 구현 계획의 자동 검증과 수동 browser 검증이 모두 통과한다.
