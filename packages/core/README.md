# @browse-sent-event/core

WebSocket, fetch ReadableStream, EventSource, XMLHttpRequest 흐름을 브라우저 개발 환경에서 관찰하는 browse-sent-event core runtime입니다.

## 설치

```bash
pnpm add @browse-sent-event/core
```

## 역할

- 브라우저 main thread에 runtime을 설치합니다.
- WebSocket, fetch ReadableStream, EventSource, XMLHttpRequest 이벤트를 수집합니다.
- DevTools panel UI와 export 이벤트를 제공합니다.

XMLHttpRequest는 `open()`에 문자열 URL을 전달한 요청만 계측합니다. URL 객체를 전달한 요청과 요청 header, progress chunk는 수집하지 않으며 응답 header는 `content-type`만 기록합니다. GET/HEAD body는 빈 payload로 기록하고, FormData는 값 없이 제한된 field 이름만, Blob과 Document는 metadata만 요약합니다.

## 문서

공개 기술 문서는 <https://songforthemute.github.io/browse-sent-event/>에서 확인합니다.
