# 공개 alpha 문서 기준선 구현 계획

> **For Codex:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task.

**목표:** 공개된 npm alpha의 실제 설치 경로, 사용자 동작, 알려진 제한, 문서 도구와 release identity를 살아 있는 문서 전체에 일관되게 반영한다.

**아키텍처:** 문서를 사용자 가이드, 현재 기준, 운영 문서, 역사 기록의 네 계층으로 나눈다. 새 사용자 가이드를 먼저 만든 뒤 README, PRD, ADR, release 문서를 실제 코드와 registry 상태에 맞추고, 마지막에 VitePress navigation과 계획 인덱스를 연결한다. 과거 계획 본문은 보존하고 위험한 release 명령이 있는 문서에만 역사 기록 경고를 추가한다.

**기술 스택:** Markdown, VitePress 2.0.0-alpha.17, Vue SFC seeded demo, pnpm 11.2.2, Changesets, GitHub Pages, npm registry.

**설계 문서:** `docs/plans/2026-07-26-public-alpha-docs-baseline-design.md`

---

## 공통 원칙

1. 모든 문서는 한국어로 작성한다.
2. 사용자 코드 예제는 실제 public export만 사용한다.
3. `@browse-sent-event/plugin-vite@alpha`를 기본 설치 경로로 안내한다.
4. package README 변경만을 이유로 package version을 올리지 않는다.
5. 과거 계획 본문의 명령을 현재 명령으로 다시 쓰지 않는다.
6. 문서에서 미지원 기능을 지원한다고 표현하지 않는다.
7. 하나의 문서 책임을 하나의 커밋으로 유지한다.

## 작업 1: 공개 alpha 사용자 가이드 작성

**파일:**

- 생성: `docs/guides/getting-started.md`
- 생성: `docs/guides/panel-and-export.md`
- 생성: `docs/guides/configuration-and-limitations.md`
- 수정: `docs/examples/devtools-panel.md`

### 단계 1: 사용자 가이드 부재 확인

실행:

```bash
test ! -e docs/guides/getting-started.md
test ! -e docs/guides/panel-and-export.md
test ! -e docs/guides/configuration-and-limitations.md
```

기대 결과:

- 세 명령이 exit code `0`으로 끝난다.
- 현재 공개 문서에 동일 책임의 가이드가 없음을 확인한다.

### 단계 2: 시작하기 가이드 작성

`docs/guides/getting-started.md`를 다음 순서로 작성한다.

1. alpha 안정성 안내
2. 요구사항
3. 설치
4. Vite 설정
5. 개발 서버에서 확인
6. production build 계약
7. 다음 문서 링크

요구사항 표:

| 항목 | 기준 |
| --- | --- |
| Node.js | `^20.19.0 || >=22.12.0` |
| Vite peer range | `>=5.0.0 <9.0.0` |
| 현재 검증 기준 | Vite `8.0.16` |
| 실행 환경 | browser main thread, Vite dev server |

설치 예제:

```bash
pnpm add -D @browse-sent-event/plugin-vite@alpha
```

Vite 설정 예제:

```ts
import { defineConfig } from "vite";
import browseSentEvent from "@browse-sent-event/plugin-vite";

export default defineConfig({
  plugins: [browseSentEvent()],
});
```

확인 절차:

- `pnpm vite` 또는 프로젝트의 Vite dev script를 실행한다.
- 브라우저 앱 오른쪽 아래에 `BSE` 버튼이 나타나는지 확인한다.
- production build output에는 browse-sent-event bootstrap이 들어가지 않는다고 설명한다.

### 단계 3: 패널과 export 가이드 작성

`docs/guides/panel-and-export.md`에 다음 내용을 작성한다.

- `BSE` 버튼으로 열기
- `Cmd+Shift+R` 또는 `Ctrl+Shift+R`로 열고 닫기
- connection 선택
- timeline의 In/Out 방향 읽기
- payload 검색
- 방향 필터
- message detail
- JSONL과 compact log 형식

export 계약은 다음 예제로 설명한다.

```ts
document.querySelector("bse-devtools-panel")?.addEventListener("bse-export", (event) => {
  if (event instanceof CustomEvent) {
    console.log(event.detail.format, event.detail.content);
  }
});
```

다음을 명시한다.

- export 버튼은 alpha 단계에서 파일 다운로드를 시작하지 않는다.
- 현재 검색어와 방향 필터가 export 결과에 적용된다.
- closed Shadow DOM 내부를 직접 조작하는 방법은 public API가 아니다.

### 단계 4: 설정과 제한 가이드 작성

`docs/guides/configuration-and-limitations.md`에 실제 동작 기준의 표를 작성한다.

Vite plugin 예제:

```ts
browseSentEvent({ enabled: process.env.BSE !== "0" });
```

지원 상태:

| 설정 | Vite plugin | core 직접 설치 | 상태 |
| --- | --- | --- | --- |
| `enabled` | 지원 | 해당 없음 | 지원 |
| `capacity` | 전달 불가 | 지원 | 제한적 지원 |
| `panel.autoOpen` | 전달 불가 | 지원 | 제한적 지원 |
| `panel.position` | 전달 불가 | 지원 | 제한적 지원 |
| `panel.hotkey` | 전달 불가 | 기본값만 실동작 | custom 미지원 |
| `filter.excludeUrls` | 전달 불가 | 타입만 존재 | 미지원 |

core 직접 설치 예제:

```ts
import { installBrowseSentEvent } from "@browse-sent-event/core";

installBrowseSentEvent({
  capacity: 2_000,
  panel: {
    autoOpen: true,
    position: "bottom-left",
  },
});
```

직접 설치는 앱 source import이므로 production bundle 포함 여부를 사용자가 직접 관리해야 한다고 경고한다. Vite plugin과 동시에 사용할 때는 bootstrap이 entry보다 먼저 실행되므로 core option 전달 수단으로 사용할 수 없다고 설명한다.

protocol 제한 표에는 다음을 포함한다.

| protocol | 현재 수집 범위 | 주요 제한 |
| --- | --- | --- |
| WebSocket | open, message, send, close | main thread only |
| fetch stream | request와 ReadableStream chunk | 일반 non-stream response는 중심 대상 아님 |
| EventSource | open, message, error/close 상태 | main thread only |
| XMLHttpRequest | 문자열 URL 요청과 최종 응답 | URL 객체, request header, progress chunk 미지원 |

XHR payload 제한에는 GET/HEAD 빈 body, FormData field 이름만 수집, Blob/Document metadata 요약, response `content-type`만 기록을 포함한다.

### 단계 5: seeded demo 설명과 가이드 링크 추가

`docs/examples/devtools-panel.md`에 다음 링크를 추가한다.

- 실제 설치: `../guides/getting-started.md`
- 패널 사용: `../guides/panel-and-export.md`
- 지원 범위: `../guides/configuration-and-limitations.md`

seeded demo는 실제 네트워크 요청을 만들지 않으며, interceptor 동작은 Playwright fixture가 검증한다는 기존 설명을 유지한다.

### 단계 6: 문서 build 검증

실행:

```bash
pnpm docs:build
git diff --check
```

기대 결과:

- VitePress build exit code `0`
- 새 문서 세 페이지가 render 대상에 포함됨
- 공백 오류 없음
- 기존 VueUse/Rollup 주석 경고는 허용

### 단계 7: 사용자 가이드 커밋

```bash
git add docs/guides docs/examples/devtools-panel.md
git commit -m "docs(guide): 공개 alpha 사용자 가이드 추가"
```

## 작업 2: README와 기여·Changesets 상태 정렬

**파일:**

- 수정: `README.md`
- 수정: `packages/core/README.md`
- 수정: `packages/plugin-vite/README.md`
- 수정: `CONTRIBUTING.md`
- 수정: `.changeset/README.md`

### 단계 1: stale 상태 재현

실행:

```bash
rg -n "배포 후보|릴리즈 전 필수 후보|패키지 배포 후|첫 alpha 전" \
  README.md CONTRIBUTING.md .changeset/README.md
```

기대 결과:

- 첫 alpha 이전 상태를 설명하는 문장이 출력된다.

### 단계 2: 루트 README 갱신

다음 내용을 반영한다.

- 상태를 “Phase 1 MVP public alpha 운영 중”으로 변경
- 현재 공개 version 표 추가
- 릴리즈 전 필수 후보 섹션 제거
- 다음 목표를 alpha 사용성 검증과 문서 정리로 변경
- 설치 명령을 `@browse-sent-event/plugin-vite@alpha`로 변경
- public alpha는 compatibility guarantee가 없는 평가 단계임을 명시
- GitHub Pages와 npm package 링크 제공

version 표:

| package | current alpha |
| --- | --- |
| `@browse-sent-event/core` | `0.1.0-alpha.0` |
| `@browse-sent-event/plugin-vite` | `0.1.0-alpha.1` |

### 단계 3: package README 갱신

`packages/plugin-vite/README.md`:

- `@alpha` 설치
- Vite dev server only
- `enabled` 예제
- production build 제외
- 시작하기와 제한 가이드 링크

`packages/core/README.md`:

- 일반 Vite 사용자는 plugin-vite를 우선 설치한다고 설명
- core 직접 설치는 advanced/programmatic usage로 설명
- alpha 상태와 public API 문서 링크
- 현재 core version 표기

현재 npm package 페이지에는 다음 publish 때 반영된다는 사실은 release 문서의 부채 항목에서 관리하고 package README 자체에는 내부 운영 설명을 넣지 않는다.

### 단계 4: CONTRIBUTING과 Changesets 갱신

`CONTRIBUTING.md`:

- “첫 alpha 전까지”를 “alpha 기간 동안”으로 변경
- maintainer 수동 publish 원칙 유지
- public package 변경의 changeset 기준 링크 유지

`.changeset/README.md`:

- “첫 alpha 후보”를 “alpha prerelease 운영”으로 변경
- core와 plugin-vite가 independent version을 가질 수 있음을 명시
- internal dependency patch로 package version이 함께 움직일 수 있음을 설명
- plugin-vite hotfix 때문에 현재 alpha version이 갈라진 사실을 예시로 듦
- manual publish와 verified tarball 원칙 링크 추가

### 단계 5: stale 상태 제거 검증

실행:

```bash
! rg -n "릴리즈 전 필수 후보|패키지 배포 후|첫 alpha 전까지" \
  README.md CONTRIBUTING.md .changeset/README.md
pnpm docs:build
git diff --check
```

기대 결과:

- stale 검색 결과 없음
- VitePress build 성공
- diff whitespace 오류 없음

### 단계 6: 상태 문서 커밋

```bash
git add README.md packages/core/README.md packages/plugin-vite/README.md \
  CONTRIBUTING.md .changeset/README.md
git commit -m "docs(project): 공개 alpha 상태와 설치 기준 정렬"
```

## 작업 3: PRD와 v2 package 계약 정렬

**파일:**

- 수정: `docs/browse-sent-event-prd.md`
- 수정: `docs/browse-sent-event-v2.md`

### 단계 1: 폐기된 package 경로 재현

실행:

```bash
rg -n "npm install -D browse-sent-event|browse-sent-event/vite" \
  docs/browse-sent-event-prd.md docs/browse-sent-event-v2.md
```

기대 결과:

- PRD의 install/import와 v2 import가 출력된다.

### 단계 2: PRD install과 release 상태 갱신

설치 예제를 다음으로 바꾼다.

```bash
pnpm add -D @browse-sent-event/plugin-vite@alpha
```

import는 다음으로 바꾼다.

```ts
import browseSentEvent from "@browse-sent-event/plugin-vite";
```

`OQ2. Phase 1 릴리스 단계`는 open question에서 결정 사항으로 옮기거나 `Resolved`로 표시하고 다음을 기록한다.

- public npm alpha가 시작됨
- public이지만 제한된 평가자를 대상으로 함
- alpha에서 compatibility guarantee를 제공하지 않음
- beta와 stable criteria는 별도 release criteria 작업에서 확정
- 실제 publish는 alpha 동안 maintainer 수동 gate 유지

“릴리스 전 package name 확인”은 완료된 결정으로 갱신한다.

### 단계 3: v2 import 갱신

`browse-sent-event/vite`를 `@browse-sent-event/plugin-vite`로 교체한다. Phase 2 이후 예정 package 이름은 현재 계획으로 유지하되 실제 package와 예정 package를 구분한다.

### 단계 4: package 경로 검증

실행:

```bash
! rg -n "npm install -D browse-sent-event|browse-sent-event/vite" \
  docs/browse-sent-event-prd.md docs/browse-sent-event-v2.md
rg -n "@browse-sent-event/plugin-vite" \
  docs/browse-sent-event-prd.md docs/browse-sent-event-v2.md
pnpm docs:build
git diff --check
```

기대 결과:

- 폐기된 경로 없음
- 실제 plugin package import가 두 문서에 있음
- VitePress build 성공

### 단계 5: 제품 문서 커밋

```bash
git add docs/browse-sent-event-prd.md docs/browse-sent-event-v2.md
git commit -m "docs(product): 공개 alpha package 계약 반영"
```

## 작업 4: 문서 도구와 release identity ADR 추가

**파일:**

- 수정: `docs/browse-sent-event-adr.md`

### 단계 1: ADR 불일치 재현

실행:

```bash
rg -n "ADR-017: 문서 사이트 도구|Astro \\+ Starlight|docs/.*Astro" \
  docs/browse-sent-event-adr.md
```

기대 결과:

- Accepted 상태의 Astro 결정과 Astro dependency 예외가 출력된다.

### 단계 2: ADR-017 상태 표시

ADR-017의 본문은 보존한다. 제목 아래 status를 다음처럼 바꾼다.

```md
**Status:** Superseded by ADR-022

현재 구현 기준은 ADR-022를 따른다. 이 섹션은 결정 이력 보존용이다.
```

### 단계 3: ADR-022 작성

ADR 문서 끝에 `ADR-022: 문서 사이트 도구 (VitePress 2)`를 추가한다.

필수 내용:

- VitePress 2.0.0-alpha.17
- GitHub Pages
- local search
- Vue SFC seeded demo
- VitePress 1.6.4의 Vite/esbuild advisory 경로
- VitePress 2 alpha 사용 부채와 stable 회수 조건
- 실제 `docs/.vitepress` 디렉터리 구조
- ADR-017 supersede
- ADR-002 문서 구조와 ADR-012 docs dependency 예외 갱신

### 단계 4: ADR-023 작성

`ADR-023: alpha release identity와 수동 publish`를 추가한다.

필수 결정:

- package는 Changesets independent version을 유지
- npm version과 Git tag는 package 단위로 일치
- tag 형식은 `<package-name>@<version>`
- GitHub Release는 package별 prerelease
- 실제 publish는 maintainer 수동 실행
- verified pnpm tarball만 publish
- CI에는 npm write credential을 두지 않음
- deprecated plugin-vite alpha.0에는 GitHub Release를 만들지 않음
- stable 전환 시 release criteria와 automation을 재검토

현재 tag mapping:

| package | version | commit |
| --- | --- | --- |
| `@browse-sent-event/core` | `0.1.0-alpha.0` | `65bc938` |
| `@browse-sent-event/plugin-vite` | `0.1.0-alpha.1` | `7efb1b3` |

### 단계 5: ADR 요약 갱신

- ADR-017 status를 Superseded로 변경
- ADR-022, ADR-023 행 추가
- 향후 ADR 번호 목록에서 022, 023과 충돌하는 표현 제거
- ADR-009와 ADR-001에서 현재 release 세부 결정은 ADR-023을 따른다는 짧은 참조 추가

### 단계 6: ADR 검증

실행:

```bash
rg -n "ADR-022|ADR-023|Superseded by ADR-022" docs/browse-sent-event-adr.md
pnpm docs:build
git diff --check
```

기대 결과:

- 새 ADR 두 개와 supersede 표시가 검색됨
- VitePress build 성공

### 단계 7: ADR 커밋

```bash
git add docs/browse-sent-event-adr.md
git commit -m "docs(adr): 문서 도구와 alpha 릴리스 정책 확정"
```

## 작업 5: 현재 alpha release 운영 문서 정리

**파일:**

- 수정: `docs/release/npm-publish.md`
- 생성: `docs/release/github-release.md`

### 단계 1: pre-alpha 운영 문구 재현

실행:

```bash
rg -n "첫 alpha 공개 전|첫 alpha 전까지|실제 npm publish를 실행하지 않았다" \
  docs/release/npm-publish.md
```

기대 결과:

- 현재 운영 설명과 역사 기록이 섞인 위치가 출력된다.

### 단계 2: npm publish 문서 상단 재구성

문서 상단을 다음 순서로 바꾼다.

1. 현재 alpha 운영 원칙
2. 현재 registry 상태
3. 다음 alpha 배포 전 확인
4. build와 공급망 gate
5. verified tarball 생성과 dry-run
6. maintainer 수동 publish
7. publish 후 registry와 소비자 설치 확인

현재 registry 표:

| package | `alpha` | `latest` | 상태 |
| --- | --- | --- | --- |
| core | `0.1.0-alpha.0` | `0.1.0-alpha.0` | 정상 |
| plugin-vite | `0.1.0-alpha.1` | `0.1.0-alpha.1` | 정상 |
| plugin-vite alpha.0 | 해당 없음 | 해당 없음 | deprecated |

실제 registry smoke 결과를 기록한다.

- plugin-vite alpha.1 설치
- core alpha.0 dependency 해석
- Vite 8.0.16 설치
- ESM import 성공
- npm audit 취약점 0건

### 단계 3: 역사 기록 분리

alpha.0 후보 검증과 alpha.0 publish 사고, alpha.1 복구는 `역사 기록` 상위 heading 아래로 이동하거나 각 제목에 역사 기록임을 표시한다. 당시 E401, E404, publish 미실행 문장을 삭제하지 않는다.

현재 절차에서 과거 차단 상태를 참조하지 않도록 heading과 도입 문장을 명확히 한다.

### 단계 4: GitHub release 문서 작성

`docs/release/github-release.md`에 다음을 작성한다.

- package-scoped tag 명명법
- annotated tag 사용
- tag target commit 검증
- GitHub Release `prerelease` 설정
- package별 release notes 구성
- npm version과 Git tag 불일치 시 release 중단
- deprecated alpha.0 처리
- stable에서 `latest`와 GitHub latest release를 전환하는 조건

post-merge 명령 예시는 실행 전 commit을 다시 검증하도록 작성한다.

```bash
git show 65bc938:packages/core/package.json
git show 7efb1b3:packages/plugin-vite/package.json
```

tag와 release 생성 명령은 maintainer 승인 단계로 분리한다.

### 단계 5: release 문서 검증

실행:

```bash
! rg -n "^npm publish ./packages/" docs/release
rg -n "pnpm pack:check|\\.tmp-pack/|package-scoped|prerelease" docs/release
pnpm docs:build
git diff --check
```

기대 결과:

- package 디렉터리 직접 publish 명령 없음
- verified tarball과 prerelease 정책 존재
- VitePress build 성공

### 단계 6: release 문서 커밋

```bash
git add docs/release/npm-publish.md docs/release/github-release.md
git commit -m "docs(release): 현재 alpha 운영과 GitHub 릴리스 절차 정리"
```

## 작업 6: 과거 계획 인덱스와 VitePress navigation 정리

**파일:**

- 생성: `docs/plans/index.md`
- 수정: `docs/plans/2026-06-03-npm-publish-readiness.md`
- 수정: `docs/plans/2026-07-24-alpha-release-candidate.md`
- 수정: `docs/index.md`
- 수정: `docs/.vitepress/config.mts`

### 단계 1: 계획 인덱스 작성

`docs/plans/index.md`를 다음 그룹으로 작성한다.

- 완료된 구현 계획
- 대체된 설계와 계획
- 역사적 release 계획
- 향후 참고 문서

각 행에 날짜, 문서 링크, 상태, 현재 기준 문서 링크를 둔다.

이번 설계와 구현 계획도 인덱스에 추가한다.

### 단계 2: 위험한 역사 명령 경고 추가

다음 두 문서의 제목 아래에 경고를 추가한다.

```md
> [!WARNING]
> 이 문서는 당시 실행 계획을 보존한 역사 기록입니다. 현재 npm 배포에서는 package
> 디렉터리를 직접 publish하지 말고 `docs/release/npm-publish.md`의 verified tarball
> 절차를 사용합니다.
```

대상:

- `docs/plans/2026-06-03-npm-publish-readiness.md`
- `docs/plans/2026-07-24-alpha-release-candidate.md`

본문의 과거 명령은 수정하지 않는다.

### 단계 3: 문서 홈 갱신

`docs/index.md`를 사용자 진입점으로 바꾼다.

상단 순서:

1. 현재 public alpha 상태
2. package version 표
3. 3단계 설치 요약
4. 시작하기 링크
5. 인터랙티브 예제 링크
6. 설계 문서와 계획 기록 링크

“최근 구현 계획”의 긴 목록은 계획 인덱스 링크로 축소한다.

### 단계 4: VitePress navigation 갱신

`docs/.vitepress/config.mts`의 nav:

- 시작하기
- 가이드
- 예제
- 설계
- 릴리스

sidebar:

- 시작하기
- 사용 가이드
- 예제
- 제품과 설계
- 릴리스
- 계획 기록

새 문서 링크:

- `/guides/getting-started`
- `/guides/panel-and-export`
- `/guides/configuration-and-limitations`
- `/release/github-release`
- `/plans/`

### 단계 5: navigation과 build 검증

실행:

```bash
pnpm docs:build
rg -n "/guides/getting-started|/release/github-release|/plans/" \
  docs/.vitepress/config.mts
git diff --check
```

기대 결과:

- VitePress build 성공
- 새 사용자 가이드와 release 문서가 navigation에 있음
- 계획 인덱스가 연결됨

### 단계 6: 계획·navigation 커밋

```bash
git add docs/plans/index.md \
  docs/plans/2026-06-03-npm-publish-readiness.md \
  docs/plans/2026-07-24-alpha-release-candidate.md \
  docs/index.md docs/.vitepress/config.mts
git commit -m "docs(site): 사용자 여정과 계획 기록 navigation 정리"
```

## 작업 7: 전체 문서 회귀 검증

**파일 변경:** 없음. 실패 시 원인이 있는 작업의 파일을 수정하고 별도 fix commit을 만든다.

### 단계 1: 살아 있는 문서의 폐기된 package 경로 검사

과거 계획은 검색 대상에서 제외한다.

```bash
! rg -n "npm install -D browse-sent-event|browse-sent-event/vite|패키지 배포 후" \
  README.md CONTRIBUTING.md .changeset/README.md \
  packages/core/README.md packages/plugin-vite/README.md \
  docs/index.md docs/browse-sent-event-prd.md docs/browse-sent-event-adr.md \
  docs/browse-sent-event-v2.md docs/guides docs/examples docs/release
```

기대 결과: 검색 결과 없음.

### 단계 2: public package 예제 검사

```bash
rg -n "@browse-sent-event/plugin-vite@alpha|@browse-sent-event/plugin-vite" \
  README.md docs/guides packages/plugin-vite/README.md
rg -n "bse-export|Cmd\\+Shift\\+R|Ctrl\\+Shift\\+R" docs/guides
```

기대 결과:

- alpha 설치와 실제 import 예제가 있음
- panel과 export 계약이 문서화됨

### 단계 3: 전체 formatter와 release test

```bash
pnpm format:check
pnpm test:release
git diff --check
```

기대 결과:

- formatter 성공
- release tooling test 8건 이상 통과
- whitespace 오류 없음

`docs/plans/*.md`는 `.prettierignore`에 있으므로 `format:check` 대상이 아니다. 계획 문서는 `git diff --check`와 VitePress build로 검증한다.

### 단계 4: 전체 VitePress build

```bash
pnpm docs:build
```

기대 결과:

- exit code `0`
- broken internal link 없음
- 기존 VueUse/Rollup pure annotation 경고는 허용
- 기존 bundle size 경고가 재현되면 결과에 기록하되 이번 정보 구조 PR에서 번들 최적화하지 않음

### 단계 5: desktop/mobile navigation 확인

문서 dev server를 실행한다.

```bash
pnpm docs:dev --host 127.0.0.1 --port 4175
```

Playwright 또는 in-app browser로 다음 viewport를 확인한다.

- desktop: `1440x900`
- mobile: `390x844`

확인 항목:

- 홈에서 시작하기로 이동
- 시작하기에서 설정·제한 문서로 이동
- 예제 페이지에서 seeded demo 표시
- release 문서와 계획 인덱스 navigation
- 긴 package name과 표가 viewport를 넘지 않음
- sidebar와 본문이 겹치지 않음

### 단계 6: registry smoke evidence 재확인

새 임시 디렉터리에서 실행한다.

```bash
npm install @browse-sent-event/plugin-vite@alpha vite@8.0.16
npm ls @browse-sent-event/plugin-vite @browse-sent-event/core vite
```

기대 version:

- plugin-vite `0.1.0-alpha.1`
- core `0.1.0-alpha.0`
- vite `8.0.16`

ESM import를 확인한다.

```bash
node --input-type=module -e \
  "const plugin = await import('@browse-sent-event/plugin-vite'); const core = await import('@browse-sent-event/core'); console.log(typeof plugin.default, Object.keys(core));"
```

기대 결과:

- plugin default export가 `function`
- core public export가 출력됨

### 단계 7: 최종 branch 상태 확인

```bash
git status --short
git log --oneline origin/main..HEAD
```

기대 결과:

- working tree clean
- 설계, 계획, 사용자 가이드, 상태, ADR, release, navigation 커밋이 논리적으로 분리됨

## 작업 8: PR 생성과 post-merge release action 준비

### 단계 1: branch push

```bash
git push -u origin codex/public-alpha-docs-baseline
```

### 단계 2: draft PR 생성

PR 제목:

```text
docs: 공개 alpha 사용자 문서 기준선 정리
```

PR 본문에 다음을 포함한다.

- 공개 alpha package와 registry smoke 결과
- 새 사용자 가이드 세 개
- PRD/v2 package 경로 수정
- ADR-022, ADR-023
- npm/GitHub release 운영 문서
- 역사 계획 보존 원칙
- package README는 다음 publish 때 npm 페이지에 반영된다는 부채
- code behavior와 package version은 변경하지 않았음
- 전체 검증 결과

### 단계 3: CI와 review 확인

```bash
gh pr checks --watch
gh pr view --json isDraft,mergeable,reviewDecision,statusCheckRollup
```

ready 전환 조건:

- CI 성공
- unresolved review thread 없음
- docs build 성공
- stale package 경로 없음
- 사용자 가이드 예제가 실제 export와 일치

### 단계 4: PR 병합 후 tag 대상 재검증

PR 병합 전에는 tag를 만들지 않는다. 병합 후 다음을 확인한다.

```bash
git show 65bc938:packages/core/package.json
git show 7efb1b3:packages/plugin-vite/package.json
```

기대 결과:

- core `0.1.0-alpha.0`
- plugin-vite `0.1.0-alpha.1`

### 단계 5: maintainer 승인 후 package-scoped tag와 prerelease 생성

생성 대상:

```text
@browse-sent-event/core@0.1.0-alpha.0
@browse-sent-event/plugin-vite@0.1.0-alpha.1
```

원칙:

- annotated tag 사용
- core tag는 `65bc938`
- plugin-vite tag는 `7efb1b3`
- 두 GitHub Release 모두 prerelease
- plugin-vite alpha.0 tag와 Release는 만들지 않음
- 실제 명령은 `docs/release/github-release.md`와 maintainer 승인을 다시 확인한 뒤 실행

### 단계 6: 후속 기능 이슈 분리

문서에 제한으로 기록한 다음 항목은 이 PR에서 구현하지 않는다.

1. Vite plugin core option 전달
2. `excludeUrls` interceptor 적용
3. custom hotkey parser 또는 public option 축소
4. stable release criteria
5. Code of Conduct 운영 연락처

각 항목은 구현 우선순위를 정한 뒤 별도 issue와 feature PR로 진행한다.
