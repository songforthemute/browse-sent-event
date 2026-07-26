# 공개 alpha 문서 기준선 설계

**작성일:** 2026-07-26  
**상태:** 승인됨

## 배경

`@browse-sent-event/core@0.1.0-alpha.0`과 `@browse-sent-event/plugin-vite@0.1.0-alpha.1`이 npm에 공개됐고, 실제 registry에서 Vite 8.0.16과 함께 설치하고 ESM export를 불러오는 검증까지 통과했다. 하지만 저장소의 살아 있는 문서에는 아직 다음 불일치가 남아 있다.

- 루트 README와 release 문서 일부가 첫 alpha 배포 전 상태를 설명한다.
- PRD와 v2 문서가 폐기된 단일 package 설치 경로와 `browse-sent-event/vite` import를 사용한다.
- 사용자가 설치부터 패널 확인까지 따라갈 시작 가이드가 없다.
- 패널 사용, export 계약, protocol별 제한을 한곳에서 확인할 수 없다.
- ADR-017은 Astro + Starlight를 Accepted로 두지만 실제 문서 사이트는 VitePress 2다.
- Changesets와 release 문서가 독립 package version과 현재 alpha 운영 상태를 충분히 설명하지 못한다.
- 과거 구현 계획과 현재 운영 문서가 같은 navigation 층위에 있어 역사적 명령이 현재 절차처럼 보일 수 있다.

## 목표

이번 작업은 공개 alpha 사용자가 저장소 README 또는 GitHub Pages에서 시작해 다음 질문에 스스로 답할 수 있는 문서 기준선을 만든다.

1. 무엇을 설치해야 하는가?
2. 어떤 Node.js와 Vite 환경이 필요한가?
3. Vite 앱에서 어떻게 켜고 확인하는가?
4. 패널에서 무엇을 보고 어떻게 검색하거나 export하는가?
5. 현재 alpha에서 지원되는 설정과 아직 지원되지 않는 설정은 무엇인가?
6. 어떤 transport와 payload가 수집되며 무엇은 수집되지 않는가?
7. package version, npm dist-tag, Git tag, GitHub prerelease는 어떤 규칙으로 관리되는가?

## 비목표

- runtime 또는 Vite plugin 동작을 변경하지 않는다.
- core 옵션을 Vite plugin으로 전달하는 기능을 추가하지 않는다.
- `excludeUrls` 또는 custom hotkey 구현을 수정하지 않는다.
- package version을 올리거나 npm에 다시 publish하지 않는다.
- 과거 구현 계획의 본문을 현재 절차로 다시 쓰지 않는다.
- Phase 2 lifecycle, confidence, causality 모델을 설계하지 않는다.
- 이 PR이 병합되기 전에 Git tag나 GitHub Release를 만들지 않는다.

## 문서 계층

문서를 다음 네 계층으로 구분한다.

| 계층 | 책임 | 주요 파일 |
| --- | --- | --- |
| 현재 기준 | 프로젝트 상태, 제품 계약, 아키텍처 결정 | `README.md`, PRD, ADR, v2 |
| 사용자 가이드 | 설치, 사용, 설정, 제한, 예제 | `docs/guides/*`, `docs/examples/*` |
| 운영 문서 | npm publish, Git tag, GitHub prerelease | `docs/release/*`, `.changeset/README.md`, `CONTRIBUTING.md` |
| 역사 기록 | 구현 당시의 판단과 명령 | `docs/plans/*` |

현재 기준과 사용자 가이드는 실제 공개 package와 코드 동작을 따라 계속 갱신한다. 역사 기록은 본문을 보존하고 인덱스와 상단 경고를 통해 현재 절차와 구분한다.

## 사용자 여정

### 1. 시작하기

`docs/guides/getting-started.md`를 공개 문서의 기본 진입점으로 만든다.

- Node.js 요구사항은 Vite 8의 실제 engine인 `^20.19.0 || >=22.12.0`을 기준으로 적는다.
- 설치 명령은 `@browse-sent-event/plugin-vite@alpha`를 명시한다.
- Vite plugin 등록 예제를 제공한다.
- 개발 서버에서 `BSE` 버튼이 보이는지 확인하게 한다.
- plugin은 `serve`에서만 적용되고 production build에는 주입되지 않는다고 설명한다.
- peer dependency는 Vite 5 이상 9 미만이지만 현재 CI 기준은 Vite 8.0.16임을 구분한다.

### 2. 패널과 export

`docs/guides/panel-and-export.md`에 다음 사용자 동작을 설명한다.

- `BSE` 버튼과 `Cmd/Ctrl+Shift+R`로 패널 열기
- connection 목록, message timeline, message detail
- payload 검색과 In/Out 필터
- JSONL과 compact log export
- export 버튼은 파일을 내려받지 않고 `bse-export` `CustomEvent`를 발생시킨다는 현재 계약
- 정적 seeded demo와 실제 transport interceptor 검증의 차이

### 3. 설정과 제한

`docs/guides/configuration-and-limitations.md`는 타입 선언이 아니라 실제 동작을 기준으로 작성한다.

| 항목 | 현재 상태 |
| --- | --- |
| Vite plugin `enabled` | 지원 |
| core `capacity` | core 직접 설치에서 지원 |
| core `panel.autoOpen` | core 직접 설치에서 지원 |
| core `panel.position` | core 직접 설치에서 지원 |
| core option의 Vite plugin 전달 | 미지원 |
| `filter.excludeUrls` | 타입에는 있으나 interceptor 미연결 |
| custom hotkey 문자열 | 기본 `cmd+shift+r` 이외 미지원 |
| main thread | 지원 |
| Web Worker | 미지원 |

WebSocket, fetch ReadableStream, EventSource, XMLHttpRequest의 수집 범위와 payload 제한도 같은 문서에 표로 둔다.

## 살아 있는 기준 문서 정렬

다음 문서를 현재 registry 상태와 package 구조에 맞춘다.

- `README.md`: 공개 alpha 상태, 실제 version, `@alpha` 설치, 남은 alpha 안정화 작업
- `docs/index.md`: 시작 가이드 중심 홈과 현재 공개 version
- `packages/core/README.md`: core 직접 사용 목적과 alpha 상태
- `packages/plugin-vite/README.md`: `@alpha` 설치와 development-only 계약
- `CONTRIBUTING.md`: 첫 alpha 전 표현 제거, 현재 수동 publish gate 유지
- `.changeset/README.md`: 진행 중인 alpha와 독립 package patch version 설명
- `docs/browse-sent-event-prd.md`: scoped package 설치, 실제 import, 공개 alpha 결정
- `docs/browse-sent-event-v2.md`: 실제 Vite plugin import

package README의 변경은 source에는 즉시 반영되지만 npm package 페이지에는 다음 package publish 때 반영된다. 문서만을 위해 새 alpha를 만들지는 않는다.

## ADR 전략

기존 ADR 본문은 보존하고 superseding ADR을 추가한다.

### ADR-022: VitePress 2 문서 사이트

- ADR-017의 Astro + Starlight 결정을 대체한다.
- VitePress 2 alpha, Vue SFC demo, local search, GitHub Pages 구성을 기록한다.
- VitePress 1.6.4의 advisory 경로를 피하기 위해 VitePress 2 alpha를 선택한 부채와 회수 조건을 기록한다.
- ADR-002의 문서 디렉터리 예시와 ADR-012의 Astro 예외를 현재 VitePress 구조로 갱신하는 역할을 맡는다.

### ADR-023: alpha release identity

- ADR-001의 독립 package version 원칙을 실제 release identity에 연결한다.
- ADR-009의 수동 publish gate를 첫 alpha 이후에도 유지한다고 명시한다.
- npm version과 Git tag는 package 단위로 대응시킨다.
- Git tag 형식은 `<package-name>@<version>`을 사용한다.
- GitHub Release도 package별 prerelease로 만든다.
- 잘못 공개되고 deprecated된 plugin-vite alpha.0에는 GitHub Release를 만들지 않는다.
- 자동 publish와 provenance는 별도 승인 전까지 도입하지 않는다.

## Release 문서 구조

`docs/release/npm-publish.md`는 다음 순서로 재구성한다.

1. 현재 alpha 운영 원칙
2. 현재 registry 상태
3. 다음 alpha 후보를 만드는 절차
4. 보안, build, tarball, dry-run gate
5. maintainer 수동 publish와 publish 후 확인
6. alpha.0 사고와 alpha.1 복구 기록
7. 첫 후보 검증 역사

`docs/release/github-release.md`에는 package-scoped tag와 prerelease 생성 원칙, tag가 가리킬 commit을 기록한다.

| package | version | tag 대상 commit |
| --- | --- | --- |
| `@browse-sent-event/core` | `0.1.0-alpha.0` | `65bc938` |
| `@browse-sent-event/plugin-vite` | `0.1.0-alpha.1` | `7efb1b3` |

실제 tag와 GitHub prerelease는 문서 PR 병합 후 별도 승인 단계에서 만든다.

## 과거 계획 보존

`docs/plans/index.md`를 만들고 각 계획을 `완료`, `대체됨`, `참고용`으로 분류한다. 과거 release 계획 중 현재 실행하면 위험한 명령이 있는 다음 두 문서에는 상단 경고만 추가한다.

- `docs/plans/2026-06-03-npm-publish-readiness.md`
- `docs/plans/2026-07-24-alpha-release-candidate.md`

본문은 당시 의사결정과 실행 기록으로 보존한다.

## Navigation

VitePress navigation은 사용자 여정을 우선한다.

1. 시작하기
2. 가이드
3. 예제
4. 설계
5. 릴리스
6. 계획 기록

홈과 sidebar에서 구현 계획보다 시작하기와 패널 사용 가이드가 먼저 보이게 한다.

## 의식적인 부채

### package README 반영 지연

- 포기하는 것: 이번 PR의 package README 개선이 현재 npm 페이지에 즉시 반영되지 않는다.
- 지금 감당 가능한 이유: 현재 registry README의 설치 명령도 `latest`가 정상 alpha를 가리켜 동작하며, 문서만을 위한 version bump는 release history를 불필요하게 늘린다.
- 회수 시점: 다음 사용자-visible package 변경으로 alpha를 publish할 때 README 포함 여부를 tarball에서 확인한다.

### alpha가 `latest`를 가리키는 상태

- 포기하는 것: tag를 생략한 설치가 stable이 아니라 alpha를 받는다.
- 지금 감당 가능한 이유: stable version이 없고, deprecated된 alpha.0을 `latest`로 남기는 것보다 정상 alpha를 가리키는 편이 안전하다.
- 회수 시점: 첫 stable version을 publish하면서 `latest`를 stable로 이동한다.

### 설정 타입과 실제 동작 차이

- 포기하는 것: `excludeUrls`, custom hotkey, Vite plugin의 core option 전달을 문서상 지원 기능으로 제시하지 않는다.
- 지금 감당 가능한 이유: alpha 사용자에게 실제 동작보다 넓은 계약을 약속하지 않는 것이 우선이다.
- 회수 시점: 각 동작을 테스트로 구현하거나 public type에서 제거하는 후속 기능 PR에서 문서와 함께 갱신한다.

## 검증 전략

- 살아 있는 문서에서 폐기된 `browse-sent-event/vite` import와 단일 package 설치 명령이 사라졌는지 검사한다.
- 사용자 코드 예제를 실제 package export와 비교한다.
- 문서 내부 링크와 VitePress navigation을 build로 검증한다.
- `pnpm format:check`, `pnpm docs:build`, `git diff --check`를 실행한다.
- 실제 registry 설치 결과를 release 문서에 기록한다.
- GitHub Pages workflow가 병합 commit에서 성공하는지 확인한다.

## 후속 작업

이번 문서 PR과 분리해 다음 동작을 각각 기능 이슈로 관리한다.

1. Vite plugin에서 core runtime 옵션 전달
2. `excludeUrls` interceptor 적용
3. custom hotkey parser 또는 public option 축소
4. 첫 stable release criteria
5. ADR-011이 요구하는 Code of Conduct 파일과 운영 연락처 확정
