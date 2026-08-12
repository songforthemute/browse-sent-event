# browse-sent-event

WebSocket, HTTP stream, EventSource, XMLHttpRequest의 통신 흐름을 관찰하기 위한 프론트엔드 개발 도구.

## 상태

Phase 1 DevTools MVP를 공개 alpha로 배포했다. 현재 npm 공개 버전은 다음과 같다.

| 패키지                           | `alpha`         | `latest`        |
| -------------------------------- | --------------- | --------------- |
| `@browse-sent-event/core`        | `0.1.0-alpha.1` | `0.1.0-alpha.0` |
| `@browse-sent-event/plugin-vite` | `0.1.0-alpha.2` | `0.1.0-alpha.1` |

`@browse-sent-event/plugin-vite@0.1.0-alpha.0`은 배포 manifest에 `workspace:*`
의존성이 남아 있어 deprecated 처리했다. 새 설치에서는 `@alpha` dist-tag를
사용한다. 이번 공개에서는 `alpha`만 새 version으로 이동했고 `latest`는 기존
version을 유지하므로, version을 생략하지 않는다.

## 현재 구현 상태

- Vite 개발 서버 entry bootstrap 주입
- core runtime 설치 API
- WebSocket, fetch ReadableStream, EventSource, XMLHttpRequest 이벤트 수집
- in-memory ring buffer, 단순 검색, JSONL/log export
- Shadow DOM 기반 DevTools 패널 MVP
- 연결 목록, 메시지 타임라인, 메트릭, 검색/방향 필터
- 패널 export 이벤트와 runtime mount/unmount 연결
- Vite plugin의 core runtime 옵션 전달
- 사용자 정의 panel 단축키와 URL 기록 제외 filter

## 다음 제품 목표

다음 우선순위는 일반 UI polish가 아니라 Message-to-UI causality의 정확도를
검증하는 것이다. 첫 수직 범위는 수신 WebSocket 메시지, 동기 handler, Zustand
상태 변경과 React commit 후보를 하나의 evidence chain으로 연결한다.

정확도를 증명하지 못한 연결은 causality로 단정하지 않는다. 먼저 truth spike에서
precision, false definitive와 관찰 비용을 검증하고, 통과할 때만 사용자-facing
diagnostic alpha로 확장한다. UI 위치 기억, Linux 시각 snapshot과 넓은 브라우저
matrix는 이 검증을 막는 release gate가 아니라 병행 또는 후속 안정화 작업으로
둔다. 자세한 실행 기준은 [Causality Truth Spike 제품 재계획과
설계](./docs/plans/2026-08-12-causality-truth-spike-design.md)를 따른다.

## Phase 1 목표

Vite 전용, main thread 전용 개발 도구를 제공하고, 실시간 transport 활동을 브라우저 DevTools 스타일 패널에서 보여준다.

## 호환성 기준

현재 개발/테스트 기준은 Vite 8.0.16과 Vitest 4.1.8이다.
`packages/plugin-vite`는 Vite 공개 Plugin API만 사용하고, peer dependency 범위는
Vite 5.x부터 8.x까지로 둔다. 이 범위가 모든 Vite 버전 조합을 같은 수준으로
검증한다는 의미는 아니다.

## 설치와 Vite 사용법

Vite 앱에서는 plugin 패키지의 공개 alpha를 개발 의존성으로 설치한다.

```bash
pnpm add -D @browse-sent-event/plugin-vite@alpha
```

`vite.config.ts`에서 plugin을 추가한다.

```ts
import { defineConfig } from "vite";
import browseSentEvent from "@browse-sent-event/plugin-vite";

export default defineConfig({
  plugins: [
    browseSentEvent({
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

전체 runtime 옵션 전달은 현재 공개된
`@browse-sent-event/plugin-vite@0.1.0-alpha.2`부터 지원한다.
`0.1.0-alpha.1`은 `enabled`만 지원하며 위 추가 옵션은 적용하지 않는다.

문자열 URL filter는 기록될 URL 원문에 대한 대소문자 구분 부분 문자열
일치이고, 정규식은 JavaScript `RegExp` 의미를 따른다. 일치한 요청도 native
통신은 실행되며 DevTools 기록만 생략된다. filter는 network 차단이나 payload
redaction 기능이 아니다.

Phase 1은 Vite 개발 서버, 브라우저 main thread, WebSocket/fetch ReadableStream/EventSource/XMLHttpRequest 수집을 우선 대상으로 한다. production build instrumentation과 browser extension 형태의 배포는 현재 범위에 포함하지 않는다.

XMLHttpRequest는 `open()`에 문자열 URL을 전달한 요청만 계측한다. URL 객체를 전달한 요청과 요청 header, progress chunk는 수집하지 않으며 응답 header는 `content-type`만 기록한다. GET/HEAD body는 빈 payload로 기록하고, FormData는 값 없이 제한된 field 이름만, Blob과 Document는 metadata만 요약한다. 이 제한과 관계없이 native 요청 동작은 그대로 보존한다.

## 문서

공개 기술 문서는 <https://songforthemute.github.io/browse-sent-event/>에서 확인한다.

- [시작하기](https://songforthemute.github.io/browse-sent-event/guides/getting-started)
- [패널과 내보내기](https://songforthemute.github.io/browse-sent-event/guides/panel-and-export)
- [설정과 제한 사항](https://songforthemute.github.io/browse-sent-event/guides/configuration-and-limitations)
- [제품 요구사항](https://songforthemute.github.io/browse-sent-event/browse-sent-event-prd)
- [아키텍처 결정 기록](https://songforthemute.github.io/browse-sent-event/browse-sent-event-adr)

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
pnpm test:release
```
