# @browse-sent-event/core

WebSocket, fetch ReadableStream, EventSource, XMLHttpRequest 흐름을 브라우저 개발
환경에서 관찰하는 `browse-sent-event` core runtime입니다. 현재 공개 alpha이며
API는 정식 릴리스 전에 바뀔 수 있습니다.

## 설치

```bash
pnpm add -D @browse-sent-event/core@alpha
```

Vite 프로젝트에는 core를 직접 설치하기보다
`@browse-sent-event/plugin-vite@alpha` 사용을 권장합니다. plugin은 개발 서버에만
runtime을 주입하므로 프로덕션 build에서 자동으로 제외됩니다.

## 사용

```ts
import { installBrowseSentEvent } from "@browse-sent-event/core";

const installation = installBrowseSentEvent({
  capacity: 10_000,
  panel: {
    autoOpen: false,
    position: "bottom-right",
  },
});
```

개발 도구를 제거할 때 반환된 `installation.uninstall()`을 호출합니다. 설치 직후
호출하면 interceptor와 panel이 바로 제거됩니다.

애플리케이션 소스에서 직접 import하면 bundler 설정에 따라 프로덕션 bundle에
포함될 수 있습니다. 개발 전용 entry나 조건부 import를 사용하고 최종 산출물을
확인해야 합니다.

## 관찰 범위

- 브라우저 main thread에 runtime을 설치합니다.
- WebSocket, fetch ReadableStream, EventSource, XMLHttpRequest 이벤트를 수집합니다.
- DevTools panel UI와 export 이벤트를 제공합니다.

XMLHttpRequest는 `open()`에 문자열 URL을 전달한 요청만 계측합니다. URL 객체를 전달한 요청과 요청 header, progress chunk는 수집하지 않으며 응답 header는 `content-type`만 기록합니다. GET/HEAD body는 빈 payload로 기록하고, FormData는 값 없이 제한된 field 이름만, Blob과 Document는 metadata만 요약합니다.

## 문서

공개 기술 문서는 <https://songforthemute.github.io/browse-sent-event/>에서 확인합니다.

- [시작하기](https://songforthemute.github.io/browse-sent-event/guides/getting-started)
- [설정과 제한 사항](https://songforthemute.github.io/browse-sent-event/guides/configuration-and-limitations)
