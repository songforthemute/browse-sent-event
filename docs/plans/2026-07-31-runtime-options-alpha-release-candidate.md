---
search: false
---

# Runtime 옵션 alpha 릴리스 후보 구현 계획

> **Codex용:** 구현 단계에서는 `executing-plans`,
> `verification-before-completion`을 사용해 작업 단위로 진행한다.

**목표:** PR #19에서 병합한 Vite plugin runtime 옵션 전달, URL 제외 필터,
사용자 단축키를 실제 설치 가능한 다음 alpha 후보로 만들고, maintainer 수동
publish 직전까지 검증한다.

**아키텍처:** 병합된 `.changeset/bright-options-flow.md`를 release type과 changelog의
단일 입력으로 사용한다. Changesets가 계산한 독립 package version을 적용한 뒤
source build, tarball manifest, dry-run, 임시 소비자 설치를 같은 산출물 기준으로
검증한다. npm publish 권한과 실제 배포는 저장소에 연결하지 않는다.

**기술 스택:** pnpm 11, npm 11, Changesets 2, Turborepo 2, TypeScript 6,
Vite 8, Vitest 4, Playwright, VitePress 2, Node.js test runner.

**관련 문서:**

- `docs/release/npm-publish.md`
- `docs/release/github-release.md`
- `.changeset/README.md`
- `.changeset/bright-options-flow.md`

---

## 현재 상태와 목표

| package | 현재 공개 version | 후보 version |
| --- | --- | --- |
| `@browse-sent-event/core` | `0.1.0-alpha.0` | `0.1.0-alpha.1` |
| `@browse-sent-event/plugin-vite` | `0.1.0-alpha.1` | `0.1.0-alpha.2` |
| `@browse-sent-event/devtools-browser-fixture` | 비공개 `0.0.0` | `0.0.0` 유지 |

후보 version은 `pnpm changeset status --output`이 계산한 값이다. 두 공개 package는
독립적으로 versioning하므로 기존 prerelease 번호를 억지로 맞추지 않는다.

## 범위

### 포함

1. `bright-options-flow` changeset을 이용한 version과 changelog 생성
2. lockfile 재현성과 workspace dependency 변환 확인
3. format, lint, typecheck, test, E2E, build, docs build 검증
4. npm audit와 peer dependency 검증
5. 검증된 tarball 대상 `npm publish --dry-run`
6. 임시 소비자 project에서 tarball 설치와 ESM import 검증
7. release 후보 결과와 maintainer 수동 publish 명령 기록

### 제외

1. 실제 `npm publish`
2. npm token, trusted publishing, GitHub Actions publish 권한 설정
3. npm 공개 전 README의 현재 공개 version 변경
4. Git tag와 GitHub Release 생성
5. Phase 2 causality 기능과 이번 후보에 필요하지 않은 dependency 업데이트

## 설계 결정

### 1. 기존 changeset을 단일 입력으로 사용

runtime 옵션 기능의 사용자 가치는 `bright-options-flow`에 이미 기록됐다. release
준비만 설명하는 changeset을 추가하면 같은 기능이 changelog에 중복되므로 만들지
않는다.

### 2. version 적용 후 전체 gate를 다시 실행

PR #19의 검증 결과는 병합 전 source를 증명하지만, version과 changelog가 반영된
최종 후보 tarball을 증명하지는 않는다. 다음 순서를 유지한다.

```text
changeset version
      ↓
pnpm install
      ↓
pnpm install --frozen-lockfile
      ↓
전체 build/test/security gate
      ↓
pack:check
      ↓
동일 tarball dry-run과 소비자 설치
```

### 3. source package가 아니라 검증된 tarball만 사용

`npm publish ./packages/...`는 pnpm의 `workspace:*` 변환을 거치지 않을 수 있다.
dry-run, 임시 소비자 설치, maintainer용 publish 명령은 모두 `pnpm pack:check`가
출력한 `.tmp-pack/*.tgz`를 가리켜야 한다.

### 4. 공개 전과 공개 후 문서를 분리

후보 PR에서는 package version과 changelog만 바꾸고 README의 현재 공개 version은
registry 값을 유지한다. maintainer가 publish한 뒤 별도 후속 작업에서 공개 version,
`alpha`/`latest` dist-tag, Git tag, GitHub Release를 갱신한다.

## 의식적 기술 부채

| 선택 | 포기하는 것 | 지금 감당 가능한 이유 | 회수 시점 |
| --- | --- | --- | --- |
| 수동 npm publish 유지 | 자동 배포와 자동 provenance | 단일 maintainer alpha 단계에서 publish 권한 노출을 최소화한다 | maintainer가 늘거나 정기 배포가 월 2회 이상이 되고 권한·복구 정책이 확정될 때 |
| alpha 동안 `latest` 유지 | version 생략 설치가 prerelease를 받을 수 있음 | stable version이 없고 npm registry가 `latest` 제거를 거부한 이력이 있다 | 첫 stable version을 공개하면서 `latest`를 stable로 이동할 때 |
| 검증 결과 수동 기록 | release evidence 자동 집계 | 반복 횟수가 적어 필요한 증거 형식을 먼저 안정화할 수 있다 | 같은 후보 절차가 두 번 더 반복되어 자동화 가치가 확인될 때 |

## 커밋 구성

| 순서 | 책임 | 커밋 메시지 |
| --- | --- | --- |
| 1 | 실행 계획과 범위 | `docs(plan): runtime 옵션 alpha 후보 계획 수립` |
| 2 | version과 changelog | `chore(release): runtime 옵션 alpha 후보 생성` |
| 3 | 검증 결과와 수동 publish 경계 | `docs(release): runtime 옵션 alpha 후보 검증 기록` |

기능 오류, 보안 advisory 영향, dependency 변경 필요성이 발견되면 release 커밋에
섞지 않는다. 별도 수정 PR을 먼저 병합하고 후보 브랜치를 최신 `main` 위로
갱신한다.

## 구현 계획

### 작업 1: baseline 고정

1. `origin/main`과 현재 branch의 기준 commit을 기록한다.
2. npm registry의 현재 `alpha`와 `latest` dist-tag를 확인한다.
3. `pnpm changeset status --output`으로 후보 version을 확인한다.
4. 계획 문서와 계획 색인만 첫 커밋에 포함한다.

### 작업 2: version과 changelog 생성

```bash
pnpm changeset version
pnpm install
pnpm install --frozen-lockfile
```

다음을 검토한다.

- core가 `0.1.0-alpha.1`인지
- plugin-vite가 `0.1.0-alpha.2`인지
- fixture가 `0.0.0`인지
- `bright-options-flow`가 소비됐는지
- 두 공개 package changelog에 runtime 옵션 변경이 한 번씩 기록됐는지
- plugin source dependency는 `workspace:*`를 유지하되 publish manifest에서 정확한
  core prerelease version으로 변환될 수 있는지

### 작업 3: 품질과 보안 gate

```bash
pnpm install --frozen-lockfile
pnpm audit --audit-level moderate
pnpm peers check
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm docs:build
pnpm test:release
git diff --check
```

하나라도 실패하면 pack과 dry-run으로 진행하지 않는다. advisory가 발견되면
package name, 영향 범위, patched version, 현재 사용 mode를 확인한 뒤 별도 수정
여부를 결정한다.

### 작업 4: tarball과 dry-run 검증

```bash
pnpm pack:check
```

출력된 core와 plugin tarball에 대해 다음을 확인한다.

- 허용된 7개 파일만 포함하는지
- package name과 후보 version이 정확한지
- README와 LICENSE가 포함됐는지
- plugin publish manifest의 core dependency가 `0.1.0-alpha.1`인지
- source, test, 임시 파일이 포함되지 않았는지
- 각 tarball 대상 `npm publish --dry-run --access public --tag alpha`가 성공하는지

### 작업 5: 임시 소비자 검증

저장소 밖 임시 directory에 최소 Vite project를 만들고 검증된 두 tarball과 현재
호환성 기준 Vite를 설치한다. 다음 ESM import와 plugin config 로드를 확인한다.

```text
@browse-sent-event/core public exports
@browse-sent-event/plugin-vite default export
plugin-vite → core dependency resolution
capacity, panel.hotkey, filter.excludeUrls 설정 typecheck
production build에서 runtime bootstrap 제외
```

임시 project와 tarball은 release evidence가 아니므로 커밋하지 않는다.

### 작업 6: 검증 결과 기록과 PR

이 문서의 결과 절에 실제 commit, 실행 시각, gate 결과, tarball 경로와 크기,
dry-run 결과, 임시 소비자 결과를 기록한다. maintainer가 실행할 publish 명령은
검증된 tarball 절대 경로로 제공하되 실행하지 않는다.

모든 결과를 검토한 뒤 Draft PR을 만들고 CI 결과와 review를 기다린다.

## 완료 기준

- [ ] 공개 package version과 changelog가 후보 값과 일치한다.
- [ ] fixture version은 `0.0.0`을 유지한다.
- [ ] 전체 품질·보안 gate가 통과한다.
- [ ] 두 tarball의 내용과 publish manifest가 검증된다.
- [ ] 두 tarball의 npm dry-run이 통과한다.
- [ ] 임시 소비자 설치, ESM import, Vite build가 통과한다.
- [ ] 실제 npm publish는 실행되지 않는다.
- [ ] 검증 결과와 수동 publish 경계가 한국어 문서에 기록된다.

## 검증 결과

구현과 검증이 끝난 뒤 실제 결과를 기록한다.
