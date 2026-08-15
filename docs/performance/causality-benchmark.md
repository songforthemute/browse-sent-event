# Causality 성능 기준선

M1 Causality Truth Spike는 새 계측을 추가하기 전에 현재 Phase 1의 비용을 같은
브라우저 workload에서 측정한다. 이 harness는 다음 두 모드를 비교한다.

- `native`: browse-sent-event가 없는 페이지
- `phase1`: 현재 core runtime과 실제로 mount된 닫힌 panel

향후 causality 구현은 같은 schema에 `causality` 모드를 추가해 `causality - phase1`
증분 비용을 비교한다.

## 실행

빠른 smoke는 harness, native semantics oracle과 JSON schema가 동작하는지 확인한다.

```bash
pnpm test:benchmark:causality
pnpm benchmark:causality:smoke
```

의사결정용 full protocol은 약 15분 이상 걸린다.

```bash
pnpm benchmark:causality
```

결과는 git에서 제외된 `.tmp-causality-benchmark/`에 JSON과 Markdown으로 생성된다.
full protocol은 native/phase1을 교차 순서로 각 5회 실행한다. 각 trial은 새 browser
context와 page를 사용하고 capacity 10,000을 먼저 채운 뒤 10초 warm-up과 60초간
100 msg/s 측정을 수행한다. memory workload는 capacity 10,000과 추가 50,000건 뒤
각각 GC를 수행한다. server pacer는 timer가 지연되면 현재 deadline까지 밀린 메시지를
bounded batch로 따라잡고 매 batch 뒤 event loop에 양보한다.

## 측정 항목

- CDP `TaskDuration`의 구간 합계와 실제 수신 건수당 CPU 시간
- 1초 bucket CPU의 p50/p95와 trial aggregate의 median/min/max
- server timestamp 기준 delivery latency p50/p95
- 실제 측정 시간 기준 achieved rate와 수신 inter-arrival p50/p95
- Long Task count, 최대 시간과 total blocking time
- `postGcUsedHeapBytes`: GC 후 CDP `JSHeapUsedSize`
- 수신 count, sequence gap/duplicate, checksum, handler count와 socket lifecycle

`postGcUsedHeapBytes`는 heap snapshot dominator가 계산한 retained size가 아니다.
shared GitHub Actions runner의 CPU/heap 숫자는 PR hard gate로 사용하지 않는다. CI는
deterministic math, semantics oracle과 result schema만 검사한다. 5%/10% 제품 gate의
CPU 비율은 `추가 CPU ms/s ÷ 1,000 ms/s`, 즉 단일 main thread 시간의 절대 점유율이다.
native 비용이 매우 작을 때 커지는 상대 overhead는 진단값으로 함께 기록하되 단독
합격 기준으로 사용하지 않는다. 같은 전용 환경의 full paired 결과에서 절대 delta,
Long Task와 heap 증가를 함께 보고 판단한다.

## 2026-08-14 smoke 증거

Apple Silicon macOS, headless Chromium `148.0.7778.96`, Node `24.19.0`에서 1초
smoke를 실행했다. native와 Phase 1 모두 100건의 sequence/checksum/handler/socket
lifecycle oracle을 통과했고 Long Task는 없었다. 관찰된 CPU는 native
`0.2478 ms/message`, Phase 1 `0.4193 ms/message`, post-GC heap 증가는 각각
`6,828 bytes`, `87,152 bytes`였다.

이 수치는 warm-up 0.2초, 1 pair, capacity 100인 smoke 결과이므로 성능 합격이나
회귀 판정에 사용하지 않는다. full controlled run 전에는 M1의 5%/10% gate 상태를
결정하지 않는다.

## 2026-08-14 full 기준선

같은 환경에서 10,000건 steady state, 10초 warm-up, 100 msg/s를 60초간 처리하는
trial을 모드별 5회 실행했다. 모든 trial에서 모드별 총 30,000건의 semantics oracle을
통과했고 Long Task는 없었다.

| mode    | median CPU ms/msg |   trial min–max | 1초 bucket p50/p95 |
| ------- | ----------------: | --------------: | -----------------: |
| native  |          `0.1668` | `0.1600–0.1751` |    `0.1585/0.1857` |
| Phase 1 |          `1.6611` | `1.3756–1.6925` |    `1.5261/2.2168` |

Phase 1의 상대 overhead는 `895.86%`, 절대 증분은 약 `1.4943 ms/message`다.
100 msg/s에서 약 `149 ms/s`, 즉 메인 스레드 시간 약 `14.9%`에 해당한다.
memory workload의 post-GC used heap 증가는 native `2,832 bytes`, Phase 1
`49,984 bytes`였다.

당시 판정은 **CPU stop / memory pass / semantics pass**였다. causality evidence를
추가하기 전에 `recordMessage()`마다 전체 snapshot과 metrics를 재계산해 동기
subscriber에 전달하는 경로를 delta subscription 또는 UI-side batching으로
개선하고 같은 full protocol을 한 번 재실행한다.

## 2026-08-16 notify 최적화 재측정

subscriber가 없으면 engine이 snapshot을 만들지 않고, panel은 열려 있을 때만
구독하도록 변경한 뒤 같은 환경과 full protocol을 다시 실행했다. 모든 trial은 목표
rate 약 `99.97 msg/s`를 달성했고 모드별 30,000건의 semantics oracle을 통과했으며
Long Task는 없었다.

| mode    | median CPU ms/msg |   trial min–max | 1초 bucket p50/p95 |
| ------- | ----------------: | --------------: | -----------------: |
| native  |          `0.1520` | `0.1435–0.1599` |    `0.1421/0.1739` |
| Phase 1 |          `0.1878` | `0.1758–0.1943` |    `0.1758/0.2274` |

절대 증분은 약 `0.0358 ms/message`다. 100 msg/s에서 `3.58 ms/s`, 즉 단일 main
thread 시간의 약 `0.36%`로 성공 기준 5%보다 낮다. Phase 1 총비용도 약
`18.78 ms/s` 또는 `1.88%`다. native floor가 작아 상대 overhead는 `23.58%`지만,
이는 절대 제품 gate와 함께 해석하는 진단값이다.

memory workload의 post-GC used heap 증가는 native `2,744 bytes`, Phase 1
`53,300 bytes`였고 Phase 1은 두 checkpoint 모두 capacity 10,000을 유지했다.
재측정 판정은 **CPU pass / memory pass / semantics pass**이며 M1 core evidence
contract 구현으로 진행할 수 있다.
