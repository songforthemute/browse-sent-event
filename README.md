# browse-sent-event

WebSocket, HTTP stream, EventSource, XMLHttpRequest의 통신 흐름을 관찰하기 위한 프론트엔드 개발 도구.

## 상태

이 저장소는 Phase 1 DevTools MVP 구현 단계에 있다.

## 현재 구현 상태

- Vite 개발 서버 entry bootstrap 주입
- core runtime 설치 API
- WebSocket, fetch ReadableStream, EventSource, XMLHttpRequest 이벤트 수집
- in-memory ring buffer, 단순 검색, JSONL/log export
- Shadow DOM 기반 DevTools 패널 MVP
- 연결 목록, 메시지 타임라인, 메트릭, 검색/방향 필터
- 패널 export 이벤트와 runtime mount/unmount 연결

## 남은 정리 작업

### 릴리즈 전 필수 후보

- npm publish dry-run과 changeset 정책 확정

### 후속 회수

- UI polish와 위치 기억
- Linux CI 시각 snapshot 비교 회수
- 브라우저 검증 시나리오 확대

## Phase 1 목표

Vite 전용, main thread 전용 개발 도구를 제공하고, 실시간 transport 활동을 브라우저 DevTools 스타일 패널에서 보여준다.

## 호환성 기준

현재 개발/테스트 기준은 Vite 8.0.16과 Vitest 4.1.8이다. `packages/plugin-vite`는 Vite 공개 Plugin API만 사용하고, peer dependency 범위는 Vite 5.x부터 8.x까지로 둔다.

## 설치와 Vite 사용법

패키지 배포 후 Vite 앱에서는 plugin 패키지를 개발 의존성으로 설치한다.

```bash
pnpm add -D @browse-sent-event/plugin-vite
```

`vite.config.ts`에서 plugin을 추가한다.

```ts
import { defineConfig } from "vite";
import browseSentEvent from "@browse-sent-event/plugin-vite";

export default defineConfig({
  plugins: [browseSentEvent()],
});
```

Phase 1은 Vite 개발 서버, 브라우저 main thread, WebSocket/fetch ReadableStream/EventSource/XMLHttpRequest 수집을 우선 대상으로 한다. production build instrumentation과 browser extension 형태의 배포는 현재 범위에 포함하지 않는다.

XMLHttpRequest는 `open()`에 문자열 URL을 전달한 요청만 계측한다. URL 객체를 전달한 요청과 요청 header, progress chunk는 수집하지 않으며 응답 header는 `content-type`만 기록한다. GET/HEAD body는 빈 payload로 기록하고, FormData는 값 없이 제한된 field 이름만, Blob과 Document는 metadata만 요약한다. 이 제한과 관계없이 native 요청 동작은 그대로 보존한다.

## 문서

공개 기술 문서는 <https://songforthemute.github.io/browse-sent-event/>에서 확인한다.

- `docs/browse-sent-event-prd.md`
- `docs/browse-sent-event-adr.md`
- `docs/browse-sent-event-v2.md`

정적 기술 문서 사이트는 VitePress로 빌드한다. VitePress 1.6.4는 내부 Vite 5.x/esbuild 경로에서 audit advisory가 발생하므로, 문서 빌드 도구에 한해 VitePress 2.0.0 alpha를 사용한다. `packages/plugin-vite`의 개발/테스트 기준과 peer dependency 계약은 Vite 8.x 경로를 기준으로 유지한다.

## 개발

```bash
pnpm install
pnpm docs:build
pnpm build
pnpm test
pnpm test:e2e
pnpm typecheck
pnpm lint
pnpm format:check
```
