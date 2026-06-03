# 문서 공개와 릴리즈 준비 통합 계획

> **Claude용:** 필수 하위 스킬: `superpowers:executing-plans`, `superpowers:doc-coauthoring`, `superpowers:verification-before-completion`를 사용해 이 계획을 작업 단위로 실행한다.

**목표:** GitHub Pages로 공개된 기술 문서를 프로젝트의 공식 진입점으로 정리하고, npm 배포 전 필요한 패키지 메타데이터와 남은 기술 부채 기준을 명확히 한다.

**아키텍처:** `docs/`는 공개 기술 문서와 구현 계획의 단일 출처로 유지한다. 루트 `README.md`와 GitHub 저장소 metadata는 공개 문서 URL을 가리키고, 배포 대상 패키지는 `packages/core`와 `packages/plugin-vite`로 한정한다.

**기술 스택:** GitHub Pages, VitePress 2 alpha, pnpm 11, Changesets, TypeScript 6, Vite 8, Vitest 4, Playwright.

---

## 현재 상태

| 항목 | 상태 |
| --- | --- |
| GitHub Pages | 활성화됨 |
| 배포 방식 | GitHub Actions `workflow` |
| 공개 URL | `https://songforthemute.github.io/browse-sent-event/` |
| Docs workflow | Pages 활성화 후 수동 재실행 성공 |
| GitHub repo homepage | `https://songforthemute.github.io/browse-sent-event/` |
| 배포 대상 패키지 | `@browse-sent-event/core`, `@browse-sent-event/plugin-vite` |
| 루트 패키지 | `private: true` 유지 |

## 진행 기록

- 2026-05-27: 문서 배포 상태를 README와 VitePress 홈에 반영했다.
- 2026-05-27: `@browse-sent-event/core`, `@browse-sent-event/plugin-vite`의 배포 metadata를 정리했다.
- 2026-05-27: GitHub repo homepage를 공개 문서 URL로 설정했다.
- 2026-05-27: 릴리즈 전 필수 후보와 후속 회수 부채를 분리했다.
- 2026-06-03: 릴리즈 전 필수 후보였던 export 검색어 필터 반영 부채를 회수했다.

## 판단 기준

1. 공개 문서 URL은 README, VitePress 홈, GitHub repo homepage에서 같은 값을 사용한다.
2. 패키지 배포 metadata는 실제 배포 대상 패키지에만 추가한다.
3. runtime/API 변경 없이 metadata와 문서만 바꾸는 경우 release changeset은 만들지 않는다.
4. 이미 기록된 기술 부채는 숨기지 않고, 릴리즈 전 필수와 후속 회수 대상으로 분류한다.

## 구현 계획

### 작업 1: 문서 배포 후처리

**파일:**
- 수정: `README.md`
- 수정: `docs/index.md`
- 수정: `docs/.vitepress/config.mts`
- 수정: `docs/plans/2026-05-25-docs-site-supply-chain.md`
- 생성: `docs/plans/2026-05-27-docs-release-readiness.md`

**단계:**

1. README의 문서 섹션에 공개 기술 문서 URL을 추가한다.
2. VitePress 홈에 공개 주소와 현재 배포 상태를 추가한다.
3. VitePress sidebar에 이 계획 문서를 추가한다.
4. 기존 GitHub Pages 계획 문서에 Pages 활성화와 workflow 재실행 성공 기록을 남긴다.

**커밋:**

```bash
git add README.md docs/index.md docs/.vitepress/config.mts docs/plans/2026-05-25-docs-site-supply-chain.md docs/plans/2026-05-27-docs-release-readiness.md
git commit -m "docs(site): 문서 배포 상태 정리"
```

### 작업 2: 패키지 배포 metadata 정리

**파일:**
- 수정: `packages/core/package.json`
- 수정: `packages/plugin-vite/package.json`

**단계:**

1. 각 패키지에 `description`, `keywords`, `license`, `repository`, `homepage`, `bugs`, `publishConfig`를 추가한다.
2. `repository.directory`는 각 package 디렉터리를 가리키게 한다.
3. `publishConfig.access`는 scoped public package 배포를 전제로 `public`으로 둔다.
4. runtime/API 변경이 없으므로 changeset은 작성하지 않는다.

**커밋:**

```bash
git add packages/core/package.json packages/plugin-vite/package.json
git commit -m "chore(release): 패키지 배포 메타데이터 정리"
```

### 작업 3: 사용법 문서 보강

**파일:**
- 수정: `README.md`
- 수정: `CONTRIBUTING.md`

**단계:**

1. README에 배포 후 설치 명령과 Vite plugin 최소 사용 예시를 추가한다.
2. DevTools가 Vite 개발 서버와 브라우저 main thread를 우선 대상으로 한다는 제한을 명시한다.
3. CONTRIBUTING의 pnpm 요구사항을 현재 `pnpm@11.2.2` 기준으로 갱신한다.

**커밋:**

```bash
git add README.md CONTRIBUTING.md
git commit -m "docs(usage): 설치와 Vite 사용법 추가"
```

### 작업 4: GitHub repo homepage 설정

**대상:**
- GitHub repository metadata

**단계:**

1. repo `homepage`을 `https://songforthemute.github.io/browse-sent-event/`로 설정한다.
2. 설정 후 `gh repo view`로 값을 확인한다.
3. 로컬 파일 변경이 없으므로 별도 커밋은 만들지 않는다.

**명령:**

```bash
gh repo edit songforthemute/browse-sent-event --homepage https://songforthemute.github.io/browse-sent-event/
gh repo view songforthemute/browse-sent-event --json homepageUrl
```

### 작업 5: 기술 부채 릴리즈 기준 정리

**파일:**
- 수정: `README.md`
- 수정: `docs/plans/2026-05-25-devtools-browser-verification.md`

**단계:**

1. README의 남은 정리 작업을 릴리즈 전 필수와 후속 회수로 나눈다.
2. export 검색어 필터 반영은 릴리즈 전 필수 후보로 유지한다.
3. Linux screenshot snapshot 비교는 후속 회수 부채로 유지한다.

**의식적 부채:**

- 포기하는 것: 이번 계획에서 export 검색어 필터와 Linux screenshot snapshot을 직접 구현하지 않는다.
- 감당 가능한 이유: 이번 범위는 공개 문서와 릴리즈 준비 metadata 정리다. 기능 동작은 기존 unit, browser E2E, CI로 검증되고 있다.
- 회수 시점: 첫 npm 배포 전에는 export 검색어 필터 반영 여부를 결정하고, CI 시각 snapshot은 Linux baseline 또는 고정 실행 환경을 마련할 때 회수한다.

**커밋:**

```bash
git add README.md docs/plans/2026-05-25-devtools-browser-verification.md docs/plans/2026-05-27-docs-release-readiness.md
git commit -m "docs(debt): 릴리즈 전 부채 기준 정리"
```

## 검증 계획

### 로컬 검증

```bash
pnpm install --frozen-lockfile
pnpm docs:build
pnpm test
pnpm exec turbo run typecheck --force
pnpm exec turbo run build --force
pnpm lint
pnpm format:check
git diff --check
```

### GitHub Pages 검증

```bash
gh repo view songforthemute/browse-sent-event --json homepageUrl
gh run list --repo songforthemute/browse-sent-event --workflow Docs --branch main --limit 3
curl -I https://songforthemute.github.io/browse-sent-event/
```

**기대 결과:**

- 공개 문서 URL이 README, VitePress, GitHub repo homepage에서 일관된다.
- VitePress 문서 빌드가 성공한다.
- unit test, typecheck, build, lint, format check가 성공한다.
- GitHub Pages URL이 HTTP `200`으로 응답한다.
