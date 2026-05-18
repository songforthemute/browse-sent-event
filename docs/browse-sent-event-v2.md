# browse-sent-event

**실시간 메시지가 도착한 뒤, 어느 상태를 거쳐 어떤 컴포넌트까지 소비됐는지 보여주는 개발 도구.**

WebSocket, HTTP stream(fetch/SSE), window messaging을 한곳에서 보고, 도착했지만 화면에 소비되지 않은 메시지를 즉시 찾는다. 설정 한 줄로 개발 환경에만 주입되며, 프론트엔드가 아닌 문제를 5초 안에 잘라낸다.

---

## Mission

프론트엔드 개발자의 하루를 보면, 놀라울 만큼 많은 시간이 프론트엔드가 아닌 문제에 쓰인다.

"이 데이터 백엔드에서 안 오는 것 같은데요" — 확인해보면 오고 있었고, 파싱에서 빠진 거였고, 그걸 확인하는 데 30분이 걸렸다. "WebSocket 끊긴 것 같은데요" — Network 탭을 뒤지고, 서버 담당자에게 물어보고, 결국 모바일 네트워크 전환 때문이었고, 그 과정에 1시간이 갔다. "LLM 답변이 중간에 멈췄어요" — 서버 생성이 끝난 건지, 스트림이 끊긴 건지, 상태 업데이트가 빠진 건지 구분하는 데 또 한참이 걸렸다. "WebView 브릿지에서 응답이 안 와요" — 네이티브 담당자와 양쪽 로그를 맞춰보다가 오전이 지나갔다.

이 시간은 전부 **경계면의 불투명성** 때문에 발생하는 비용이다. 외부 세계 — 백엔드, 네이티브 앱, 서드파티 위젯, LLM 서비스, 무엇이든 — 와의 통신이 블랙박스이기 때문에, 프론트엔드 개발자가 그 블랙박스를 직접 열어봐야 한다.

browse-sent-event는 그 경계면을 투명하게 만들어서, **"이건 내 문제인가 아닌가"를 5초 안에 판별**하게 한다. 내 문제가 아니면 증거를 붙여서 넘기고, 내 문제면 정확히 어디서 빠졌는지 보고 바로 고친다.

**프론트엔드 개발자는 프론트엔드의 문제를 풀어야 한다.** UI 성능 최적화, 접근성 개선, 인터랙션 설계, 컴포넌트 아키텍처 — 이것이 프론트엔드의 전문 직무 역량이다. browse-sent-event는 외부 통신의 복잡성에 시간을 빼앗기지 않고 **자기 직무의 깊이를 키울 수 있는 여유를 만들어주는 도구**다.

이것이 프론트엔드 오픈소스 생태계를 위한 선의이고, 팀원들에 대한 배려다.

---

## 왜 지금인가

### 기존 도구의 한계: transport는 보지만 causality는 못 본다

기존 도구가 없는 것은 아니다. Chrome DevTools는 WebSocket Messages 탭, EventStream 탭, Performance 패널의 WS 이벤트를 제공한다. WebSocket DevTools, postMessage Inspector 같은 프로토콜별 전용 도구도 이미 각각 존재한다.

하지만 이 모든 도구는 **transport 레벨에서 끝난다**. 메시지가 도착했다는 것은 보여주지만, 그 메시지가 어떤 상태를 거쳐 어떤 컴포넌트까지 소비됐는지, 혹은 도착했지만 아무 곳에서도 소비되지 않았는지는 보여주지 못한다. 시장은 비어 있지 않지만 **통합되지 않았고, UI 소비 지점과 연결되지 않았다**.

### 실시간 통신이 범용 인프라가 되었다

과거에는 WebSocket/SSE가 트레이딩, 채팅, 실시간 협업 등 특수 도메인에 한정되었다. 지금은 상황이 완전히 바뀌었다.

- **LLM 스트리밍 응답**이 HTTP stream과 SSE로 전달된다. Vercel AI SDK의 `useChat` 기본 transport는 fetch POST + streaming response이고, data stream은 SSE 포맷, text stream은 HTTP streaming이며, WebSocket transport로도 교체 가능하다.
- **에이전트 상태 푸시** — tool_use, thinking, 중간 결과가 실시간으로 흘러온다
- **멀티모달 에이전트**는 WebSocket으로 양방향 통신한다
- **WebView 하이브리드 앱**이 네이티브와 `postMessage`로 양방향 통신한다
- **마이크로프론트엔드(MFE)**에서 iframe 간 `postMessage`가 사실상 분산 시스템의 메시지 버스로 쓰인다

이 모든 패턴에서 기존 도구의 한계는 동일하다: **메시지를 보여줄 뿐, 메시지의 운명을 보여주지 못한다.**

---

## Goal

**실시간 메시지가 브라우저에 도착한 뒤, 어느 상태를 거쳐 어떤 컴포넌트까지 소비됐는지를 하나의 도구에서 보여준다.**

- **core(인터셉트, 타임라인, 검색)**는 프레임워크에 무관하게 동작한다
- **causality 추적**은 지원 프레임워크 어댑터 또는 heuristic 폴백으로 제공된다
- 프로토콜 — WebSocket, HTTP stream(fetch/SSE), window messaging — 을 하나의 타임라인으로 통합한다
- 앱 코드 변경 없이, 번들러 설정 한 줄로 도입한다
- 프로덕션 번들에는 한 바이트도 포함되지 않는다
- 사람(DevTools UI)과 에이전트(JSON API) 모두 소비할 수 있다

---

## 핵심 개념: Message Causality

이 도구의 심장은 메시지의 생애주기를 단계별로 추적하는 것이다. 도착에서 렌더까지 가는 길은 여러 단계를 거치는데, 각 단계를 구분해야 어디서 문제가 생겼는지 정확히 짚을 수 있다.

browse-sent-event의 차별점은 메시지의 **인과 경로(causality chain)**를 추적하는 것이다. 메시지 하나의 생애를 단계별로 관찰한다.

```
arrived → parsed → handled → stored → selected → rendered
```

각 단계의 정의:

| 단계 | 의미 | 예시 |
|------|------|------|
| **arrived** | 네트워크에서 도착 | Proxy 인터셉트가 감지 |
| **parsed** | 앱 코드가 역직렬화 완료 | JSON.parse 통과 |
| **handled** | 콜백/핸들러가 처리 | onmessage 핸들러 실행 |
| **stored** | 상태 관리에 저장 | Zustand store 업데이트 |
| **selected** | 컴포넌트가 구독/선택 | useStore selector 호출 |
| **rendered** | DOM에 반영 | 컴포넌트 리렌더 완료 |

추가적으로 다음 상태가 존재한다:

| 상태 | 의미 |
|------|------|
| **ignored-by-rule** | 의도적으로 소비하지 않는 메시지 (heartbeat, ack, analytics ping 등) |
| **orphaned** | 어떤 핸들러도 처리하지 않은 메시지 — 서버-클라이언트 계약 불일치 가능성 |
| **unexpected-unrendered** | 핸들러가 처리했지만 최종 렌더에 도달하지 않은 메시지 — 상태 관리 또는 컴포넌트 로직 문제 가능성 |

이 단계 모델이 중요한 이유: consumed/unconsumed를 단순 이진값으로 처리하면 heartbeat, ack, cache warmup 같은 메시지가 전부 "unconsumed"로 뜨면서 노이즈가 폭발한다. 단계별 상태가 있어야 **진짜 문제(orphaned, unexpected-unrendered)만 정확히 잡는다.** 도구의 신뢰는 여기서 결정된다.

---

## 기능 총정리

### 1. 프로토콜 인터셉트 + 채팅형 타임라인 UI

브라우저 Web API 레벨에서 세 가지 통신 표면을 패치한다.

- **WebSocket**: `window.WebSocket`을 Proxy로 래핑
- **HTTP stream**: `window.fetch`를 래핑하여 `ReadableStream` 응답을 감지 + `window.EventSource` Proxy 패치
- **Window messaging**: `window.postMessage` 송신 패치 + `message` 이벤트 capture phase 수신

인터셉터는 `core/interceptors/` 아래에 프로토콜별로 분리되어 있으며, 새 프로토콜을 추가할 때 아키텍처 변경 없이 어댑터만 추가하면 된다.

Shadow DOM으로 앱 스타일과 격리된 플로팅 패널에 연결 목록, 채팅형 메시지 타임라인(방향 ↑↓, 타임스탬프, 페이로드 프리뷰, 응답 지연), 집계 메트릭을 표시한다. 모든 프로토콜이 하나의 타임라인에 통합된다.

**현재 스코프: main thread only.** Web Worker에서 열린 WebSocket/EventSource 연결은 Phase 1에서는 캡처하지 않는다. Worker 지원은 별도 부트스트랩 주입 경로가 필요하며, 이후 Phase에서 다룬다.

**해소하는 고통**: "이 데이터 서버에서 왔어? 안 왔어?"를 확인하려고 Chrome Network 탭을 열고, WS 필터를 걸고, 프레임 목록에서 스크롤하며 찾는 과정. LLM 스트리밍 앱에서 토큰이 끊기면 fetch response가 멈춘 건지, 서버가 생성을 중단한 건지 판단하기 어려운 문제.

**얻는 효용**: 실시간 통신 관련 확인 시간이 건당 30초~1분에서 3~5초로 줄어든다. 연결 상태(OPEN/CLOSED/RECONNECTING)가 즉시 보이므로 "연결이 죽은 건가, 서버가 멈춘 건가"를 즉시 구분한다.

---

### 2. 번들러 플러그인

**Vite first.** Vite 플러그인을 1차 지원하고, webpack/Rspack은 이후 지원 트랙에서 다룬다. unplugin을 기반으로 하되, 복잡한 번들러별 분기가 필요한 경우 번들러별 패키지로 분리한다. 초기에 "모든 번들러 완벽 지원"을 약속하지 않는다.

앱 진입점 최상단에 core를 물리적으로 삽입해서 **모든 앱 코드보다 먼저 실행되는 것을 보장**한다. `NODE_ENV === 'production'`이면 코드 자체를 주입하지 않는다.

```typescript
// vite.config.ts — 설정 한 줄이 전부
import browseSentEvent from 'browse-sent-event/vite';

export default defineConfig({
  plugins: [browseSentEvent()],
});
```

**해소하는 고통**: 디버깅 도구 도입을 위해 앱 코드에 import를 추가하고, 개발/프로덕션 분기를 만들고, 실행 순서를 확인하는 반복 작업.

**얻는 효용**: 도입 비용 제로, 유지 비용 제로. 한 사람이 설정에 넣으면 팀 전체가 동일한 관찰 도구를 공유한다.

---

### 3. Message-to-UI Causality 추적 (Framework Adapter)

프레임워크의 반응성 시스템이 보유한 의존성 그래프를 읽어서, 메시지→상태→컴포넌트의 인과 경로를 매핑하고, 컴포넌트→메시지의 역방향 추적도 제공한다.

추적의 신뢰도를 3단계로 구분한다:

| Confidence | 의미 | 조건 |
|------------|------|------|
| **definitive** | 확정적 인과 관계 | 프레임워크 어댑터 + 상태 관리 미들웨어 모두 활성화 |
| **adapter-backed** | 어댑터 기반 추론 | 프레임워크 어댑터만 활성화, 상태 관리 미들웨어 없음 |
| **heuristic** | 시간 상관관계 추정 | 어댑터 없음, MutationObserver 기반 |

**React + Zustand 한정으로 먼저 구현한다.**

- **React 어댑터**: `__REACT_DEVTOOLS_GLOBAL_HOOK__`의 `onCommitFiberRoot`를 활용. 이 훅은 비공식 API이며 React 내부 구조에 의존한다. 메이저 버전 변경 시 깨질 수 있으므로, confidence는 "adapter-backed"로 표시하고 호환성 매트릭스를 유지한다.
- **Vue 어댑터**: `getCurrentInstance()`를 활용. 이 API는 setup/lifecycle 컨텍스트 안에서만 안정적으로 동작하며, 공식 문서에서 **애플리케이션 코드**에서의 사용은 권장되지 않는다. browse-sent-event는 애플리케이션 코드가 아닌 **개발 도구**로서 이 API를 사용하며, 이는 공식 Vue DevTools와 동일한 접근이다. confidence는 "adapter-backed"로 표시하고 호환성 매트릭스를 유지한다.
- **상태 관리 미들웨어**: Zustand 미들웨어로 메시지→상태 변경 구간을 브릿지. Pinia는 이후 지원.
- **DOM heuristic (폴백)**: MutationObserver로 메시지 도착 직후 DOM 변화를 시간 상관관계로 추정. confidence는 항상 "heuristic".

메시지 하나를 클릭하면 인과 경로가 표시된다:

```
↓ 14:02:01.120  trade  BTC  67,341.20
  arrived → parsed → stored(store.trades) → rendered
  → <TradeList>         12ms  [definitive]
  → <PriceHeader>        8ms  [definitive]
```

**해소하는 고통**: "데이터는 오는데 화면에 왜 안 나와?"를 추적하기 위해 각 단계마다 console.log를 심는 루프. 복잡한 경우 30분~1시간 소요.

**얻는 효용**: 인과 관계의 전체 경로가 한 화면에 표시된다. "데이터는 오는데 안 보여요" 류의 디버깅이 30분에서 1분으로 단축.

---

### 4. Message Lifecycle Detection

Message Causality의 단계 모델을 활용해, 메시지의 최종 상태를 분류하고 문제를 식별한다.

```
정상:
  arrived → ... → rendered           (화면에 반영됨)
  arrived → ... → ignored-by-rule    (heartbeat 등, 의도적 무시)

문제:
  arrived → orphaned                 (아무 핸들러도 처리 안 함)
  arrived → ... → stored → ???       (상태엔 들어갔는데 렌더 안 됨)
```

검색에서 `status:orphaned`, `status:unexpected-unrendered`로 필터링 가능.

사용자가 ignore rule을 정의할 수 있다:

```typescript
browseSentEvent({
  ignoreRules: [
    { type: 'heartbeat' },
    { type: 'ack' },
    { channel: 'analytics' },
  ],
});
```

매칭되는 메시지는 `ignored-by-rule`로 분류되어 노이즈에서 제거된다.

**해소하는 고통**: 데이터 유실의 존재를 인지하는 것 자체가 어렵다. 새 이벤트 타입이 서버에서 추가됐는데 프론트엔드에서 핸들러를 안 만들어도 알 방법이 없다.

**얻는 효용**: orphaned 메시지 목록은 서버-클라이언트 간 계약 불일치를 즉시 드러낸다. 디버깅 도구를 넘어서 품질 관리 도구로 기능한다. ignore rule이 있으므로 거짓 양성 노이즈 없이 진짜 문제만 잡는다.

---

### 5. DOM 하이라이트 오버레이

DevTools 패널에서 메시지에 호버하면, 해당 메시지를 소비하는 컴포넌트의 실제 DOM 위에 `getBoundingClientRect()` 기반 오버레이를 렌더한다. `pointerEvents: none`으로 앱 조작을 방해하지 않는다.

역방향도 지원한다. 앱 화면에서 요소를 inspect하면 관련 메시지가 패널에서 하이라이트된다.

오버레이에 confidence 레벨을 시각적으로 구분한다: definitive는 실선, adapter-backed는 파선, heuristic은 점선.

**해소하는 고통**: "이 화면 영역이 어떤 실시간 데이터를 먹고 있는지" 알려면 코드를 읽고 컴포넌트 트리를 타고 올라가야 한다.

**얻는 효용**: 코드를 한 줄도 안 읽고도 앱의 실시간 데이터 흐름을 시각적으로 파악한다. 온보딩에서 실시간 데이터 흐름 이해에 걸리는 시간을 대폭 단축.

---

### 6. 검색 + Tiered Storage + Export

**핫 레이어(메모리)**: 고정 크기 환형 링 버퍼. 할당이 초기 한 번, push O(1), GC 부담 제로. 최근 N건(기본 10,000)을 유지한다.

**콜드 레이어(IndexedDB)**: 옵셔널 활성화. 링 버퍼에서 밀려나는 메시지를 비동기 배치로 전이. 채널·타입·시간·상태 복합 인덱스 지원. 세션을 넘어선 히스토리 분석 가능.

**검색 엔진**: Phase 1은 단순 텍스트 매칭. Phase 2에서 trigram 역색인으로 확장하여 부분 문자열 매칭과 구조적 필터(채널, 방향, 이벤트 타입, 시간 범위, lifecycle 상태, 소비 컴포넌트)를 조합한다. 핫 먼저 조회, 부족하면 콜드까지 확장.

**Export**: `.jsonl`(기본, 에이전트/스크립트 친화적) + `.log`(ASCII, 사람 친화적, grep 가능). 현재 검색 필터 적용 결과를 내보낼 수 있다.

**해소하는 고통**: 실시간 앱 버그의 최대 고통인 재현 문제.

**얻는 효용**: 재현 없이 사후 분석이 가능해진다. 버그 리포트의 품질이 "느낌"에서 "증거"로 전환된다.

---

### 7. Dev Server 엔드포인트 (에이전트 지원)

번들러의 Dev Server 미들웨어 훅을 활용해, 별도 서버 없이 같은 포트에서 HTTP 엔드포인트를 노출한다.

**JSON first.** 모든 엔드포인트의 기본 응답은 JSON이다. `?format=ascii`로 사람용 테이블 포맷을 요청할 수 있다.

- `GET /__browse-sent-event/snapshot` — 연결 상태, 메시지 흐름, causality 매핑, orphaned 메시지
- `GET /__browse-sent-event/stream` — SSE 스트림으로 실시간 이벤트 (JSON lines)
- `GET /__browse-sent-event/query?text=BTC&status=orphaned` — 검색
- `GET /__browse-sent-event/component/:name` — 특정 컴포넌트의 데이터 소스 역추적

**보안 기본값:**

- **local-only**: 기본적으로 `localhost`/`127.0.0.1`에서만 접근 가능
- **host allowlist**: 명시적으로 허용한 호스트만 접근 가능
- **payload redaction**: 기본적으로 페이로드를 truncate. `opt-in`으로 전체 캡처 활성화
- Vite의 DNS rebinding 경고에 준하는 보안 수준 유지

```typescript
browseSentEvent({
  server: {
    allowedHosts: ['localhost'],  // 기본값
    capturePayload: false,        // 기본값: 메타데이터만
  },
});
```

**해소하는 고통**: Claude Code 같은 에이전트가 프론트엔드 코드를 수정할 때 런타임 상태를 볼 수 없다.

**얻는 효용**: 에이전트의 워크플로우에 런타임 관찰이 포함된다. 코드 수정 → snapshot 확인 → 문제 발견 → 재수정의 루프가 사람 개입 없이 돌아간다.

---

### 8. Window Messaging 모니터링 (WebView / iframe / MFE)

`window.postMessage` 송신을 패치하고, `message` 이벤트를 capture phase로 수신 가로채기한다.

`event.source` 식별(parent, iframe#id, opener)로 메시지 송수신자를 명확히 표시하고, `event.origin`으로 출처를 구분한다. WebView 브릿지의 요청-응답 패턴, iframe 간 핸드셰이크, MFE 이벤트 버스를 하나의 타임라인에서 추적한다.

**스코프 한정: window boundary surfaces first.** Phase에서 다루는 것은 `window.postMessage()`이다. `MessagePort`, `Worker.postMessage()`, `BroadcastChannel`은 별도 표면이며, 필요성이 확인된 후에 추가한다.

Causality 추적, lifecycle detection이 동일하게 적용된다.

**해소하는 고통**: WebView 브릿지 디버깅에서 양쪽 로그를 맞춰봐야 하는 문제. MFE iframe 간 통신의 관찰 도구 부재.

**얻는 효용**: 한쪽 로그만으로 전체 흐름을 파악한다. MFE에서 메시지 중계 경로를 시각화한다.

---

### 9. Schema Inference + Usage Analytics

관찰된 메시지들로부터 **실측 기반 스키마를 자동 추론**하고, 그 스키마의 사용 여부까지 측정한다. WebSocket/SSE 영역은 Swagger/OpenAPI처럼 스펙이 잘 유지되지 않아 실제 트래픽과 문서의 괴리가 크다. browse-sent-event는 이미 모든 메시지를 인터셉트하고 저장하고 있으므로, 그 데이터에서 타입을 추론하는 것이 자연스럽다.

**스키마 추론:**

```
channel: wss://api.example.com/ws
├── type: "trade"         observed: 12,847 times
│   └── payload: {
│         symbol: string,           // 100% present
│         price: number,            // 100% present
│         side: "buy" | "sell",     // 100% present, 2 values
│         exchange?: string,        // 73% present (optional)
│       }
```

실측 기반이므로 "100% present"는 샘플에서 증명된 사실이고, "73% (optional)"은 실제 트래픽에서 검증된 optional이다. 백엔드 문서보다 더 믿을 만한 계약이 된다.

**Usage Analytics (causality와 교차):**

Phase 2에서 구축한 causality 매핑과 교차하면 타입 단위 사용성 분석이 가능하다.

- **Dead type**: 서버가 보내는데 어떤 컴포넌트도 쓰지 않는 메시지 타입
- **Dead field**: payload에 포함되지만 어떤 컴포넌트도 읽지 않는 필드
- **Underused field**: 소수 컴포넌트만 쓰는 필드

```
type: "trade"    used by: <TradeList>, <PriceHeader>
├── symbol        used in 3 components  ✓ active
├── price         used in 3 components  ✓ active
├── exchange      used in 0 components  ✗ dead field
└── (type-level)  orphaned: 0.3%        ⚠ occasional
```

**타입 생성 (openapi-typescript의 WebSocket 버전):**

추론된 스키마를 TypeScript 타입 선언으로 내보낼 수 있다. CLI 또는 dev server 엔드포인트로 제공.

```bash
# 현재 관찰 기반으로 타입 생성
$ curl localhost:5173/__browse-sent-event/schema.d.ts > src/types/ws-schema.d.ts

# watch 모드로 자동 갱신
$ browse-sent-event types --watch --out src/types/ws-schema.d.ts
```

```typescript
// 자동 생성된 타입 사용
import type { WsMessage } from './types/ws-schema';

ws.addEventListener('message', (e) => {
  const msg: WsMessage = JSON.parse(e.data);
  if (msg.type === 'trade') {
    // msg.payload가 trade 타입으로 자동 좁혀짐
    console.log(msg.payload.symbol);
  }
});
```

**Schema Drift Detection:**

한번 추론된 스키마를 저장해두면 이후 메시지와 비교해 변경을 감지한다. 백엔드가 필드를 몰래 바꾸거나 새 타입을 추가해도 프론트엔드가 먼저 알아챈다. Phase 2의 `orphaned`, `unexpected-unrendered`와 같은 카테고리의 **계약 위반 감지**이다.

**AsyncAPI Export:**

추론된 스키마를 AsyncAPI 포맷으로 내보내 백엔드 팀과 공식 계약 문서로 공유할 수 있다. "우리가 실제로 받고 있는 건 이거다"라는 증거 기반 계약.

**해소하는 고통**: WebSocket/SSE 메시지의 타입이 문서화되지 않거나, 문서가 실제와 어긋나는 문제. 수동으로 관리하는 타입 정의가 백엔드 변경을 따라가지 못하는 드리프트 문제. "이 필드 아직 쓰나요?"를 판단할 근거가 없는 문제.

**얻는 효용**: 관찰 도구에서 **개발 워크플로우의 일부**로 승격된다. 타입 안전성 확보 + 계약 드리프트 조기 감지 + 사용되지 않는 필드/타입 식별까지 하나의 파이프라인이 된다. "관찰 → 타입 → 계약 건강 → 리팩토링 근거"의 연쇄를 만든다.

---

## 로드맵

### Phase 1 — 핵심 가치 증명

**스코프: Vite-only, main-thread only.**

- core: Proxy 인터셉트 — WebSocket + fetch stream(ReadableStream 감지) + EventSource
- core: 채팅형 타임라인 DevTools UI (Shadow DOM)
- core: 메트릭 수집 + 메모리 링 버퍼
- core: 단순 텍스트 매칭 검색 + `.jsonl`/`.log` export
- Vite 플러그인 + 프로덕션 자동 제거

이것만으로 데모가 나온다. LLM 스트리밍 앱에서 fetch stream과 WebSocket을 하나의 타임라인에서 보여주는 것이 첫 데모의 킬링 포인트.

### Phase 2 — 진짜 차별점: Message-to-UI Causality

**React + Zustand 한정으로 먼저 만든다.**

- trace-react: React fiber 기반 어댑터 (confidence: adapter-backed)
- middleware-zustand: 상태 관리 브릿지
- Message Lifecycle Detection — 단계 모델 + ignore rule
- **trigram 역색인 검색 + lifecycle 상태 필터** (Phase 1의 단순 매칭을 확장)
- DOM 하이라이트 오버레이 (confidence 시각적 구분)
- Confidence model (definitive / adapter-backed / heuristic)

이 단계에서 "메시지를 보여주는 도구"에서 **"메시지의 운명을 보여주는 도구"**로 바뀐다. 대체 불가능한 도구가 되는 시점.

### Phase 3 — Window Messaging + Agent API

- `window.postMessage` 인터셉터 (window boundary surfaces)
- Dev Server 엔드포인트 — JSON first, 보안 기본값 (local-only, payload redaction)
- trace-vue: Vue reactivity 기반 어댑터
- middleware-pinia: Vue 상태 관리 브릿지
- trace-dom: MutationObserver 기반 heuristic 폴백

### Phase 4 — 번들러 확장 + Cold Storage

- webpack / Rspack 플러그인 (각각 별도 지원 트랙)
- Nuxt / Next.js 모듈
- IndexedDB 콜드 스토리지 (옵셔널)
- Web Worker 분리 (메인 스레드 부담 경감)
- 프레임워크 버전 감시 CI: GitHub Actions cron으로 React/Vue/Svelte 리포지터리를 매일 관측, 새 릴리즈 감지 시 자동 Issue 생성 + 해당 버전으로 어댑터 테스트를 matrix 실행하여 호환성 자동 검증

### Phase 5 — Schema Inference + Contract Layer

- 스키마 추론 엔진 (실측 기반 타입 구조 생성)
- Usage Analytics (dead type / dead field / underused field 식별)
- TypeScript 타입 생성 (CLI + `/__browse-sent-event/schema.d.ts` 엔드포인트)
- Schema Drift Detection (이전 스키마와 실시간 비교)
- AsyncAPI Export

이 단계에서 browse-sent-event는 런타임 관찰 도구에서 **개발 워크플로우의 일부**로 승격된다. openapi-typescript가 REST 영역에서 한 역할을 WebSocket/SSE 영역에서 수행한다.

### Phase 6 — 프론트엔드 개발 APM

- Collector + Dashboard 서버 (Docker Compose)
- 팀 단위 세션 공유, 히스토리 비교
- 스테이징/프로덕션 환경 지원 (sampling, payload stripping)

### Appendix — 실험적 WASM 엔진

성능 병목이 실측으로 확인된 후에만 도입한다. 로드맵의 정식 Phase가 아니며, 필요성이 증명되었을 때 진행한다.

JS 엔진과 동일한 `DevtoolsEngine` 인터페이스 뒤에 Rust/Zig WASM 구현체를 교체 가능하게 제공한다. SWC의 `@swc/core`와 `@swc/wasm` 패턴.

```typescript
browseSentEvent({ experimentalWasm: true })
```

**두 가지 최적화 단계를 구분한다:**

- **WASM 엔진 자체**는 추가 헤더 없이 동작한다. Web Worker + WASM으로 trigram 인덱싱, 메트릭 집계, 검색 실행을 메인 스레드에서 분리하여 고빈도 스트림의 메인 스레드 영향을 줄인다. 설치 장벽 없음.
- **SharedArrayBuffer 기반 제로카피**는 별도 옵셔널. Cross-Origin Isolation(COOP/COEP 헤더)이 필요하며, 이 헤더는 외부 리소스 로딩과 popup `postMessage()` 흐름에 영향을 준다. dev-only 도구에 이 헤더 셋업을 요구하는 것은 "설치 장벽 제로" 원칙과 충돌하므로, 극한 성능이 필요한 환경에서만 `experimentalSharedMemory` 옵션으로 제공한다.

---

## 해자 (Moat)

### 1. Message-to-UI Causality라는 개념적 우위

기존 도구는 메시지를 보여준다. browse-sent-event는 **메시지의 운명**을 보여준다. "도착 → 상태 → 컴포넌트 → DOM"의 인과 경로를 추적하는 것은 transport 레벨 로깅 도구와 근본적으로 다른 층위이며, 번들러 플러그인 + 프레임워크 어댑터 + 상태 관리 미들웨어의 조합 없이는 재현하기 어렵다.

### 2. 프로토콜 통합이라는 스코프 우위

WebSocket만 다루는 도구, SSE만 다루는 도구, postMessage만 다루는 도구는 이미 각각 존재한다. 하지만 WebSocket, HTTP stream, window messaging을 **하나의 타임라인, 하나의 causality 추적, 하나의 검색 엔진**으로 통합 관찰하는 도구는 프로토콜별 도구를 조합해도 만들어지지 않는다.

### 3. 에이전트 통합이라는 미개척 영역

LLM 에이전트가 프론트엔드 코드를 수정하는 워크플로우는 지금 막 시작되었다. 에이전트에게 런타임 관찰을 제공하는 도구는 현재 존재하지 않는다.

browse-sent-event는 두 개의 레이어로 이 영역에 진입한다. **Phase 1부터 `.jsonl` export**로 에이전트가 파싱 가능한 기록을 제공하고, **Phase 3에서 JSON API**로 live query 능력을 추가한다. `/__browse-sent-event/snapshot` 같은 에이전트 친화적 인터페이스를 이 시점에 확립하면, 에이전트 도구 생태계에서 표준적 위치를 선점할 수 있다.

### 4. 도입 비용 제로라는 채택 우위

번들러 플러그인 한 줄, 앱 코드 변경 없음, 프로덕션 자동 제거. 한번 팀에 도입되면 제거할 이유가 없다.

### 5. 점진적 깊이라는 확장 우위

Phase 1(타임라인 + 검색)만으로 즉시 가치가 있고, Phase 2(causality + lifecycle detection)에서 대체 불가능한 도구가 되고, Phase 3~4에서 점진적으로 확장한다. Phase 5(schema inference)에서 관찰 도구에서 개발 워크플로우 도구로 승격되고, Phase 6(APM)에서 팀/조직 레이어까지 도달한다. 각 단계가 독립적으로 가치를 제공하면서 다음 단계의 기반이 된다.

### 6. 실측 기반 계약이라는 스펙 공백 우위

WebSocket/SSE 영역은 Swagger/OpenAPI처럼 스펙이 잘 유지되지 않는다. AsyncAPI가 존재하지만 채택률이 낮고, 있어도 실제 트래픽과 맞지 않는 경우가 많다. browse-sent-event는 **스펙이 없으면 실측으로 만든다**. 관찰된 메시지에서 타입을 추론하고, causality와 교차해 사용성을 측정하고, 드리프트를 감지한다. openapi-typescript가 "스펙 → 타입" 파이프라인이라면, browse-sent-event는 "실측 → 타입 + 계약 건강"의 파이프라인이다.

---

## 패키지 구조

```
browse-sent-event/
├── core/
│   ├── interceptors/
│   │   ├── websocket.ts        ← Phase 1
│   │   ├── fetch-stream.ts     ← Phase 1 (ReadableStream 감지)
│   │   ├── eventsource.ts      ← Phase 1
│   │   └── post-message.ts     ← Phase 3
│   ├── lifecycle/
│   │   ├── stages.ts           ← Message Lifecycle 단계 모델
│   │   └── rules.ts            ← ignore rule 엔진
│   ├── schema/                 ← Phase 5
│   │   ├── inference.ts        ← 실측 기반 타입 추론
│   │   ├── usage.ts            ← causality 교차 분석
│   │   ├── drift.ts            ← 스키마 드리프트 감지
│   │   └── emit/
│   │       ├── typescript.ts   ← .d.ts 생성
│   │       └── asyncapi.ts     ← AsyncAPI export
│   └── engine/
│       ├── interface.ts         ← DevtoolsEngine 공통 인터페이스
│       └── js/                  ← 순수 JS 구현
│
├── plugin-vite/                 ← Phase 1 (1차 지원)
├── plugin-webpack/              ← Phase 4
├── plugin-rspack/               ← Phase 4
│
├── trace-react/                 ← Phase 2 (adapter-backed)
├── trace-vue/                   ← Phase 3 (adapter-backed)
├── trace-dom/                   ← Phase 3 (heuristic)
│
├── middleware-zustand/          ← Phase 2
├── middleware-pinia/            ← Phase 3
│
├── cli/                         ← Phase 5 (browse-sent-event types --watch)
│
└── server/                      ← Phase 3 (Dev Server 미들웨어)
    └── endpoints/               ← JSON first, ASCII optional
```

---

## 포지셔닝

백엔드에는 이미 LLM observability 도구가 있다 — LangSmith, Langfuse, Phoenix. 이들은 "프롬프트가 어떻게 처리되었는가", "에이전트가 어떤 경로를 탔는가"를 추적한다.

하지만 프론트엔드에서 **"이 토큰 스트림이 어떤 상태를 거쳐 어떤 컴포넌트까지 도달했는가?"**를 답해주는 도구는 없다. **"WebView 브릿지에서 네이티브가 보낸 응답이 어느 단계에서 멈췄는가?"**를 답해주는 도구도 없다. **"우리가 실제로 받고 있는 WebSocket 메시지의 타입은 무엇인가?"**를 답해주는 도구도 없다.

browse-sent-event는 이 질문들에 하나의 도구로 답한다. 핵심은 "모든 경계면을 관찰한다"는 넓은 슬로건이 아니라, **"메시지가 어디까지 갔고 어디서 죽었는지, 그리고 어떤 모양이어야 하는지 보여준다"**는 날카로운 가치 제안이다.

이 도구가 풀려는 문제는 "있으면 좋겠다"가 아니라, **시장이 이미 이 고통을 겪고 있는데 transport 레벨의 도구로는 답할 수 없는 영역**에 해당한다. 프론트엔드 개발자가 경계면의 복잡성 대신 자기 직무의 깊이에 시간을 쓸 수 있게 만드는 것 — 이것이 browse-sent-event의 존재 이유다.
