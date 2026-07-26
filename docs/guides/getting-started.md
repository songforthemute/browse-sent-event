---
outline: deep
---

# 시작하기

`browse-sent-event`는 브라우저에서 WebSocket, EventSource, streaming fetch,
XMLHttpRequest 흐름을 관찰하는 개발용 도구다. 현재 공개 alpha 단계이며 API와
화면 구성은 정식 릴리스 전에 바뀔 수 있다.

## 요구 사항

| 항목      | 기준                        |
| --------- | --------------------------- |
| Node.js   | `^20.19.0` 또는 `>=22.12.0` |
| Vite      | `>=5.0.0 <9.0.0`            |
| 실행 환경 | 브라우저 개발 서버          |

현재 저장소와 CI의 기준 버전은 Vite 8이다. Vite 5~7도 peer dependency 범위에는
포함되지만, 모든 조합을 같은 수준으로 검증한다는 뜻은 아니다.

## 설치

Vite 프로젝트에 플러그인을 개발 의존성으로 설치한다.

::: code-group

```sh [pnpm]
pnpm add -D @browse-sent-event/plugin-vite@alpha
```

```sh [npm]
npm install -D @browse-sent-event/plugin-vite@alpha
```

:::

`alpha` dist-tag를 명시하면 현재 공개 alpha를 설치할 수 있다. alpha 버전은
호환성이 고정되지 않았으므로 lockfile을 함께 관리하는 편이 좋다.

## Vite 설정

`vite.config.ts`의 `plugins`에 `browseSentEvent()`를 추가한다.

```ts
import { defineConfig } from "vite";
import { browseSentEvent } from "@browse-sent-event/plugin-vite";

export default defineConfig({
  plugins: [browseSentEvent()],
});
```

플러그인은 Vite 개발 서버에서만 bootstrap 코드를 주입한다. 프로덕션 빌드에는
`browse-sent-event` 런타임을 포함하지 않는다.

필요할 때만 활성화하려면 `enabled` 옵션을 사용한다.

```ts
export default defineConfig({
  plugins: [
    browseSentEvent({
      enabled: process.env.BSE_ENABLED !== "false",
    }),
  ],
});
```

## 패널 열기

개발 서버를 실행하고 애플리케이션을 브라우저에서 연다.

```sh
pnpm dev
```

화면 오른쪽 아래의 **BSE** 버튼을 누르거나 `Cmd+Shift+R`을 사용하면 패널이
열린다. Windows와 Linux에서는 `Ctrl+Shift+R`을 사용한다.

패널을 연 뒤 애플리케이션에서 실시간 연결을 만들면 connection 목록과 timeline에
기록이 나타난다. 검색, 방향 필터, 상세 정보와 내보내기 사용법은
[패널과 내보내기](./panel-and-export.md)에서 이어서 설명한다.

## 정적 예제와 실제 애플리케이션

[DevTools panel 예제](../examples/devtools-panel.md)는 서버 없이 동작하도록 샘플
connection과 message를 미리 넣은 정적 demo다. 설치한 애플리케이션에서는 실제
브라우저 transport를 interceptor가 관찰한다는 차이가 있다.

설정 범위와 프로토콜별 제약은
[설정과 제한 사항](./configuration-and-limitations.md)을 먼저 확인한다.
