# browse-sent-event — PRD

**Product Requirements Document**

| | |
|---|---|
| **Status** | Phase 1 공개 alpha |
| **Owner** | songforthemute (코코) |
| **Last updated** | 2026-07-26 |
| **Scope of this PRD** | Phase 1 (핵심 가치 증명) 집중, Phase 2~6은 개요만 |

---

## 1. Overview

### 1.1 Product Summary

실시간 메시지가 도착한 뒤, 어느 상태를 거쳐 어떤 컴포넌트까지 소비됐는지 보여주는 프론트엔드 개발 도구. WebSocket, HTTP stream(fetch/SSE), XMLHttpRequest, window messaging을 하나의 타임라인으로 통합하고, Vite 플러그인 한 줄로 도입한다.

### 1.2 Problem Statement

프론트엔드 개발자의 디버깅 시간 중 상당 비율이 **외부 통신 경계면의 불투명성**에서 비롯된다. Chrome DevTools의 WebSocket/EventStream 탭은 **transport 레벨에서 끝난다** — 메시지가 도착했다는 것은 보여주지만, 그 메시지가 어떤 상태를 거쳐 어떤 컴포넌트까지 소비됐는지, 혹은 도착했지만 아무 곳에서도 소비되지 않았는지는 보여주지 못한다.

LLM 스트리밍, WebView 하이브리드 앱, MFE iframe 통신 등 실시간 통신이 범용 인프라가 된 지금, 이 공백은 일상적 생산성 손실로 이어진다.

### 1.3 Product Goal

**프론트엔드 개발자가 "이건 내 문제인가 아닌가"를 5초 안에 판별할 수 있게 한다.**

- Core(인터셉트, 타임라인, 검색)는 프레임워크 무관
- Causality 추적은 프레임워크 어댑터 또는 heuristic 폴백으로 제공
- 앱 코드 변경 없이, 번들러 설정 한 줄로 도입
- 프로덕션 번들에 한 바이트도 포함되지 않음
- 사람(DevTools UI)과 에이전트(JSON API) 모두 소비 가능

### 1.4 Non-Goals

**Phase 1에서 하지 않는 것을 명시한다.**

- Web Worker에서 열린 연결 캡처 (main thread only)
- webpack, Rspack, Rollup, esbuild 직접 지원 (Vite only; Vite 8 내부 Rolldown/Oxc 경로는 Vite Plugin API를 통해서만 사용)
- React/Vue fiber 추적 (Phase 2)
- 상태 관리 미들웨어 (Phase 2)
- DOM 하이라이트 오버레이 (Phase 2)
- Schema inference (Phase 5)
- 외부 대시보드 서버 (Phase 6)
- WASM 엔진 (Appendix, 필요성 증명 후)

---

## 2. Users & Use Cases

### 2.1 Primary Users

**P1. 프론트엔드 개발자 (개인)**
- 일상 디버깅 중 실시간 통신 이슈를 만나는 사람
- Chrome DevTools와 `console.log`로 해결하던 고통을 제거하고 싶음

**P2. 프론트엔드 팀 (집단)**
- 디버깅 방식이 개인마다 달라 공유가 어려운 팀
- 신규 팀원 온보딩에서 실시간 데이터 흐름 이해에 시간이 걸리는 팀

**P3. AI 코딩 에이전트**
- Claude Code, Codex 등이 프론트엔드 코드를 수정할 때 런타임 상태를 파악해야 하는 워크플로우 (Phase 3에서 본격 지원)

### 2.2 Core Use Cases (Phase 1)

**UC1. "이 데이터 서버에서 왔어?"**
- 개발자가 DevTools 패널을 열어 최근 메시지 타임라인에서 즉시 확인
- 성공 기준: 의문 → 답 확인까지 5초 이내

**UC2. "연결이 끊겼나?"**
- 패널 상단의 연결 상태 인디케이터로 즉시 판단
- 성공 기준: OPEN/CLOSED/RECONNECTING을 한눈에 구분

**UC3. "LLM 응답이 중간에 멈췄다"**
- fetch stream과 WebSocket을 같은 타임라인에서 관찰
- 성공 기준: 스트림 청크가 언제 마지막으로 왔는지 확인 가능

**UC4. "아까 그 메시지 내용이 뭐였지?"**
- 검색 기능으로 과거 메시지 조회
- 성공 기준: 텍스트 키워드로 과거 메시지 찾기

**UC5. "로그로 남겨서 공유하고 싶다"**
- `.jsonl` 또는 `.log`로 export
- 성공 기준: 이슈 리포트에 저장하거나 첨부할 수 있는 export payload 생성

---

## 3. Scope — Phase 1

### 3.1 In-Scope Features

#### F1. 프로토콜 인터셉트

**F1.1 WebSocket 인터셉트**
- `window.WebSocket`을 Proxy로 래핑
- 메타데이터 캡처: URL, 상태(CONNECTING/OPEN/CLOSING/CLOSED), 수립 시간, close code, 재연결 감지
- 메시지 캡처: 방향(↑↓), timestamp, size, type(text/binary), payload preview

**F1.2 HTTP Stream 인터셉트**
- `window.fetch`를 래핑하여 응답이 `ReadableStream`인 경우 감지
- stream의 각 chunk를 개별 이벤트로 기록
- `Content-Type: text/event-stream`은 SSE로 분류, 그 외 streaming은 "HTTP stream"으로 분류

**F1.3 EventSource 인터셉트**
- `window.EventSource`를 Proxy로 래핑
- SSE 고유 지표 캡처: `Last-Event-ID`, `retry` 값, event type

**F1.4 XMLHttpRequest 인터셉트**
- `window.XMLHttpRequest` 생성자를 Proxy로 래핑
- `open()`에 문자열 URL을 전달한 요청만 계측하고, URL 객체를 전달한 요청은 수집하지 않음
- 각 `send()`의 요청 body와 최종 응답을 기록
- `load`, HTTP status, network error, abort, timeout을 구분
- GET/HEAD body는 빈 payload로 기록
- FormData는 값 없이 제한된 field 이름만, Blob과 Document는 metadata만 요약
- 요청 header와 progress chunk는 수집하지 않고, 응답 header는 `content-type`만 기록

**제약사항**: main thread only. Web Worker 내부 연결은 Phase 1에서 지원하지 않음. README와 DevTools UI에 명시.

#### F2. DevTools UI

**F2.1 플로팅 패널**
- Shadow DOM으로 앱 스타일과 완전 격리
- 토글 가능 (단축키: `Cmd/Ctrl + Shift + R`)
- 크기 조정 가능, 위치 기억 (localStorage)

**F2.2 연결 목록 뷰**
- 활성 연결 목록: 프로토콜 아이콘, URL, 상태, 업타임, msg/s
- 연결 선택 시 해당 연결의 메시지만 필터링

**F2.3 메시지 타임라인 뷰**
- 역순 정렬 (최신이 위), auto-scroll 토글
- 각 메시지 행: 방향(↑↓), timestamp(HH:MM:SS.mmm), 프로토콜, type, payload preview (100자), 크기
- 메시지 클릭 시 상세 패널: 전체 payload (JSON pretty-print), 헤더/메타데이터

**F2.4 집계 메트릭 패널**
- 연결별: 총 msg/s (↓/↑ 분리), 평균 size, reconnect 횟수
- 전체: 활성 연결 수, 총 처리량

#### F3. 메모리 스토리지

**F3.1 링 버퍼**
- 고정 용량 환형 큐 (기본 10,000 메시지)
- push O(1), 초기 할당 1회, 런타임 재할당 없음
- 용량 초과 시 가장 오래된 메시지 drop (Phase 1에서는 drop, Phase 4에서 콜드 스토리지로 이관)

**F3.2 설정**
```typescript
browseSentEvent({
  capacity: 10_000,    // 링 버퍼 크기
});
```

#### F4. 단순 검색

**F4.1 텍스트 검색**
- payload에 대한 대소문자 무시 부분 문자열 매칭
- Phase 1은 순차 스캔 (링 버퍼 크기 10k 기준 충분)
- Phase 2에서 trigram 역색인으로 확장

**F4.2 구조적 필터**
- 연결 URL
- 방향 (incoming/outgoing)
- 시간 범위
- 프로토콜 (WebSocket/fetch-stream/EventSource/XMLHttpRequest)

#### F5. Export

**F5.1 JSONL Export (기본)**
- 한 줄당 하나의 메시지 객체 (JSON)
- 에이전트/스크립트 친화적, `jq` 파이프 가능
- 현재 필터 적용된 결과만 내보내기 가능

**F5.2 Log Export (보조)**
- ASCII 텍스트 포맷, `grep` 친화적
- 한 줄 포맷: `TIMESTAMP DIRECTION [CHANNEL] TYPE — PAYLOAD_PREVIEW`

#### F6. Vite 플러그인

**F6.1 설치 경험**
```bash
npm install -D @browse-sent-event/plugin-vite@alpha
```

```typescript
// vite.config.ts
import browseSentEvent from '@browse-sent-event/plugin-vite';

export default defineConfig({
  plugins: [browseSentEvent()],
});
```

**F6.2 주입 방식**
- 앱 진입점 최상단에 core를 물리적으로 삽입 (import 주입)
- 모든 앱 코드보다 먼저 실행되도록 보장
- `transform` 훅에서 entry module 감지 + prepend

**F6.3 프로덕션 제거**
- `NODE_ENV === 'production'`이면 플러그인이 no-op
- 프로덕션 번들에 관련 코드 한 바이트도 포함되지 않음
- `vite build`로 검증: 출력 번들에서 `browse-sent-event` 문자열 부재 확인

**F6.4 Vite 8 / Rolldown 제약**
- Phase 1의 개발 기준은 Vite 8.0.16이다.
- Vite 8에서는 Rolldown/Oxc가 기본 변환 경로이므로, 플러그인은 Vite 공개 Plugin API와 `transform`/`configResolved` 등 안정 훅에만 의존한다.
- `transformWithEsbuild`, `optimizeDeps.esbuildOptions`, `build.minify: 'esbuild'`, `build.cssMinify: 'esbuild'`에 의존하지 않는다.
- Rollup 전용 출력 옵션이 필요해지면 `build.rollupOptions` 대신 Vite 8의 `build.rolldownOptions` 경로를 먼저 검토한다.

### 3.2 Out-of-Scope (Phase 1)

명시적으로 Phase 1에서 제외하는 항목:

| 항목 | 배정 Phase |
|---|---|
| React/Vue fiber 추적 | Phase 2 |
| 상태 관리 미들웨어 | Phase 2 |
| DOM 하이라이트 오버레이 | Phase 2 |
| Message Lifecycle Detection | Phase 2 |
| Trigram 검색 | Phase 2 |
| `window.postMessage` 인터셉트 | Phase 3 |
| Dev Server API 엔드포인트 | Phase 3 |
| webpack/Rspack/Next/Nuxt 플러그인 | Phase 4 |
| IndexedDB 콜드 스토리지 | Phase 4 |
| Schema inference | Phase 5 |
| Collector/Dashboard 서버 | Phase 6 |
| WASM 엔진 | Appendix |

---

## 4. Technical Design

### 4.1 Architecture Overview

```
┌─ App Code (untouched) ──────────────────────────────┐
│                                                     │
│  WebSocket / fetch / EventSource / XMLHttpRequest   │
│       │                                             │
└───────┼─────────────────────────────────────────────┘
        │
        ▼ (Proxy intercept, injected by plugin)
┌─────────────────────────────────────────────────────┐
│  core/interceptors/                                 │
│  ┌────────────┬──────────────┬──────────────┬─────┐ │
│  │ websocket  │ fetch-stream │ eventsource  │ xhr │ │
│  └────────────┴──────────────┴──────────────┴─────┘ │
│              │                                      │
│              ▼                                      │
│  core/engine/ (JS engine)                           │
│   ├── RingBuffer                                    │
│   ├── MetricsAggregator                             │
│   └── SimpleSearchIndex                             │
│              │                                      │
│              ▼                                      │
│  core/ui/ (Shadow DOM panel)                        │
│   ├── ConnectionList                                │
│   ├── MessageTimeline                               │
│   └── MetricsPanel                                  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 4.2 Core Interfaces

**DevtoolsEngine** (Phase 1용 JS 구현, Appendix에서 WASM 구현 가능)

```typescript
interface DevtoolsEngine {
  recordMessage(msg: RawMessage): void;
  recordConnection(conn: ConnectionEvent): void;

  getMessages(filter?: MessageFilter): Message[];
  getConnections(): Connection[];
  getMetrics(connectionId?: string): Metrics;

  search(query: SearchQuery): Message[];

  exportJsonl(filter?: MessageFilter): string;
  exportLog(filter?: MessageFilter): string;

  clear(): void;
}
```

**Message Schema**

```typescript
interface Message {
  id: string;                          // UUID
  connectionId: string;
  timestamp: number;                   // performance.now() 기준
  direction: 'in' | 'out';
  protocol: 'websocket' | 'fetch-stream' | 'eventsource' | 'xhr';
  type?: string;                       // event type (SSE) 또는 추론된 type 필드
  size: number;                        // bytes
  payload: string | ArrayBuffer;       // 원본 데이터
  payloadPreview: string;              // UI용 100자 truncate
  metadata: Record<string, unknown>;   // 프로토콜별 고유 필드
}
```

**Connection Schema**

```typescript
interface Connection {
  id: string;
  protocol: 'websocket' | 'fetch-stream' | 'eventsource' | 'xhr';
  url: string;
  state: 'connecting' | 'open' | 'closing' | 'closed';
  openedAt: number;
  closedAt?: number;
  closeCode?: number;                  // WebSocket 전용
  reconnectCount: number;
}
```

### 4.3 Key Technical Decisions

**D1. Proxy 패턴 for 인터셉트**
- 대안: monkey patching, Object.defineProperty
- 선택 이유: 투명성 (원본 동작 100% 보존), 중첩 래핑 가능, 해제 가능

**D2. Shadow DOM for UI 격리**
- 대안: iframe, 전역 스타일 주입
- 선택 이유: CSS 완전 격리, 성능 오버헤드 낮음, iframe보다 구현 단순

**D3. 링 버퍼 for 메모리 관리**
- 대안: `Array.push/shift`, LRU cache
- 선택 이유: O(1) push, 초기 할당 1회, GC 부담 제로 (고빈도 스트림에서 필수)

**D4. Vite 플러그인의 import 주입 방식**
- 대안: HTML transformIndexHtml에 script 태그 삽입, runtime lazy load
- 선택 이유: 모듈 평가 순서 보장, HMR과 충돌 없음, 프로덕션 제거 단순

**D5. 기본 capacity 10,000**
- 근거: 초당 100 msg 기준 약 100초 보관 (일반 앱 기준 충분), 메모리 사용량 예측 가능 (~10MB 상한)
- 사용자 설정으로 조정 가능

### 4.4 Known Risks

**R1. Proxy 패치 충돌**
- 다른 라이브러리가 `window.WebSocket`을 이미 패치한 경우
- 대응: 원본 참조 보존, 중첩 래핑 허용, 충돌 감지 시 console.warn

**R2. Vite HMR과의 상호작용**
- HMR 재실행 시 Proxy가 중복 주입될 가능성
- 대응: `window.__browseSentEventInstalled` 플래그로 idempotent 보장

**R3. 대용량 payload의 UI 영향**
- MB 단위 binary 메시지가 UI를 블로킹할 수 있음
- 대응: preview 생성 시 100자 제한, 상세 보기는 on-demand rendering

**R4. 인터셉트 자체의 성능 오버헤드**
- 고빈도 스트림(초당 1000+ msg)에서 Proxy 호출 비용
- 대응: Phase 1에서 벤치마크 필수, 10%를 넘으면 Phase 2에서 Worker 분리 우선 검토

---

## 5. User Experience

### 5.1 Default Behavior

플러그인 활성화 시 기본 동작:

1. Vite dev server 시작 시 패널이 자동으로 표시됨 (작은 토글 버튼)
2. 사용자가 토글 버튼 클릭 → 패널 확장
3. 연결이 생성되면 자동으로 목록에 추가
4. 메시지가 실시간으로 타임라인에 스트림됨

### 5.2 Panel Layout

```
┌─ browse-sent-event ─────────────────── [_][×] ┐
│                                                │
│ Connections  Messages  Metrics                 │
│ ─────────    ───────   ───────                 │
│                                                │
│ 🟢 wss://api.example.com/ws   12m 03s  47/s  │
│ 🟢 https://api.com/stream/x   04m 11s   8/s  │
│ 🔴 wss://dead.com/ws          DISCONNECTED    │
│                                                │
│ ── Selected: wss://api.example.com/ws ─────   │
│                                                │
│ 🔍 [search...]  [↓ in] [↑ out]  [Export ▾]   │
│                                                │
│ ↓ 14:02:01.120  trade   {"symbol":"BTC",...}  │
│ ↓ 14:02:01.215  trade   {"symbol":"ETH",...}  │
│ ↑ 14:02:01.300  ping    {"id":"abc123"}       │
│ ↓ 14:02:01.318  pong    {"id":"abc123"}       │
│                                                │
└────────────────────────────────────────────────┘
```

### 5.3 Configuration Options

```typescript
interface BrowseSentEventOptions {
  capacity?: number;              // default: 10_000
  panel?: {
    autoOpen?: boolean;           // default: false (토글 버튼만 표시)
    position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
    hotkey?: string;              // default: 'cmd+shift+r'
  };
  filter?: {
    // 특정 URL 패턴 제외
    excludeUrls?: (string | RegExp)[];
  };
}
```

---

## 6. Success Metrics

### 6.1 Phase 1 Release Criteria

**기능 완성도:**
- [ ] WebSocket, fetch stream, EventSource, XMLHttpRequest 모두 안정적으로 인터셉트
- [ ] Vite 플러그인 설치 후 앱 코드 변경 없이 동작
- [ ] 프로덕션 빌드에서 관련 코드가 완전히 제거됨을 테스트로 검증
- [ ] 기본 UI 동작 (연결 목록, 타임라인, 검색, export)

**성능:**
- [ ] 초당 100 msg 스트림에서 메인 스레드 영향 < 5%
- [ ] 초당 1000 msg 스트림에서 메인 스레드 영향 < 15% (목표치, 필수 아님)
- [ ] 메모리 사용량이 capacity 기반 예측값의 ±20% 이내

**호환성:**
- [ ] Vite 5.x, 6.x, 7.x, 8.x 공식 지원
- [ ] Chrome, Firefox, Safari 최신 버전 동작

**문서:**
- [x] README with quickstart (5분 이내 도입 가능)
- [x] 제약사항 명시 (main thread only, Vite only)
- [x] 기여 가이드

### 6.2 Adoption Metrics (Phase 1 출시 후 3개월)

- GitHub stars ≥ 100
- npm weekly downloads ≥ 500
- 최소 3개 이상의 외부 프로젝트 채택 사례
- 이슈 리포트 기반으로 Phase 2 우선순위 조정

### 6.3 Qualitative Signals

- 사용자 피드백에서 "Chrome Network 탭 대신 쓴다"는 언급
- LLM 스트리밍 앱 개발 맥락에서의 채택 사례
- 팀 단위 도입 사례 (개인 도구를 넘어선 확산)

---

## 7. Roadmap Overview (Phase 2+)

Phase 1 이후 계획. 각 Phase는 독립적 가치가 있으며, Phase 1 출시 후 사용자 피드백으로 우선순위를 재조정할 수 있다.

| Phase | 핵심 내용 | 목표 완료 |
|---|---|---|
| **Phase 2** | React + Zustand causality, Message Lifecycle Detection, Trigram 검색, DOM overlay | Phase 1 + 3~4개월 |
| **Phase 3** | `window.postMessage`, Dev Server JSON API, Vue + Pinia, heuristic 폴백 | Phase 2 + 2~3개월 |
| **Phase 4** | webpack/Rspack/Nuxt/Next, IndexedDB cold storage, Web Worker 분리, 프레임워크 버전 감시 CI | Phase 3 + 2~3개월 |
| **Phase 5** | Schema Inference, TypeScript 타입 생성, Usage Analytics, AsyncAPI Export, Schema Drift Detection | Phase 4 + 3~4개월 |
| **Phase 6** | Collector/Dashboard 서버 (Docker Compose), 팀 단위 세션 공유, 스테이징/프로덕션 지원 | Phase 5 + 3~4개월 |

Phase 2는 **browse-sent-event를 대체 불가능한 도구로 만드는 분기점**이므로 Phase 1 출시 직후 즉시 착수한다.

---

## 8. 결정 사항 및 남은 질문

Phase 1 착수 전 혼선을 줄이기 위해, ADR에서 이미 확정된 항목과 실제로 남은 질문을 분리한다.

### 8.1 확정된 결정

**D1. 공개 패키지 이름과 역할**
- 결정: `@browse-sent-event/core`는 runtime과 panel API를 제공한다.
- 결정: `@browse-sent-event/plugin-vite`는 Vite 개발 서버 entry에 core bootstrap을 주입한다.
- 배포 상태: core `0.1.0-alpha.0`, plugin-vite `0.1.0-alpha.1`이 npm에 공개되어 있다.
- 예외: plugin-vite `0.1.0-alpha.0`은 잘못된 `workspace:*` manifest 때문에 deprecated 처리했다.

**D2. 라이선스**
- 결정: MIT
- 근거: ADR-011. 프론트엔드 생태계의 표준 라이선스이며 기업 내부 도입 장벽이 낮다.

**D3. Monorepo 도구**
- 결정: pnpm workspace + Turborepo + Changesets
- 근거: ADR-001. 패키지 경계를 유지하면서 빌드/테스트 캐싱과 독립 버전 관리를 제공한다.

**D4. UI 프레임워크**
- 결정: Lit 3.x + Shadow DOM closed mode + Custom Elements
- 근거: ADR-018. 앱 프레임워크와 충돌하지 않고, 패널 UI를 표준 Web Component로 재사용할 수 있다.

**D5. 공개 alpha 운영**
- 결정: package는 독립적으로 versioning하며 설치 문서에서는 `@alpha` dist-tag를 사용한다.
- 결정: npm publish는 maintainer가 release gate를 확인한 뒤 로컬에서 수동 실행한다.
- 결정: Git tag와 GitHub Release는 검증된 npm package version을 기준으로 별도 생성한다.
- 근거: ADR-023.

### 8.2 남은 질문

**OQ1. 텔레메트리**
- 기본값: 수집하지 않음
- 결정 필요: opt-in을 제공할지, 제공한다면 어떤 이벤트와 환경 정보를 수집할지
- 후속 문서: ADR-020에서 별도 결정

**OQ2. stable 전환 조건**
- 현재 단계: 공개 alpha
- 기본 경로: alpha → beta → stable
- 결정 필요: 호환성 matrix, 외부 채택 사례, API 변경률을 Release Criteria와 어떤 방식으로 연결할지

---

## 9. Appendix

### 9.1 Reference Implementations

구현 시 참고할 기존 도구:

- **TanStack Query Devtools**: Shadow DOM 패널 UX, 개발/프로덕션 분기
- **Vue Devtools**: `getCurrentInstance()` 활용 패턴 (Phase 2에서 참고)
- **SWC**: 엔진 인터페이스 + WASM 대체 구현 패턴 (Appendix)
- **unplugin**: 번들러 추상화 (Phase 4에서 참고)

### 9.2 Terminology

| 용어 | 정의 |
|---|---|
| **Transport** | 메시지의 네트워크 전송 레벨 (WebSocket 프레임, HTTP chunk 등) |
| **Causality** | 메시지가 도착 후 앱 내부에서 처리되는 인과 경로 (Phase 2부터) |
| **Orphaned** | 핸들러가 처리하지 않은 메시지 (Phase 2) |
| **Unexpected-unrendered** | 상태엔 저장됐지만 렌더에 반영 안 된 메시지 (Phase 2) |
| **Confidence** | causality 추적의 신뢰 수준 (definitive/adapter-backed/heuristic, Phase 2) |
