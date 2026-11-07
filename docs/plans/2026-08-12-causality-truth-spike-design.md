# Causality Truth Spike 제품 재계획과 설계

**작성일:** 2026-08-12
**상태:** 실행 기준선

## 결정 요약

다음 제품 목표를 Phase 1의 일반적인 완성도 향상보다 우선한다.

> Vite 기반 React 실시간 앱에서 메시지는 도착했지만 화면이 갱신되지 않을 때,
> 개발자가 추가 `console.log` 없이 60초 안에 마지막으로 확인된 단계를 찾는다.

기존 Phase 2의 React 추적, Zustand middleware, lifecycle 자동 진단, trigram 검색,
DOM overlay를 한 번에 구현하지 않는다. 가장 위험한 가정인 causality 정확도를
먼저 검증하는 `Causality Truth Spike`를 수행하고, 성공 기준을 통과할 때만
사용자-facing diagnostic alpha와 외부 beta로 확장한다.

```text
기존 alpha 운영 마감
  → M1 Causality Truth Spike
  → M2 One-path Diagnostic Alpha
  → M3 External Proof / Causality Beta
  → 검증된 증거를 바탕으로만 프레임워크와 기능 확장
```

## 1. 제품 문제와 성공 정의

### 1.1 핵심 사용자

Vite 기반 React 애플리케이션에서 WebSocket, SSE 또는 streaming response를
소비하고, Zustand 같은 외부 상태 저장소로 화면을 갱신하는 프론트엔드
개발자를 첫 사용자로 삼는다.

### 1.2 Job to be Done

> UI가 갱신되지 않았을 때 Network 탭과 여러 `console.log`를 오가지 않고,
> 메시지가 transport, handler, state, React commit 중 어디까지 도달했는지
> 근거와 신뢰 수준을 포함해 확인하고 싶다.

Phase 1은 transport 도착 여부를 빠르게 판별하는 기반을 제공한다. 다음 제품
가치는 "메시지가 왔다"를 넘어 "마지막으로 관찰된 처리 경계가 어디인가"를
답하는 데서 나온다.

### 1.3 북극성 지표

다운로드나 GitHub star보다 다음 지표를 우선한다.

- **Time to confident localization**: 표준 문제에서 근거 있는 실패 경계를 찾는 시간
- transport 도착 여부 판별 목표: 5초 이내
- handler/state/commit 경계 판별 목표: 60초 이내
- definitive로 잘못 표시한 causality: 0건

## 2. 현재 상태와 핵심 간극

현재 engine은 connection과 transport message만 저장한다. handler 실행, 상태
변경, React commit을 나타내는 evidence나 이들 사이의 edge는 없다.

기존 Phase 2 가정에는 다음 문제가 있다.

1. React commit hook은 무엇이 commit됐는지는 알려주지만 특정 메시지가 원인임을
   단독으로 증명하지 못한다.
2. Zustand middleware는 명시적 앱 통합이 필요하므로 앱 코드 변경 없이
   definitive causality를 제공한다는 약속과 양립하지 않는다.
3. 동기 handler 안의 상태 변경은 연결할 수 있지만 `await`, Promise, timer를
   지난 context를 안전하게 자동 전파할 수는 없다.
4. UI를 만들지 않는 정상 메시지도 있으므로 evidence가 없다는 이유만으로
   `orphaned` 또는 `unexpected-unrendered`라고 단정하면 거짓 양성이 된다.
5. 현재 engine은 message mutation마다 전체 snapshot을 만들고 동기 통지한다.
   causality event까지 같은 경로에 추가하면 관찰 도구의 비용이 커질 수 있다.
6. 전체 상태 snapshot과 payload를 trace마다 복제하면 privacy와 memory 문제가
   제품 가설보다 먼저 커진다.

따라서 첫 단계는 기능 수가 아니라 **증거의 정확도와 관찰 비용**을 검증한다.

## 3. 첫 수직 슬라이스

첫 범위를 다음 한 경로로 고정한다.

> 수신 WebSocket 메시지 1건 → 동기 message handler → Zustand state update →
> 이어진 React commit 후보

첫 슬라이스가 답해야 하는 질문은 세 가지다.

1. 애플리케이션 handler가 해당 메시지로 실행됐는가?
2. 같은 동기 call stack에서 Zustand set이 실행되고 root identity가 바뀌었는가?
3. 그 상태 변경 뒤 React commit 후보가 관찰됐는가?

React commit과 DOM 반영을 동일시하지 않으며, 특정 Zustand update가 commit의
유일한 원인이라고 주장하지 않는다.

## 4. Evidence 모델

### 4.1 단계

초기 단계는 실제 계측 지점이 있는 항목만 둔다.

```text
transport.received
  → handler.started / handler.returned
  → zustand.set-observed / state.root-changed
  → react.commit-observed
```

`parsed`, `selected`, `dom.changed`는 첫 모델에서 제외한다.

### 4.2 타입

```ts
type CausalityEventKind =
  | "transport.received"
  | "handler.started"
  | "handler.returned"
  | "zustand.set-started"
  | "zustand.set-completed"
  | "state.root-changed"
  | "react.commit-observed"
  | "adapter.diagnostic";

type CausalityConfidence =
  | "definitive"
  | "adapter-backed"
  | "heuristic"
  | "unavailable";

type CorrelationMethod =
  | "same-native-event"
  | "same-call-stack"
  | "pending-react-commit"
  | "time-window";

interface CausalityNode {
  readonly id: string;
  readonly kind: CausalityEventKind;
  readonly timestamp: number;
  readonly messageId?: string;
  readonly source: {
    readonly adapter: "core" | "websocket" | "zustand" | "react";
    readonly instanceId?: string;
    readonly label?: string;
    readonly version?: string;
  };
  readonly attributes: Record<string, string | number | boolean | null>;
}

interface CausalityEdge {
  readonly id: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly confidence: CausalityConfidence;
  readonly correlationMethod: CorrelationMethod;
  readonly reason: string;
}
```

node와 edge는 append-only로 기록한다. transport node만 `messageId`를 직접
소유하고, 다른 node는 edge로 연결한다. React batching에서는 여러 message 경로가
하나의 commit node로 합쳐질 수 있다. message별 trace는 해당 transport node에서
graph를 순회해 만든 projection이며 별도 mutable chain을 저장하지 않는다.

lifecycle status와 전체 trace confidence는 graph에서 파생한다. 전체 confidence는
해당 경로에서 가장 약한 edge를 따르며, 하나의 commit node에 도달하는 서로 다른
message 경로는 각자의 confidence와 correlation reason을 유지한다.

### 4.3 정확도 계약

| 연결 | confidence | 근거 |
| --- | --- | --- |
| native message → wrapped handler | `definitive` | 같은 `MessageEvent` |
| handler → Zustand set/root identity 변경 | `definitive` | 같은 동기 context stack |
| mutation → React commit 후보 | `adapter-backed` | React adapter가 관찰한 후속 commit |
| 시간상 가까운 event만 연결 | `heuristic` | 명시적 시간창 |

초기 UI와 export는 `awaiting-handler`, `handler-observed`, `state-observed`,
`commit-candidate-observed`, `coverage-incomplete`처럼 증거를 그대로 설명한다.
negative status는 native dispatch가 끝나고 지원 등록 경로의 coverage를 확인한
뒤에도 provisional로만 파생한다. ignore rule과 settle 정책이 검증되기 전에는
`orphaned`나 `unexpected-unrendered`를 오류 이름으로 사용하지 않는다.

## 5. 아키텍처

### 5.1 의존 방향

```text
@browse-sent-event/plugin-vite
              │ development bootstrap
              ▼
@browse-sent-event/core ◀── @browse-sent-event/trace-react
              ▲
              └──────────── @browse-sent-event/middleware-zustand
```

- `core`: framework-neutral evidence model, trace store, 동기 context, bridge,
  lifecycle projection과 패널
- `trace-react`: React DevTools global hook과 Fiber 해석 격리
- `middleware-zustand`: Zustand `set`과 `api.setState` 계측
- `plugin-vite`: development bootstrap 순서와 opt-in adapter 설치만 담당

`core`에는 React 또는 Zustand dependency를 추가하지 않는다. adapter package는
`core`와 대상 라이브러리를 peer dependency로 사용한다.

### 5.2 Core 내부 경계

```text
packages/core/src/causality/
├── model.ts       # framework-neutral 타입
├── trace-store.ts # evidence 보존과 message retention 연동
├── context.ts     # 중첩 가능한 동기 active context stack
├── lifecycle.ts   # evidence → status/confidence projection
└── bridge.ts      # adapter가 사용하는 최소 write surface
```

adapter에는 전체 engine을 노출하지 않고 다음 책임만 가진 bridge를 제공한다.

```ts
interface BrowseSentEventCausalityBridge {
  getActiveContext(): CausalityContext | undefined;
  runWithContext<T>(context: CausalityContext, callback: () => T): T;
  recordNode(input: CausalityNodeInput): CausalityNode;
  recordEdge(input: CausalityEdgeInput): CausalityEdge;
  getTrace(messageId: string): CausalityTrace | undefined;
  subscribeEvidence(listener: CausalityGraphDeltaListener): () => void;
}
```

설치된 runtime은 `Symbol.for("@browse-sent-event/causality")`로 찾을 수 있게 하되,
공개 accessor가 global key와 version negotiation을 소유한다. global envelope에는
`protocolVersion`, capability 목록과 고유 `ownerToken`을 둔다. adapter가 runtime보다
먼저 평가되면 availability listener에 등록하고, 호환되지 않는 version에서는
diagnostic을 남긴 뒤 no-op으로 동작한다.

HMR은 같은 owner의 bridge와 adapter를 재사용해 wrapper를 중첩하지 않는다.
uninstall은 자신의 owner token이 현재 global owner와 같을 때만 symbol을 지우고,
adapter subscription, pending commit과 availability listener를 함께 정리한다.
두 core version이 공존하면 먼저 설치된 compatible owner를 유지한다. adapter는
기존 `__browseSentEventRuntime__` 문자열이나 engine 내부 구조를 직접 읽지 않는다.

기존 `engine.subscribe()`의 snapshot 계약은 유지한다. causality adapter는
`subscribeEvidence()` delta channel을 사용하며 evidence마다 전체 message
snapshot을 복제하지 않는다. UI는 선택된 message의 trace만 읽고 frame 단위로
갱신할 수 있다.

`RingBuffer.push()`가 퇴출된 message를 반환하게 해 해당 message에서만 도달할 수
있는 node와 edge를 정리한다. batched commit처럼 다른 message에서도 참조하는
node는 reference가 남아 있는 동안 보존한다. `clear()`와 uninstall도 graph와
active context를 정리한다.

#### M1 core evidence contract 구현 기준선 (2026-08-16)

core evidence contract는 다음 범위로 구현을 마쳤다.

- engine이 실제 보존 중인 message만 transport root를 만들 수 있고, message/node/edge
  역색인으로 퇴출된 trace 크기에 비례해 정리한다.
- 아직 message trace에 연결되지 않은 node는 기본 1,000개 pending 한도로 제한하며
  초과 제거를 delta로 알린다.
- message trace의 path projection은 기본 256개로 제한하고 `truncated` 여부를
  노출한다. 전체 confidence는 projection 제한과 무관하게 전체 reachable edge의
  가장 약한 confidence를 따른다.
- lifecycle은 `awaiting-handler`, `handler-observed`, `state-observed`,
  `commit-candidate-observed`의 positive evidence만 projection한다. negative 또는
  coverage 판정은 아직 제공하지 않는다.
- `clear()`는 graph와 active context를 비우되 evidence subscription은 유지한다.
  runtime `uninstall()`은 teardown을 한 번만 실행하고 `finally`에서 engine과 evidence
  subscription을 dispose한다.

이 기준선은 `Symbol.for(...)` global envelope, protocol version negotiation, availability
listener와 HMR owner 수명 관리를 아직 포함하지 않는다. 외부 adapter가 bridge를 찾아야
하는 M1 구현 5에 들어가기 직전에 별도 bootstrap 계약으로 구현해 위의 global 접근
설계를 완성한다.

### 5.3 WebSocket handler 경계

WebSocket instance마다 다음 순서로 계측한다.

1. 내부 observer가 native `MessageEvent`와 `messageId`를 `WeakMap`에 연결한다.
2. instance의 이후 `addEventListener("message", listener)`를 감싼다.
3. wrapper는 `handler.started`를 기록하고 `runWithContext()` 안에서 원 listener를
   실행한다.
4. `finally`에서 `handler.returned`를 기록하고 이전 context를 복원한다.
5. `onmessage` setter도 같은 경로에 연결한다.

함수 listener, `handleEvent`, callback/capture별 `removeEventListener`, `once`,
`AbortSignal`, listener의 `this`, 예외 전파와 중첩 dispatch 의미를 보존한다.
`onmessage` getter는 원 listener를 반환하고 재할당 순서를 유지한다. HMR/reinstall,
WebSocket subclass와 borrowed method도 회귀 fixture로 고정한다.

#### M1 WebSocket handler 경계 구현 기준선 (2026-08-16)

- inbound observer는 native capture listener로 먼저 실행되어 동일 `MessageEvent`와
  retained message의 `transport.received` root를 연결한다.
- instance `addEventListener("message", ...)`와 `onmessage`에서 관찰된 동기 handler만
  `handler.started`/`handler.returned`와 definitive edge로 연결한다. 여러 handler는
  같은 root에서 독립된 parallel branch를 만든다.
- listener callback/capture, `once`, `AbortSignal`, object listener의 동적
  `handleEvent`, `this`, event identity와 예외 보고는 native 경로에 위임한다.
- clear, eviction 또는 uninstall로 root/context가 유효하지 않으면 handler를 그대로
  실행하고 새 edge를 만들지 않는다. uninstall 뒤 기존 socket wrapper도 native-only로
  동작한다.

#### M1 adapter bootstrap contract 기준선 (2026-08-24)

- 외부 adapter는 `Symbol.for("@browse-sent-event/causality")` envelope만 통해 bridge를
  찾으며, 기존 `__browseSentEventRuntime__` 문자열이나 engine 내부 구조를 읽지 않는다.
- envelope의 protocol은 현재 `1`, 기본 capability는 `bridge-v1`이다. adapter는 필요한
  protocol과 capability를 명시해 협상하고, 맞지 않으면 bridge를 받지 않는
  `incompatible` availability diagnostic으로 no-op 처리한다.
- adapter가 core보다 먼저 평가된 경우 availability listener가 즉시 `unavailable`을 받고,
  full runtime 설치가 끝난 뒤 `available`을 받는다. listener 오류는 runtime이나 다른
  adapter의 동작을 바꾸지 않는다.
- compatible한 첫 owner는 HMR과 중복 package copy에서도 유지한다. owner token이 다른
  stale uninstall, foreign/non-configurable global 또는 호환되지 않는 protocol은 기존
  envelope를 덮어쓰거나 삭제하지 않는다.

`EventTarget.prototype.addEventListener.call(socket, ...)`처럼 instance wrapper를
우회한 listener는 M1 coverage 밖이다. 따라서 "handler 없음"은 지원 등록 경로
안에서만 provisional로 표시하고 우회 가능성이 있으면 `coverage-incomplete`로
퇴행한다. Promise를 반환한 async handler의 `handler.returned`는 동기 호출 경계만
뜻하며 return value나 thenable metadata를 읽지 않는다. Promise, timer 또는 전역
`EventTarget`은 patch하지 않는다.

### 5.4 Zustand middleware와 production 제거

M1 fixture에서는 명시적 opt-in을 사용한다.

```ts
create(
  traceZustand({ storeId: "trades" })((set) => ({
    // state와 action
  })),
);
```

initializer의 `set`과 외부 `api.setState`를 모두 감싸되 중복 기록을 막는다.
active handler context에서 호출 사실은 `zustand.set-started/completed`로 기록하고,
호출 전후 root identity가 `Object.is` 기준으로 달라졌을 때만 별도의
`state.root-changed` node를 만든다. 이는 의미 있는 field mutation 전체를
증명한다는 뜻이 아니다. 상태 전체나 field value는 저장하지 않고 다음 metadata만
제한적으로 허용한다.

- `storeId`
- 선택적 action label
- `replace` 여부
- before/after identity 변경 여부

top-level key 비교는 getter나 Proxy 실행으로 앱 의미를 바꿀 수 있으므로 M1에서
제외한다.

runtime이 없거나 handler 밖에서 갱신되면 기존 Zustand 동작을 그대로 수행하고
trace에 임의로 연결하지 않는다.

#### M1 Zustand middleware 구현 기준선 (2026-08-24)

- `@browse-sent-event/middleware-zustand`는 core와 Zustand를 peer dependency로 둔
  직접 import opt-in package다. adapter-first availability subscription은 core보다 먼저
  평가돼도 later bootstrap을 받고, `dispose()` 뒤 기존 store는 native setter만 실행한다.
- initializer의 canonical `set`과 초기 `api.setState`를 감싼다. active context와 그
  active node가 retained trace에 남아 있을 때만 `set-started`/`set-completed` node를
  `same-call-stack` definitive edge로 연결한다. node는 `messageId`를 소유하지 않고
  transport root에서 이어지는 edge로만 trace에 포함된다.
- setter 호출 중에는 started node context를 다시 활성화하므로 nested set은 outer set의
  child로 연결된다. root identity가 `Object.is`로 달라진 경우만 후속
  `state.root-changed` evidence를 만든다. state value, top-level key와 object action은
  읽지 않으며 third argument가 string인 경우만 action label로 남긴다.
- stale/evicted context, unavailable/disposed bridge, bridge 오류와 setter 예외는 original
  setter를 정확히 한 번 실행하고 app error/return semantics를 유지한다. initialization
  뒤 다른 third-party middleware가 `api.setState`를 교체하는 조합은 M1 guarantee 밖이며,
  이 middleware를 canonical setter에 가장 가깝게 둔다. 같은 native setter를 받은 nested
  `traceZustand`는 한 wrapper를 공유해 duplicate evidence를 만들지 않으며, first wrapper가
  store ID와 lifecycle을 소유한다.

M1은 이 package의 직접 import fixture까지만 검증한다. 아래 M2 virtual module과
production identity/removal 경로는 아직 구현하지 않는다.

M2의 사용자 계약에서는 app source가 구현 package를 직접 import하지 않는다.
Vite plugin이 제공하는 typed virtual module을 사용한다.

```ts
import { traceZustand } from "virtual:browse-sent-event/zustand";
```

- dev server에서는 virtual module이 `middleware-zustand` 구현을 연결한다.
- production build에서는 같은 module이 side-effect 없는 identity middleware로
  해석되고 tracing package를 import하지 않는다.
- plugin은 build에서도 virtual module의 `resolveId`/`load`만 제공하고 runtime
  bootstrap과 패널 주입은 계속 serve에만 적용한다.
- type declaration은 `plugin-vite`가 제공해 애플리케이션 tsconfig에 별도 private
  package 경로를 노출하지 않는다.
- dev에서 causality option을 켰는데 필요한 adapter peer가 없거나 호환되지 않으면
  부분 계측으로 조용히 진행하지 않고 설치 방법을 포함한 config error를 낸다.

M1은 직접 import한 fixture로 truth 가설만 검증할 수 있지만, M2 진입 전에는
production bundle에서 tracing package와 BSE runtime symbol이 사라지고 원래
Zustand store semantics가 유지되는 fixture 검증이 필수다. 이 제거 경로를 만들 수
없으면 Zustand 통합을 공개하지 않고 기존 production 자동 제거 계약을 유지한다.

### 5.5 React adapter

`__REACT_DEVTOOLS_GLOBAL_HOOK__` 의존은 `trace-react` 안에만 둔다. React DevTools
extension이 없는 기본 브라우저도 지원하려면 renderer 초기화 전에 hook이 존재해야
한다. adapter는 다음 두 경로를 명시적으로 지원한다.

1. 기존 hook이 있으면 `inject`와 `onCommitFiberRoot`를 chain하고 기존 callback의
   `this`, 인수, 순서, 예외 의미를 보존한다.
2. hook이 없으면 `supportsFiber`, renderer registry, `inject`, commit/unmount
   callback 등 M1 fixture에서 검증한 최소 호환 hook을 early bootstrap에서
   설치한다.

adapter는 renderer version을 확인하고 지원하지 않는 signature에서는
`adapter.diagnostic`만 기록한 뒤 비활성화한다. M1은 renderer ID와 root commit
ID까지만 기록한다. Fiber를 순회해 component 후보를 찾는 기능은 truth gate 통과
후 별도 spike로 분리한다.

React batching, concurrent transition, 여러 root 때문에 이 edge는 항상
`adapter-backed`다. event 이름도 `react.commit-observed`로 두며 DOM 반영이나
특정 component가 해당 메시지 때문에 렌더됐다고 단정하지 않는다.

Zustand `set` 안에서 React commit이 reentrant하게 발생할 수 있으므로 pending은
`set-started` 전에 연다. set 실행 중 관찰된 commit은 transaction buffer에 두고,
root identity가 바뀐 경우만 edge 후보로 finalize한다. set 이후의 pending은
M1에서 단일 React root일 때 다음 commit 1회 또는 100ms 중 먼저 도달한 시점까지
유효하다. 여러 pending은 하나의 shared commit node에 연결할 수 있다. 여러 root가
감지되거나 unrelated commit을 구분할 근거가 없으면 자동 연결하지 않고
`coverage-incomplete`를 기록한다. 이 정책의 false positive와 concurrent
transition 누락은 ground-truth fixture에서 측정한다.

기존 DevTools hook callback이 던진 오류는 원래 의미를 보존한다. BSE adapter 내부
오류는 앱으로 전파하지 않고 diagnostic으로 바꾼다. uninstall은 자신 뒤에 다른
wrapper가 설치됐다면 그 wrapper를 덮어쓰지 않는다.

Vite bootstrap은 React renderer보다 adapter가 먼저 초기화되는지, 실제 React
18/19가 최소 hook에 renderer를 inject하고 commit을 전달하는지 fixture에서
검증해야 한다. 기존 React DevTools가 설치된 경우와 없는 경우를 모두 테스트한다.
최소 hook 설치가 React 또는 DevTools의 동작을 바꾸거나 지원 version마다 안정적인
commit을 받지 못하면 자동 설치를 공개하지 않는다. 이 경우 M1에서는 명시적 early
import만 사용하고 M2 진입 전에 통합 계약과 제품 범위를 다시 결정한다.

## 6. Milestone과 gate

### M0. 기존 alpha 운영 마감

완료 (`2026-08-14 KST`). 기존 core `0.1.0-alpha.1`과 plugin-vite
`0.1.0-alpha.2` Release를 prerelease로 공개했고 둘 다 Latest가 아님을 확인했다.
다음 기능 milestone으로 확대하지 않는 별도 운영 gate로 마감했다.

### M1. Causality Truth Spike

**목표:** 공개 기능을 늘리기 전에 한 동기 경로의 증명 가능 범위와 비용을
확인한다.

**2026-08-14 baseline 결과:** semantics와 memory는 통과했지만 full-ring
100 msg/s에서 현재 Phase 1의 절대 CPU 증분이 약 `1.4943 ms/message`
(`149 ms/s`, 약 `14.9%`)로 10% 중단 기준을 넘었다. [Causality 성능
기준선](../performance/causality-benchmark.md)에 따라 evidence 구현 전에 engine의
전체 snapshot 동기 notify 비용을 회수하고 같은 protocol을 한 번 재측정한다.

**2026-08-16 재측정 결과:** subscriber가 없을 때 snapshot 계산을 생략하고 닫힌
panel의 구독을 중단한 뒤 절대 CPU 증분이 `0.0358 ms/message`(`3.58 ms/s`, 단일
main thread의 약 `0.36%`)로 낮아졌다. 상대 overhead `23.58%`는 작은 native
floor의 진단값이며, 합의한 절대 5% gate는 통과했다. Long Task 0건, post-GC used
heap과 semantics도 통과해 core evidence contract로 진행한다.

**Ground-truth fixture:**

- transport 미도착
- 메시지 도착, handler 없음
- handler 실행, state 변경 없음
- state 변경, React commit 후보 없음
- state 변경과 commit 후보 관찰
- `await` 이후 state 변경
- 두 메시지가 하나의 React commit으로 batch

**진입 전 architecture baseline:**

- 계측 없는 앱과 현재 Phase 1 core의 native 의미·성능 benchmark harness
- UI를 닫은 100 msg/s fixture의 현재 CPU 기준선
- 10,000 message retention과 현재 memory 기준선
- delta evidence 통지와 trace eviction 테스트

첫 benchmark 커밋은 framework와 무관한 native/Phase 1 비용 기준선을 고정한다.
primary React 19/Zustand 5와 secondary React 18 exact version은 실제 causality
ground-truth fixture를 도입하는 구현 4~6에서 lockfile과 결과표에 고정한다.

**측정 프로토콜:**

- 고정된 Playwright Chromium과 같은 fixture에서 baseline과 instrumented를
  교차 순서로 각각 5회 측정하고 첫 warm-up 구간은 버린다.
- 60초 동안 100 msg/s를 처리하며 main-thread 처리 ms/message의 median과 p95를
  비교한다.
- ground-truth oracle은 scenario별 예상 node/edge matrix로 두고 각 scenario를
  20회 반복한다. edge precision, stage recall과 exact-boundary accuracy를 함께
  계산한다.
- 지원하지 않는 async 경로가 `coverage-incomplete`로 끝나면 오답으로 세지 않고,
  definitive 또는 commit 연결을 만들면 false positive로 센다.
- Chromium CDP로 GC를 수행한 뒤 capacity 10,000 도달 시점과 추가 50,000건 처리
  후 post-GC used JS heap을 비교한다. 이는 dominator 기반 retained size가 아니다.
  증가 허용값은 2 MiB 또는 plateau의 10% 중 큰 값이다.

**성공 기준:**

- 동기 fixture edge precision과 exact-boundary accuracy 95% 이상, stage recall 90% 이상
- definitive로 잘못 표시한 edge 0건
- 계측 없는 baseline 대비 100 msg/s, UI 닫힘의 추가 median CPU가 단일 main
  thread 시간의 5% 미만이며 p95 long task가 새로 생기지 않음
- capacity 이후 post-GC used JS heap 증가가 측정 허용값 이내
- React DevTools 유무와 HMR fixture 통과
- async와 batching의 지원/비지원 범위를 evidence로 설명 가능

**중단 기준:**

- 동기 경로 precision이 90% 미만
- Promise, timer 또는 광범위한 전역 patch 없이는 정확도를 얻을 수 없음
- 구조 개선 후에도 100 msg/s 추가 CPU가 단일 main thread 시간의 10%를 초과

precision 90~95% 또는 CPU 5~10%의 yellow 구간은 원인이 명확한 개선을 한 번만
허용하고 같은 protocol로 재측정한다. 두 번째에도 성공 기준을 넘지 못하면 범위를
축소하거나 M1을 중단한다.

중단 기준에 걸리면 시간 기반 causality를 자동 진단으로 출시하지 않는다.
명시적 `withMessage()` 계측 또는 message-to-store 범위로 제품 목표를 축소한다.

### M2. One-path Diagnostic Alpha

**목표:** React + Zustand + WebSocket 한 조합에서 사용자가 문제 경계를 찾는
최소 제품을 제공한다.

**진입 gate:**

- typed Zustand virtual module의 dev 연결과 production identity 경로 구현
- production bundle에 tracing package, BSE symbol과 side effect가 없음을 검증
- 원래 Zustand store semantics와 production 자동 제거 계약 유지
- M1 결과와 M2 진입을 사용자에게 브리프하고 승인받음

**범위:**

- message detail의 evidence timeline과 confidence
- 증거 기반 lifecycle 설명
- opt-in Zustand 통합
- trace JSONL export
- 최소 capture/redaction 설정
- 실제형 demo와 다섯 개 진단 시나리오

**성공 기준:**

- 표준 문제 5개 중 4개 이상에서 올바른 경계 제시
- 기존 Network + console 방식보다 진단 시간 50% 이상 단축
- median time to confident localization 60초 이하
- 설치부터 첫 trace까지 10분 이하
- false-positive로 인식된 진단 5% 이하

최소 6명의 대상 개발자가 동일한 표준 문제를 기존 도구와 BSE로 푸는 randomized
crossover test를 수행한다. confident localization은 참가자의 선택이 oracle의
실패 경계와 일치하고 confidence 근거를 설명할 수 있는 경우로 정의한다.

**중단 기준:**

- 6명 crossover test의 median 시간 개선이 25% 미만
- 통합 시간이 15분을 초과해 사용을 포기
- false-positive가 10%를 넘어 진단을 신뢰하지 않음

### M3. External Proof / Causality Beta

**목표:** 통제된 demo가 아닌 실제 프로젝트에서 반복 사용 가치를 증명한다.

**범위:**

- 독립 프로젝트 3개의 4주 파일럿
- 검증된 React/Zustand version matrix
- WebSocket 이후 fetch stream/SSE contract 확장
- 실제 거짓 양성에서 얻은 ignore rule만 추가
- performance, privacy, browser compatibility gate

**성공 기준:**

- 3개 프로젝트 설치, 2개 이상이 4주 동안 주간 반복 사용
- 실제 문제 5건 이상에서 경계 파악에 기여
- 참여자의 70% 이상이 기존 방법보다 빠르다고 평가
- 지원 조합에서 진단 precision 90% 이상

프로젝트 수와 별개로 최소 5명의 실제 사용자가 평가에 참여해야 70% 지표를
판단한다.

반복 사용이 증명되지 않거나 사용자가 causality보다 transport timeline만 계속
사용하면 Vue, agent API, schema inference와 APM 확장을 중단하고 제품 wedge를
재평가한다.

## 7. M1 구현 순서와 커밋 경계

사용자의 `1 구현, 1 커밋` 원칙을 다음처럼 적용한다.

| 순서 | 구현 책임 | 핵심 완료 조건 | 커밋 예시 |
| --- | --- | --- | --- |
| 1 | benchmark와 delta 기반선 | 비용·memory 측정 재현 | `test(perf): causality 계측 기준선 추가` |
| 2 | engine notify 비용 회수 (완료) | full protocol 추가 CPU 약 0.36% | `perf(core): snapshot 통지 비용 절감` |
| 3 | core evidence contract | context, trace, eviction, bridge | `feat(core): causality evidence 계약 추가` |
| 4 | WebSocket handler 경계 | native listener 의미 보존 | `feat(core): WebSocket handler causality 연결` |
| 5 | Zustand middleware | 동기 set과 root identity edge만 definitive | `feat(zustand): 상태 변경 evidence 연결` |
| 6 | React adapter | 최소 hook과 root commit 후보 검증 | `feat(react): React commit evidence 연결` |
| 7 | ground-truth fixture와 판정 | precision·overhead 보고서 | `test(e2e): causality truth fixture 검증` |

각 구현은 서브에이전트가 독립 작업하고, 메인 에이전트가 diff, 테스트, 공개 계약,
거짓 양성 위험을 리뷰한 뒤 한 커밋으로 기록한다. M1 gate 결과를 브리프하고
사용자 승인 없이 M2로 넘어가지 않는다.

## 8. 다른 작업의 배치

- **UI 위치 기억과 일반 polish:** 보류. M2 진단 과업을 막는 UX만 수정한다.
- **성능:** 후순위가 아니라 M1 진입 gate와 모든 milestone의 회귀 gate다.
- **Vite 5~8:** M1/M2는 Vite 8로 가설을 검증한다. M3 전 matrix를 증명하거나
  공식 지원 문구를 실제 검증 범위로 축소한다.
- **브라우저:** M1/M2는 Chromium 중심이다. Firefox/WebKit은 M3 beta gate에서
  검증하거나 지원 주장을 축소한다.
- **Linux visual snapshot:** causality UI가 안정될 때까지 병행 유지보수로 두고,
  M3 직전에 release gate로 올린다.
- **trigram, DOM overlay, Vue/Pinia, postMessage, Agent API, cold storage, schema
  inference:** M3의 반복 가치가 증명되기 전에는 착수하지 않는다.

## 9. 의도적으로 제외하는 범위

- fetch stream, EventSource, XHR handler correlation
- 전역 `JSON.parse` patch와 `parsed` 단계
- Zustand selector와 component identity의 definitive 연결
- Promise, microtask, timer의 자동 async context 전파
- DOM 반영 확정과 overlay
- `orphaned`, `unexpected-unrendered` 자동 오류 판정
- 전체 Zustand state snapshot 또는 field value 저장
- Vue, Pinia, Worker, postMessage
- trigram 검색, cold storage, Agent API

## 10. 검증 원칙

1. adapter가 실패해도 transport 수집과 애플리케이션 동작은 유지한다.
2. 계측 전후 listener, state, render의 observable semantics를 비교한다.
3. exact causality를 증명하지 못한 edge에는 낮은 confidence와 correlation reason을
   반드시 노출한다.
4. payload와 state value는 기본 evidence에 복제하지 않는다.
5. 지원하지 않는 React/Zustand version은 조용히 오진하지 않고 diagnostic을
   남긴다.
6. M1은 UI 완성도가 아니라 precision, false definitive, overhead와 retention으로
   판단한다.

## 참고

- [제품 요구사항](../browse-sent-event-prd.md)
- [제품 방향과 기술 전략](../browse-sent-event-v2.md)
- [ADR-008 프레임워크 어댑터 전략](../browse-sent-event-adr.md#adr-008-프레임워크-어댑터의-비공식-api-의존-전략)
- [React Profiler](https://react.dev/reference/react/Profiler)
- [React useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore)
- [Zustand subscribeWithSelector](https://zustand.docs.pmnd.rs/reference/middlewares/subscribe-with-selector)
