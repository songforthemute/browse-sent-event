---
outline: deep
---

# 설정과 제한 사항

공개 alpha에서 권장하는 통합 방식은 Vite plugin이다. 직접 core runtime을
설치하는 방식도 제공하지만 번들 포함 여부와 초기화 순서를 애플리케이션이 직접
관리해야 한다.

## Vite plugin 설정

현재 Vite plugin의 공개 옵션은 `enabled` 하나다.

```ts
import { defineConfig } from "vite";
import { browseSentEvent } from "@browse-sent-event/plugin-vite";

export default defineConfig({
  plugins: [
    browseSentEvent({
      enabled: true,
    }),
  ],
});
```

`enabled: false`이면 bootstrap 코드를 주입하지 않는다. plugin은 `serve` 환경에만
적용되므로 프로덕션 build에는 runtime을 포함하지 않는다.

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
  },
});

// 개발 환경을 종료하거나 hot reload 경계를 정리할 때 호출한다.
installation.uninstall();
```

| 옵션                 | 기본값           | 현재 동작                                        |
| -------------------- | ---------------- | ------------------------------------------------ |
| `capacity`           | `10_000`         | 저장소가 보관할 최대 message 수                  |
| `panel.autoOpen`     | `false`          | 설치 직후 panel을 열지 여부                      |
| `panel.position`     | `"bottom-right"` | launcher 위치                                    |
| `panel.hotkey`       | `"cmd+shift+r"`  | alpha에서는 기본값만 실제 matcher가 지원         |
| `filter.excludeUrls` | `[]`             | 타입에는 있으나 interceptor에 아직 적용되지 않음 |

애플리케이션 소스에서 core를 직접 import하면 bundler 설정에 따라 프로덕션
bundle에도 들어갈 수 있다. 개발 전용 조건부 import 또는 별도 entry를 사용하고,
최종 산출물에서 제외됐는지 확인해야 한다.

Vite plugin bootstrap은 core를 기본 옵션으로 먼저 설치한다. 현재 plugin은
`capacity`, panel, filter 옵션을 전달하지 않으므로 plugin과 수동 설치를 함께
사용해 설정을 덮어쓰는 방식은 지원하지 않는다.

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

| 제한                           | 영향                                            | 대응                                               |
| ------------------------------ | ----------------------------------------------- | -------------------------------------------------- |
| custom hotkey 미지원           | `panel.hotkey`에 다른 값을 넣어도 동작하지 않음 | 기본 단축키 또는 launcher 사용                     |
| `excludeUrls` 미적용           | URL 제외 설정이 실제 기록을 차단하지 않음       | 민감한 endpoint가 있는 환경에서는 사용 범위를 제한 |
| Vite plugin option 전달 미지원 | plugin 경로에서 capacity와 panel 세부 설정 불가 | `enabled`만 사용하고 후속 alpha 변경을 확인        |
| 자동 파일 다운로드 없음        | export만으로 로컬 파일이 생기지 않음            | `bse-export` listener에서 저장 동작 구현           |
| Worker 계측 미지원             | Worker 안의 transport가 panel에 나타나지 않음   | main thread 연결로 검증하거나 별도 관찰 도구 사용  |

공개 alpha에서는 민감한 payload를 다루는 운영 환경보다 로컬 개발과 제한된
평가 환경에서 사용하는 것을 권장한다.
