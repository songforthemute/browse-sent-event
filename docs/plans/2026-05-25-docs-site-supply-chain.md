# 기술 문서 배포와 공급망 보안 구현 계획

> **Claude용:** 필수 하위 스킬: `superpowers:executing-plans`, `superpowers:verification-before-completion`를 사용해 이 계획을 작업 단위로 실행한다.

**목표:** 현재 DevTools UI 구현 상태를 문서에 반영하고, VitePress 기반 기술 문서 정적 배포를 추가하되, npm 공급망 공격 대응 게이트를 의존성 업데이트 절차에 포함한다.

**아키텍처:** `docs/`는 원문 기술 문서와 VitePress 사이트 엔트리를 함께 보관한다. GitHub Pages 배포는 GitHub Actions의 최소 권한 `push`/수동 실행 workflow로 분리하고, dependency update는 `pnpm`의 minimum release age와 lockfile 검증을 통과한 뒤에만 진행한다.

**기술 스택:** pnpm workspace, pnpm 11.x, VitePress 2.0 alpha, Vite 8.x, Vitest 4.x, Oxlint, Oxfmt, GitHub Pages Actions.

---

## 배경

2026년 5월 npm 생태계에서 TanStack 계열 Mini Shai-Hulud 공급망 공격이 발생했다. 공격은 정상적인 npm publish 경로와 GitHub Actions OIDC 흐름을 악용했으므로, registry signature나 integrity만으로 안전을 단정하지 않는다.

이번 계획은 다음 두 축을 함께 처리한다.

1. 개발자가 읽을 기술 문서를 GitHub Pages로 배포한다.
2. 문서 배포와 의존성 최신화 과정에 공급망 보안 게이트를 넣는다.

## 진행 기록

- 2026-05-25: VitePress 기반 문서 사이트와 GitHub Pages 배포 workflow를 추가했다.
- 2026-05-25: GitHub Pages source를 `GitHub Actions`로 활성화한 뒤 `Docs` workflow를 수동 재실행했다.
- 2026-05-25: 공개 URL `https://songforthemute.github.io/browse-sent-event/`가 HTTP `200`으로 응답하는 것을 확인했다.

## 현재 점검 결과

확인 시각: 2026-05-25 07:59 UTC 기준.

| 패키지 | 현재 | 후보 | 게시 시각 UTC | 판단 |
| --- | --- | --- | --- | --- |
| `pnpm` | `9.15.9` | `11.2.2` | `2026-05-21T13:53:32.587Z` | 1차 후보 |
| `pnpm` | `9.15.9` | `11.3.0` | `2026-05-24T08:43:45.834Z` | 24시간 미만이라 보류 |
| `vite` | `8.0.13` | `8.0.14` | `2026-05-21T07:16:03.179Z` | 후보 |
| `vitest` | `4.1.6` | `4.1.7` | `2026-05-20T07:19:42.142Z` | 후보 |
| `oxlint` | `1.65.0` | `1.66.0` | `2026-05-19T08:08:22.713Z` | 후보 |
| `oxfmt` | `0.50.0` | `0.51.0` | `2026-05-19T08:07:12.732Z` | 후보 |
| `vitepress` | 없음 | `1.6.4` | `2025-08-05T13:40:31.197Z` | audit advisory로 제외 |
| `vitepress` | 없음 | `2.0.0-alpha.17` | `2026-03-19T17:06:38.837Z` | 문서 사이트 후보 |

모든 후보는 `npm view` 기준 `dist.integrity`와 `dist.signatures`를 가진다. 현재 lockfile 기준 `pnpm audit --json`은 advisory 0건이다.

## 구현 계획

### 작업 1: 현재 구현 상태 문서 정리

**파일:**
- 수정: `README.md`
- 수정: `.ai/contexts/phase-1-scope.md`

**단계:**

1. README의 Phase 1 설명에서 "DevTools UI 구현 전" 표현을 제거한다.
2. 구현된 범위에 runtime panel mount, connection list, message timeline, metrics, export event를 추가한다.
3. 남은 범위에 GitHub Pages 문서 배포와 export 검색 필터 부채 회수를 분리해 적는다.

**커밋:**

```bash
git add README.md .ai/contexts/phase-1-scope.md
git commit -m "docs(core): DevTools UI 구현 범위 문서화"
```

### 작업 2: 공급망 보안 게이트 설정

**파일:**
- 수정: `package.json`
- 수정: `pnpm-workspace.yaml`
- 수정: `.npmrc`
- 수정: `pnpm-lock.yaml`

**단계:**

1. `packageManager`를 `pnpm@11.2.2`로 올린다. `pnpm@11.3.0`은 게시 후 24시간 미만이었던 버전으로 기록하고 이번 배치에서는 제외한다.
2. `.npmrc`에는 registry/auth 성격의 설정만 남기고, pnpm 동작 설정은 `pnpm-workspace.yaml`로 옮긴다.
3. `pnpm-workspace.yaml`에 다음 공급망 방어 설정을 추가한다.

```yaml
minimumReleaseAge: 1440
minimumReleaseAgeStrict: true
minimumReleaseAgeIgnoreMissingTime: false
blockExoticSubdeps: true
strictPeerDependencies: true
autoInstallPeers: false
engineStrict: true
```

4. `trustPolicy: no-downgrade`는 별도 검증 항목으로 둔다. 현재 직접/전이 의존성의 provenance 편차 때문에 즉시 강제하면 설치 안정성을 깨뜨릴 수 있으므로, 이번 배치에서는 적용 가능 여부를 실험하고 결과를 문서화한다.

**의식적 부채:**

- 포기하는 것: `trustPolicy: no-downgrade`의 즉시 강제.
- 감당 가능한 이유: `minimumReleaseAgeStrict`, `blockExoticSubdeps`, lockfile integrity, registry signature, audit, script 제한 검사를 먼저 적용한다.
- 회수 시점: `pnpm@11` 전환 후 `pnpm install --frozen-lockfile`이 안정화되면 별도 커밋에서 `trustPolicy`를 켜고 예외 목록을 최소화한다.

**커밋:**

```bash
git add package.json pnpm-workspace.yaml .npmrc pnpm-lock.yaml
git commit -m "chore(deps): pnpm 공급망 보안 게이트 추가"
```

### 작업 2.5: 안전 후보 개발 의존성 갱신

**파일:**
- 수정: `package.json`
- 수정: `packages/plugin-vite/package.json`
- 수정: `pnpm-lock.yaml`
- 수정: `README.md`
- 수정: `docs/browse-sent-event-prd.md`
- 수정: `docs/browse-sent-event-adr.md`

**단계:**

1. 사전 점검을 통과한 `vite@8.0.14`, `vitest@4.1.7`, `oxlint@1.66.0`, `oxfmt@0.51.0`으로 개발 의존성을 갱신한다.
2. `packages/plugin-vite`의 테스트용 `vite` dev dependency도 `^8.0.14`로 맞춘다.
3. `pnpm install --ignore-scripts --no-frozen-lockfile`로 lockfile을 갱신한다.
4. README, PRD, ADR의 현재 개발/테스트 기준을 Vite 8.0.14와 Vitest 4.1.7로 갱신한다.
5. `pnpm why vite rolldown lightningcss vitest`로 번들러 영향 경로를 확인한다.

**커밋:**

```bash
git add package.json packages/plugin-vite/package.json pnpm-lock.yaml README.md docs/browse-sent-event-prd.md docs/browse-sent-event-adr.md docs/plans/2026-05-25-docs-site-supply-chain.md
git commit -m "chore(deps): 개발 도구 패치 버전 갱신"
```

### 작업 3: 문서 사이트 의존성과 스크립트 추가

**파일:**
- 수정: `package.json`
- 수정: `pnpm-lock.yaml`
- 생성: `docs/index.md`
- 생성: `docs/.vitepress/config.mts`

**단계:**

1. `vitepress@1.6.4`를 먼저 검증한다.
2. `pnpm audit`에서 VitePress 1.6.4의 내부 `vite@5.4.21`, `esbuild@0.21.5` 경로가 moderate advisory를 만들면 제외한다.
3. 대체 후보로 `vitepress@2.0.0-alpha.17`을 검증하고, advisory 0건이면 문서 빌드 도구에 한해 채택한다.
4. 루트 script에 `docs:dev`, `docs:build`, `docs:preview`를 추가한다.
5. `docs/index.md`는 기존 `browse-sent-event-prd`, `browse-sent-event-adr`, `browse-sent-event-v2`, 계획 문서로 들어가는 기술 문서 허브로 만든다.
6. VitePress config는 프로젝트명 `browse-sent-event`와 GitHub Pages base path를 명시한다.
7. VitePress 2 alpha가 내부적으로 `vite@^7.3.1`을 의존한다는 점을 lockfile diff와 `pnpm why vite`에서 확인한다. 이는 문서 빌드 도구 경로로 격리되며, runtime/plugin-vite의 Vite 8 지원 범위와 혼동하지 않도록 README에 기록한다.

**의식적 부채:**

- 포기하는 것: stable VitePress 1.6.4 사용.
- 감당 가능한 이유: stable 1.6.4는 현재 audit에서 Vite 5/esbuild advisory를 만든다. 2.0.0-alpha.17은 문서 빌드 도구에만 쓰이고, `pnpm audit`, `pnpm peers check`, `pnpm docs:build`로 검증한다.
- 회수 시점: VitePress 2 stable이 나오거나 VitePress 1.x가 advisory 없는 Vite 경로로 패치되면 alpha 의존을 stable로 되돌린다.

**커밋:**

```bash
git add package.json pnpm-lock.yaml docs/index.md docs/.vitepress/config.mts README.md
git commit -m "docs(site): 기술 문서 사이트 추가"
```

### 작업 4: GitHub Pages 배포 workflow 추가

**파일:**
- 생성: `.github/workflows/docs.yml`

**단계:**

1. workflow trigger는 `push`의 `main` 브랜치와 `workflow_dispatch`만 사용한다.
2. `pull_request_target`은 사용하지 않는다.
3. permissions는 `contents: read`, `pages: write`, `id-token: write`로 제한한다.
4. install은 frozen lockfile과 공급망 게이트를 통과해야 한다.
5. artifact upload와 deploy는 GitHub Pages 공식 action을 사용한다.

**커밋:**

```bash
git add .github/workflows/docs.yml
git commit -m "ci(docs): GitHub Pages 배포 워크플로 추가"
```

## 검증 계획

### 사전 보안 검증

```bash
npm view pnpm@11.2.2 version 'time[11.2.2]' engines deprecated dist.integrity dist.signatures --json
npm view vite@8.0.14 version 'time[8.0.14]' engines deprecated dist.integrity dist.signatures --json
npm view vitest@4.1.7 version 'time[4.1.7]' engines deprecated dist.integrity dist.signatures --json
npm view oxlint@1.66.0 version 'time[1.66.0]' engines deprecated dist.integrity dist.signatures --json
npm view oxfmt@0.51.0 version 'time[0.51.0]' engines deprecated dist.integrity dist.signatures --json
npm view vitepress@1.6.4 version 'time[1.6.4]' engines deprecated dist.integrity dist.signatures --json
npm view vitepress@2.0.0-alpha.17 version 'time[2.0.0-alpha.17]' engines deprecated dist.integrity dist.signatures --json
pnpm audit --json
rg -n "@tanstack|axios|@antv|size-sensor|echarts-for-react|timeago\\.js|github:|git\\+|tarball" package.json pnpm-lock.yaml pnpm-workspace.yaml packages docs
```

**기대 결과:**

- 후보 버전에 `deprecated` 값이 없다.
- 후보 버전에 `dist.integrity`와 `dist.signatures`가 있다.
- `pnpm audit --json`의 vulnerability count가 모두 0이다.
- lockfile과 직접 의존성에 Mini Shai-Hulud 및 최근 npm 오염 사례의 알려진 패키지/비정상 source specifier가 없다.

### 설치 검증

```bash
corepack prepare pnpm@11.2.2 --activate
pnpm install --ignore-scripts
git diff -- package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc
rg -n "requiresBuild|hasBin|postinstall|preinstall|install|github:|git\\+|tarball" pnpm-lock.yaml
pnpm install --frozen-lockfile
pnpm audit --json
```

**기대 결과:**

- lockfile diff가 의도한 후보 의존성만 포함한다.
- 신규 install script 또는 exotic source가 있으면 작업을 멈추고 원인을 문서화한다.
- frozen install과 audit가 exit code `0`으로 끝난다.

### 기능 검증

```bash
pnpm docs:build
pnpm test
pnpm exec turbo run test --force
pnpm exec turbo run typecheck --force
pnpm exec turbo run build --force
pnpm lint
pnpm format:check
git diff --check
```

**기대 결과:**

- 문서 사이트가 정적 빌드된다.
- 전체 테스트, 타입 검사, 빌드, 린트, 포맷 검사가 exit code `0`으로 끝난다.
- `packages/core/dist`와 `packages/plugin-vite/dist`가 생성된다.

## 참고 자료

- TanStack postmortem: https://tanstack.com/blog/npm-supply-chain-compromise-postmortem
- GitHub advisory GHSA-g7cv-rxg3-hmpx: https://github.com/advisories/GHSA-g7cv-rxg3-hmpx
- OpenAI response: https://openai.com/index/our-response-to-the-tanstack-npm-supply-chain-attack/
- pnpm settings: https://pnpm.io/settings#minimumreleaseage
- pnpm 11 release: https://github.com/pnpm/pnpm/releases/tag/v11.0.0
