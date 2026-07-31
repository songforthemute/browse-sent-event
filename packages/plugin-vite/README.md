# @browse-sent-event/plugin-vite

Vite 개발 서버 entry에 `browse-sent-event` runtime bootstrap을 주입하는
플러그인입니다. 프로덕션 build에는 적용되지 않습니다.

현재 공개 alpha이며 API는 정식 릴리스 전에 바뀔 수 있습니다.

## 설치

```bash
pnpm add -D @browse-sent-event/plugin-vite@alpha
```

`0.1.0-alpha.0`은 잘못된 내부 의존성 manifest 때문에 deprecated 처리했습니다.
새 설치에서는 `@alpha` dist-tag를 사용합니다.

## 사용

```ts
import { defineConfig } from "vite";
import browseSentEvent from "@browse-sent-event/plugin-vite";

export default defineConfig({
  plugins: [
    browseSentEvent({
      enabled: process.env.BSE_ENABLED !== "false",
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

plugin은 `enabled`와 `@browse-sent-event/core`의 모든 runtime 옵션을 받습니다.
`enabled: false`이면 bootstrap을 주입하지 않습니다. plugin은 `serve` 환경에만
적용되므로 프로덕션 build에는 runtime이 포함되지 않습니다.

문자열 `excludeUrls`는 기록될 URL 원문의 대소문자 구분 부분 문자열 일치이며,
`RegExp`도 사용할 수 있습니다. 일치한 통신은 정상 실행되고 DevTools 기록만
생략됩니다. `cmd`, `meta`, `ctrl`, `alt`, `shift` modifier와 key 하나를 조합해
panel 단축키를 설정할 수 있습니다.

전체 runtime 옵션 전달은 `0.1.0-alpha.2`부터 지원합니다. `0.1.0-alpha.1`은
`enabled`만 지원하며 나머지 옵션은 적용하지 않습니다.

peer dependency 범위는 Vite `>=5.0.0 <9.0.0`이며 저장소와 CI의 현재 기준은 Vite
8.0.16입니다. 범위 안의 모든 버전 조합을 같은 수준으로 검증한다는 뜻은
아닙니다.

## 문서

공개 기술 문서는 <https://songforthemute.github.io/browse-sent-event/>에서 확인합니다.

- [시작하기](https://songforthemute.github.io/browse-sent-event/guides/getting-started)
- [설정과 제한 사항](https://songforthemute.github.io/browse-sent-event/guides/configuration-and-limitations)
