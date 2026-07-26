---
outline: deep
---

# browse-sent-event 기술 문서

`browse-sent-event`는 WebSocket, fetch ReadableStream, EventSource, XMLHttpRequest의 통신 흐름을 브라우저 안에서 관찰하기 위한 프론트엔드 개발 도구다.

## 현재 상태

Phase 1 DevTools MVP를 공개 alpha로 배포했다.

| package | 공개 alpha |
| --- | --- |
| `@browse-sent-event/core` | `0.1.0-alpha.0` |
| `@browse-sent-event/plugin-vite` | `0.1.0-alpha.1` |

::: warning Alpha
API와 화면 구성은 정식 릴리스 전에 바뀔 수 있다. 새 설치에서는
`@browse-sent-event/plugin-vite@alpha`를 사용한다. plugin-vite
`0.1.0-alpha.0`은 deprecated된 잘못된 배포다.
:::

## 사용자 가이드

1. [시작하기](./guides/getting-started.md)에서 Vite project에 설치한다.
2. [패널과 내보내기](./guides/panel-and-export.md)에서 timeline과 export를 익힌다.
3. [설정과 제한 사항](./guides/configuration-and-limitations.md)에서 alpha 경계를 확인한다.
4. [DevTools panel 예제](./examples/devtools-panel.md)에서 정적 demo를 직접 조작한다.

## 기준 문서

- 공개 주소: <https://songforthemute.github.io/browse-sent-event/>
- [제품 요구사항](./browse-sent-event-prd.md)
- [아키텍처 결정 기록](./browse-sent-event-adr.md)
- [v2 설계 메모](./browse-sent-event-v2.md)
- [npm 배포 가이드](./release/npm-publish.md)
- [GitHub Release 가이드](./release/github-release.md)
- [구현 계획 기록](./plans/index.md)

## 구현 범위

- Vite 개발 서버 entry bootstrap 주입과 production build 제외
- 브라우저 main thread의 WebSocket, streaming fetch, EventSource, XMLHttpRequest 관찰
- Shadow DOM DevTools panel의 연결 목록, timeline, 검색과 방향 filter
- JSONL/log export CustomEvent
- Playwright 기반 Chromium desktop/mobile 검증
- GitHub Pages 기반 기술 문서 배포

## 개발 명령

```bash
pnpm install
pnpm docs:build
pnpm test
pnpm test:e2e
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test:release
```
