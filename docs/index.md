---
outline: deep
---

# browse-sent-event 기술 문서

`browse-sent-event`는 WebSocket, fetch ReadableStream, EventSource의 실시간 메시지 흐름을 브라우저 안에서 관찰하기 위한 프론트엔드 개발 도구다.

## 현재 상태

- Phase 1 DevTools MVP 구현 중
- Vite 8 기반 plugin injection
- main thread 런타임 설치와 transport event collection
- Shadow DOM DevTools panel MVP
- 연결 목록, 메시지 타임라인, 메트릭, 검색/방향 필터
- JSONL/log export event
- Playwright 기반 Chromium 브라우저 검증

## 기준 문서

- [제품 요구사항](./browse-sent-event-prd.md)
- [아키텍처 결정 기록](./browse-sent-event-adr.md)
- [v2 설계 메모](./browse-sent-event-v2.md)

## 최근 구현 계획

- [기술 문서 배포와 공급망 보안](./plans/2026-05-25-docs-site-supply-chain.md)
- [DevTools 브라우저 검증](./plans/2026-05-25-devtools-browser-verification.md)
- [DevTools UI 구현](./plans/2026-05-19-devtools-ui.md)
- [DevTools UI 배치 2](./plans/2026-05-19-devtools-ui-batch-2.md)
- [프로토콜 인터셉터 구현](./plans/2026-05-19-protocol-interceptors.md)
- [Vite 8 정렬](./plans/2026-05-18-vite-8-alignment.md)

## 개발 명령

```bash
pnpm install
pnpm docs:build
pnpm test
pnpm test:e2e
pnpm typecheck
pnpm lint
pnpm format:check
```
