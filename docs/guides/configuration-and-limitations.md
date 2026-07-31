---
outline: deep
---

# 설정과 제한 사항

공개 alpha에서 권장하는 통합 방식은 Vite plugin이다. 직접 core runtime을
설치하는 방식도 제공하지만 번들 포함 여부와 초기화 순서를 애플리케이션이 직접
관리해야 한다.

## Vite plugin 설정

Vite plugin은 `enabled`와 core runtime 옵션 전체를 받는다.

```ts
import { defineConfig } from "vite";
import browseSentEvent from "@browse-sent-event/plugin-vite";

export default defineConfig({
  plugins: [
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
    }),
  ],
});
```

`enabled: false`이면 bootstrap 코드를 주입하지 않는다. plugin은 `serve` 환경에만
적용되므로 프로덕션 build에는 runtime을 포함하지 않는다.

전체 runtime 옵션 전달은 저장소의 다음 alpha 후보 기준이다. 현재 npm의
`@browse-sent-event/plugin-vite@0.1.0-alpha.1`은 `enabled`만 지원하므로 다음
alpha가 배포되기 전에는 추가 옵션이 적용되지 않는다.

## Core runtime 직접 설치

Vite plugin을 사용하지 않는 환경에서는 core package를 직접 설치하고 초기화할
수 있다.

```sh
pnpm add -D @browse-sent-event/core@alpha
```

```ts
import { installBrowseSentEvent } from "@browse-sent-event/core";

const installation = installBrowseSentEvent({
  capacity: 10_000,
  panel: {
    autoOpen: false,
    position: "bottom-right",
    hotkey: "cmd+shift+b",
  },
  filter: {
    excludeUrls: ["/health", /\/internal\/events(?:\?|$)/],
  },
});
```

개발 도구를 제거하거나 hot reload 경계를 정리할 때 반환된
`installation.uninstall()`을 호출한다. 설치 직후 호출하면 interceptor와 panel이
바로 제거된다.

| 옵션                 | 기본값           | 현재 동작                                            |
| -------------------- | ---------------- | ---------------------------------------------------- |
| `capacity`           | `10_000`         | 저장소가 보관할 최대 message 수                      |
| `panel.autoOpen`     | `false`          | 설치 직후 panel을 열지 여부                          |
| `panel.position`     | `"bottom-right"` | launcher 위치                                        |
| `panel.hotkey`       | `"cmd+shift+r"`  | 지원 문법으로 panel을 전환할 단축키                  |
| `filter.excludeUrls` | `[]`             | 모든 interceptor에서 DevTools 기록을 제외할 URL 규칙 |

애플리케이션 소스에서 core를 직접 import하면 bundler 설정에 따라 프로덕션
bundle에도 들어갈 수 있다. 개발 전용 조건부 import 또는 별도 entry를 사용하고,
최종 산출물에서 제외됐는지 확인해야 한다.

Vite plugin bootstrap은 전달받은 core 옵션으로 runtime을 먼저 설치한다. 같은
window에서 이후 `installBrowseSentEvent()`를 다시 호출해도 첫 runtime과 설정을
반환한다. Vite 설정을 바꾼 뒤에는 dev server와 page를 다시 시작해야 하며 HMR
중 runtime 설정 변경은 지원하지 않는다.

## URL 제외 filter

- 문자열은 interceptor가 기록할 URL 원문의 대소문자 구분 부분 문자열로
  비교한다.
- `RegExp`는 JavaScript 정규식 의미를 따르며 `g`와 `y` flag도 반복 호출마다
  같은 결과를 낸다.
- WebSocket, EventSource, streaming fetch와 문자열 URL을 쓰는 XHR에 같은
  규칙을 적용한다.
- 일치한 요청도 native 통신은 실행하며 DevTools connection, message와 상태
  변화만 기록하지 않는다.
- 이 filter는 network 접근 제어 또는 payload field redaction이 아니다.

민감한 payload가 포함된 endpoint를 기록 대상에 남겨 두면 filter가 내용을
가려주지 않는다. 운영 환경보다 로컬 개발과 제한된 평가 환경에서 사용한다.

## Panel 단축키

단축키는 `modifier+...+key` 형태다. `cmd`, `meta`, `ctrl`, `alt`, `shift`를
modifier로 지원하며 key는 `KeyboardEvent.key`와 대소문자 없이 비교한다.
`cmd`는 Meta 또는 Control 중 정확히 하나를 뜻한다. 지정하지 않은 modifier를
추가로 누르면 일치하지 않는다.

`cmd+shift+r`, `ctrl+alt+k`, `meta+f8`은 유효하다. modifier 중복, key 누락,
key 여러 개, `cmd+ctrl+r`과 `cmd+meta+r`은 유효하지 않다. 잘못된 설정은
keyboard listener만 비활성화하며 panel launcher와 나머지 runtime은 유지한다.

## 프로토콜별 관찰 범위

| 프로토콜        | 현재 기록 범위                                           |
| --------------- | -------------------------------------------------------- |
| WebSocket       | 연결, incoming message, `send()` outgoing message, close |
| EventSource     | 연결, open, incoming message, error와 close              |
| streaming fetch | streamed response body의 incoming chunk와 연결 상태      |
| XMLHttpRequest  | 요청과 응답 payload snapshot, 상태 변화와 완료           |

interceptor는 브라우저 main thread의 전역 API를 감싼다. Worker 내부에서 생성한
연결은 현재 관찰하지 않는다.

## XMLHttpRequest 제한

XMLHttpRequest는 native 동작을 보존하면서 안전하게 snapshot할 수 있는 범위만
기록한다.

- `open()`의 URL이 문자열일 때만 계측한다. `URL` 객체는 현재 건너뛴다.
- request header와 progress chunk는 기록하지 않는다.
- response header는 `content-type`만 기록한다.
- `GET`과 `HEAD` request body는 빈 payload로 기록한다.
- `FormData`는 field 이름만 기록하고 값은 수집하지 않는다.
- `Blob`과 `Document`는 내용 대신 metadata만 기록한다.

## 알려진 alpha 제한

| 제한                           | 영향                                                                 | 대응                                              |
| ------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------- |
| 자동 파일 다운로드 없음        | export만으로 로컬 파일이 생기지 않음                                 | `bse-export` listener에서 저장 동작 구현          |
| timeline/export 검색 범위 차이 | 문자열 payload의 100자 뒤 검색 결과가 화면과 export에서 다를 수 있음 | export 내용을 별도로 확인                         |
| connection 선택 해제 없음      | 선택 후 panel 안에서 전체 timeline으로 돌아갈 수 없음                | 페이지를 새로고침해 runtime과 panel 재설치        |
| 전체 payload 상세 UI 없음      | panel 상세 영역은 100자 preview만 표시                               | JSONL export에서 전체 문자열 payload 확인         |
| Worker 계측 미지원             | Worker 안의 transport가 panel에 나타나지 않음                        | main thread 연결로 검증하거나 별도 관찰 도구 사용 |

공개 alpha에서는 민감한 payload를 다루는 운영 환경보다 로컬 개발과 제한된
평가 환경에서 사용하는 것을 권장한다.
