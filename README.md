# browse-sent-event

WebSocket, HTTP stream, EventSource의 실시간 메시지 흐름을 관찰하기 위한 프론트엔드 개발 도구.

## 상태

이 저장소는 Phase 1 transport 수집 기반 구현 단계에 있다.

## 현재 구현 상태

- Vite 개발 서버 entry bootstrap 주입
- core runtime 설치 API
- WebSocket, fetch ReadableStream, EventSource 이벤트 수집
- in-memory ring buffer, 단순 검색, JSONL/log export

아직 DevTools UI는 구현 전이다.

## Phase 1 목표

Vite 전용, main thread 전용 개발 도구를 제공하고, 실시간 transport 활동을 브라우저 DevTools 스타일 패널에서 보여준다.

## 호환성 기준

현재 개발/테스트 기준은 Vite 8.0.13이다. `packages/plugin-vite`는 Vite 공개 Plugin API만 사용하고, peer dependency 범위는 Vite 5.x부터 8.x까지로 둔다.

## 문서

- `docs/browse-sent-event-prd.md`
- `docs/browse-sent-event-adr.md`
- `docs/browse-sent-event-v2.md`

## 개발

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
```
