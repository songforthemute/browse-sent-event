# npm 배포 준비 구현 계획

> **Claude용:** 필수 하위 스킬: `superpowers:executing-plans`, `superpowers:verification-before-completion`를 사용해 이 계획을 작업 단위로 실행한다.

**목표:** `@browse-sent-event/core`와 `@browse-sent-event/plugin-vite`를 첫 npm alpha 배포 후보로 만들기 전에, tarball 산출물, Changesets 정책, 공급망 보안 gate, dry-run 검증 절차를 확정한다.

**아키텍처:** 실제 publish는 이 계획의 마지막 검증이 통과하고 npm scope 권한이 확인된 뒤 별도 승인으로만 수행한다. 배포 대상은 `packages/*` 하위의 두 public package로 제한하고, root workspace는 `private: true`를 유지한다. `tsdown`이 `dist`를 생성하고, Changesets가 version bump와 changelog를 관리하며, GitHub Actions release workflow는 배포 가능한 main만 대상으로 한다.

**기술 스택:** pnpm 11, Changesets, Turborepo, tsdown, TypeScript 6, Vite 8, Vitest 4, GitHub Actions, npm registry.

---

## 현재 상태

| 항목 | 현재 값 | 판단 |
| --- | --- | --- |
| root package | `private: true`, `pnpm@11.2.2` | 배포 대상 아님 |
| core package | `@browse-sent-event/core@0.0.0` | 첫 배포 전 version 정책 필요 |
| Vite plugin package | `@browse-sent-event/plugin-vite@0.0.0` | `@browse-sent-event/core`와 함께 배포 필요 |
| package files | `["dist"]` | README/LICENSE 포함 여부를 pack 결과로 확인해야 함 |
| build output | `dist/index.mjs`, `dist/index.d.mts`, sourcemap | `.gitignore` 대상이므로 publish 전 build 필수 |
| Changesets | `.changeset/config.json`, `access: public`, `baseBranch: main` | 기본 설정은 있음 |
| release workflow | 없음 | ADR-009 결정과 구현 사이에 gap 있음 |
| npm registry 조회 | 2026-06-03 15:35 KST 기준 세 package name 모두 `E404` | 미게시 또는 권한 없음. 배포 직전 재확인 필요 |
| Vitest 보안 점검 | 2026-06-06 KST 기준 `vitest@4.1.8` | 알려진 Vitest advisory 영향 범위 밖. Browser Mode/UI 미사용 |
| package tarball gate | 2026-06-07 KST 기준 `pnpm pack:check` 추가 중 | README/LICENSE 포함과 publish manifest 검증을 CI gate로 올림 |

조회한 이름:

```bash
npm view @browse-sent-event/core name version description --json
npm view @browse-sent-event/plugin-vite name version description --json
npm view browse-sent-event name version description --json
```

세 명령 모두 `E404 Not Found`를 반환했다. 단, scoped package는 scope 권한이 없을 때도 같은 형태로 보일 수 있으므로 이것만으로 "배포 가능"을 단정하지 않는다.

## 판단 기준

1. 실제 publish 전에 `npm publish --dry-run`과 pack tarball 검사를 통과해야 한다.
2. tarball에는 실행 산출물, 타입 선언, sourcemap, package metadata, README, license 정보가 포함되어야 한다.
3. `@browse-sent-event/plugin-vite`의 내부 dependency는 publish 산출물에서 `workspace:*`가 아니라 배포 가능한 semver 범위로 변환되어야 한다.
4. user-visible package 변경은 `.changeset/*.md`를 요구한다. 문서나 CI만 바뀌는 경우에는 changeset을 만들지 않는다.
5. npm 공급망 공격 대응을 위해 lockfile, audit, minimum release age, exotic dependency 차단, install script 점검을 release gate에 포함한다.
6. npm scope 소유권과 publish 권한은 코드로 증명할 수 없으므로 publish 전 수동 확인 gate로 둔다.
7. 첫 공개 배포는 PRD의 권장 릴리스 단계에 맞춰 `alpha`로 시작한다. stable은 별도 Release Criteria를 통과한 뒤 전환한다.
8. test runner도 배포 gate의 일부로 본다. Vitest advisory가 발생하면 현재 lockfile 버전이 patched range 이후인지 확인하고, `@vitest/browser`/Vitest UI/Browser Mode 사용 여부를 함께 점검한다.

## Vitest advisory 후속 점검

확인 시각: 2026-06-06 KST 기준.

| advisory | 패키지 | 영향 범위 | 패치 버전 | 현재 판단 |
| --- | --- | --- | --- | --- |
| `GHSA-5xrq-8626-4rwp` / `CVE-2026-47429` | `vitest` | `<3.2.5`, `>=4.0.0 <4.1.0` | `3.2.5`, `4.1.0` | `vitest@4.1.8`이라 영향 없음 |
| `GHSA-2h32-95rg-cppp` / `CVE-2026-47428` | `@vitest/browser` | `>=4.0.17 <4.1.6`, `>=5.0.0-beta.0 <5.0.0-beta.3` | `4.1.6`, `5.0.0-beta.3` | Browser Mode 미사용, 영향 없음 |
| `GHSA-9crc-q9x8-hgqq` / `CVE-2025-24964` | `vitest` | 1.x, 2.x, 3.0.0~3.0.4 일부 | `1.6.1`, `2.1.9`, `3.0.5` | `vitest@4.1.8`이라 영향 없음 |
| `GHSA-8gvc-j273-4wm5` / `CVE-2025-24963` | `vitest` Browser Mode | `2.0.4~2.1.8`, `3.0.0~3.0.3` | `2.1.9`, `3.0.4` | Browser Mode 미사용, 영향 없음 |

현재 `vitest.config.ts`는 `happy-dom` 환경만 사용하고, repository에는 `@vitest/browser`와 `@vitest/ui` 직접 의존성이 없다. `pnpm audit --audit-level moderate`는 advisory 0건을 반환했다.

## 구현 계획

### 작업 1: npm 릴리스 가이드 작성

**파일:**
- 생성: `docs/release/npm-publish.md`
- 수정: `docs/index.md`
- 수정: `docs/.vitepress/config.mts`

**단계 1: release 문서 디렉터리 생성**

`docs/release/` 디렉터리를 만들고 npm 배포 가이드를 작성한다.

**단계 2: 배포 대상과 비대상 명시**

문서에 다음 표를 둔다.

| package | publish | 이유 |
| --- | --- | --- |
| `@browse-sent-event/core` | yes | runtime, interceptors, DevTools panel API |
| `@browse-sent-event/plugin-vite` | yes | Vite 개발 서버 bootstrap injection |
| `browse-sent-event-monorepo` | no | root workspace, `private: true` |
| `examples/*` | no | 테스트 fixture와 데모 |
| `docs/` | no | GitHub Pages 배포 대상 |

**단계 3: 배포 단계 문서화**

가이드는 다음 단계로 구성한다.

1. registry와 scope 권한 확인
2. frozen install, audit, peer check
3. build와 full verification
4. pack tarball 검사
5. `npm publish --dry-run`
6. Changesets version PR 생성
7. release workflow publish 또는 수동 publish 승인

**단계 4: 문서 네비게이션 연결**

`docs/index.md`의 기준 문서 또는 개발 명령 아래에 release 문서 링크를 추가한다.

`docs/.vitepress/config.mts`의 sidebar에 `npm 배포` 항목을 추가한다.

**단계 5: 문서 빌드 검증**

```bash
pnpm docs:build
```

기대 결과:

- VitePress 문서 빌드가 exit code `0`으로 끝난다.
- `npm 배포` 문서가 sidebar에서 접근 가능하다.

**커밋:**

```bash
git add docs/release/npm-publish.md docs/index.md docs/.vitepress/config.mts
git commit -m "docs(release): npm 배포 가이드 추가"
```

### 작업 2: package README와 license 포함 여부 정리

**파일:**
- 생성: `packages/core/README.md`
- 생성: `packages/plugin-vite/README.md`
- 조건부 생성: `packages/core/LICENSE`
- 조건부 생성: `packages/plugin-vite/LICENSE`
- 수정: `packages/core/package.json`
- 수정: `packages/plugin-vite/package.json`

**단계 1: 현재 pack 결과 확인**

```bash
pnpm exec turbo run build --force
mkdir -p .tmp-pack
npm pack ./packages/core --pack-destination .tmp-pack --json
npm pack ./packages/plugin-vite --pack-destination .tmp-pack --json
```

기대 결과:

- 두 tarball이 `.tmp-pack/` 아래에 생성된다.
- JSON 출력의 `files` 목록에 `package/package.json`, `package/dist/index.mjs`, `package/dist/index.d.mts`가 포함된다.
- README 또는 license 파일이 빠져 있으면 다음 단계에서 보강한다.

**단계 2: package README 추가**

`packages/core/README.md`는 다음 내용을 포함한다.

````markdown
# @browse-sent-event/core

WebSocket, fetch ReadableStream, EventSource 흐름을 관찰하는 browse-sent-event core runtime입니다.

## 설치

```bash
pnpm add @browse-sent-event/core
```

## 문서

공개 문서는 https://songforthemute.github.io/browse-sent-event/ 에서 확인합니다.
````

`packages/plugin-vite/README.md`는 다음 내용을 포함한다.

````markdown
# @browse-sent-event/plugin-vite

Vite 개발 서버 entry에 browse-sent-event runtime bootstrap을 주입하는 플러그인입니다.

## 설치

```bash
pnpm add -D @browse-sent-event/plugin-vite
```

## 사용

```ts
import { defineConfig } from "vite";
import browseSentEvent from "@browse-sent-event/plugin-vite";

export default defineConfig({
  plugins: [browseSentEvent()],
});
```
````

**단계 3: license 포함 보강**

`npm pack` 결과에 license 본문이 포함되지 않으면 root `LICENSE`와 같은 MIT license 파일을 각 package 아래에 둔다.

이 선택은 중복처럼 보이지만 package tarball 단위의 라이선스 확인성을 우선한다.

**단계 4: `files` 목록 보정**

package README와 license를 명시적으로 포함해야 하면 각 package의 `files`를 다음처럼 조정한다.

```json
{
  "files": [
    "dist",
    "README.md",
    "LICENSE"
  ]
}
```

**단계 5: pack 결과 재검증**

```bash
rm -rf .tmp-pack
pnpm exec turbo run build --force
mkdir -p .tmp-pack
npm pack ./packages/core --pack-destination .tmp-pack --json
npm pack ./packages/plugin-vite --pack-destination .tmp-pack --json
```

기대 결과:

- 두 tarball 모두 README와 license 정보를 포함한다.
- source file, test file, `.tmp-*`, `playwright-report`, `node_modules`가 포함되지 않는다.

**커밋:**

```bash
git add packages/core/README.md packages/plugin-vite/README.md packages/core/package.json packages/plugin-vite/package.json
git add packages/core/LICENSE packages/plugin-vite/LICENSE
git commit -m "chore(release): 패키지 배포 문서 포함"
```

`LICENSE` 파일이 필요 없다고 pack 결과로 확인되면 두 번째 `git add`는 생략한다.

### 작업 3: tarball 검증 스크립트 추가

**파일:**
- 생성: `scripts/verify-package-tarballs.mjs`
- 생성: `scripts/verify-package-tarballs.test.mjs`
- 수정: `package.json`
- 수정: `.github/workflows/ci.yml`
- 수정: `docs/release/npm-publish.md`

**단계 1: 실패 기준 정의**

스크립트는 `pnpm pack --pack-destination .tmp-pack --json` 결과와 실제 `.tmp-pack` tarball을 읽어 다음 조건을 검사한다.

필수 포함:

- `package/package.json`
- `package/dist/index.mjs`
- `package/dist/index.mjs.map`
- `package/dist/index.d.mts`
- `package/dist/index.d.mts.map`
- `package/README.md`
- `package/LICENSE`

필수 제외:

- `src/`
- `__tests__/`
- `node_modules/`
- `.tmp-`
- `playwright-report/`
- `test-results/`

**단계 2: 구현**

Node.js 표준 라이브러리만 사용한다. 새 npm dependency는 추가하지 않는다.

스크립트는 다음 순서로 동작한다.

1. `.tmp-pack`을 비운다.
2. `packages/core`에서 `pnpm pack --pack-destination .tmp-pack --json`을 실행한다.
3. `packages/plugin-vite`에서 `pnpm pack --pack-destination .tmp-pack --json`을 실행한다.
4. JSON의 `files[].path`를 검사한다.
5. `@browse-sent-event/plugin-vite` tarball의 `package.json`을 열어 `dependencies["@browse-sent-event/core"]`가 `workspace:*`이면 실패한다.

**단계 3: root script 추가**

`package.json`에 다음 script를 추가한다.

```json
{
  "scripts": {
    "test:release": "node --test scripts/verify-package-tarballs.test.mjs",
    "pack:check": "node scripts/verify-package-tarballs.mjs"
  }
}
```

CI는 package build 이후 `pnpm pack:check`를 실행해 tarball 계약을 검증한다.

**단계 4: 실패 검증**

필수 파일 목록을 임시로 하나 더 추가해 실패를 확인한다.

```bash
pnpm pack:check
```

기대 결과:

- 누락된 파일명과 package 이름을 출력하고 exit code `1`로 끝난다.

임시 실패 조건을 되돌린다.

**단계 5: 성공 검증**

```bash
pnpm exec turbo run build --force
pnpm pack:check
```

기대 결과:

- 두 package tarball 검사 결과가 모두 통과한다.
- `.tmp-pack`에는 실제 publish 후보 tarball만 남는다.

**커밋:**

```bash
git add package.json scripts/verify-package-tarballs.mjs docs/release/npm-publish.md
git commit -m "test(release): 패키지 tarball 검증 추가"
```

### 작업 4: Changesets 릴리스 정책 확정

**파일:**
- 수정: `.changeset/README.md`
- 수정: `docs/release/npm-publish.md`
- 수정: `docs/browse-sent-event-prd.md`

**단계 1: changeset 작성 기준을 한국어로 정리**

`.changeset/README.md`를 다음 기준으로 갱신한다.

| 변경 종류 | changeset |
| --- | --- |
| public API 추가, 제거, 타입 변경 | 필요 |
| runtime 동작 변경 | 필요 |
| Vite plugin 사용자 동작 변경 | 필요 |
| package metadata, README, release workflow | 필요 없음 |
| docs site 문서만 변경 | 필요 없음 |
| test, lint, CI 검증만 변경 | 필요 없음 |

**단계 2: 0.x semver 정책 작성**

첫 공개 배포 전에는 다음 정책을 사용한다.

| 변경 | bump |
| --- | --- |
| breaking change | minor |
| backward-compatible feature | minor |
| bug fix | patch |
| docs-only | none |

stable `1.0.0` 이후에는 일반 SemVer로 전환한다.

**단계 3: 첫 alpha version 후보 명시**

PRD의 `alpha 2주 -> beta 4주 -> stable` 권장안을 유지하고, 첫 npm 후보를 `0.1.0-alpha.0`로 둔다.

실행 방식은 Changesets prerelease mode를 우선 검토한다.

```bash
pnpm changeset pre enter alpha
pnpm changeset
pnpm changeset version
```

기대 결과:

- `@browse-sent-event/core`와 `@browse-sent-event/plugin-vite`가 같은 prerelease 흐름에 들어간다.
- package 간 dependency가 publish 가능한 semver로 갱신된다.

**단계 4: 정책 문서 검증**

```bash
pnpm docs:build
```

기대 결과:

- release 정책 문서가 빌드된다.
- PRD의 Phase 1 릴리스 단계와 충돌하지 않는다.

**커밋:**

```bash
git add .changeset/README.md docs/release/npm-publish.md docs/browse-sent-event-prd.md
git commit -m "docs(release): changeset 배포 정책 정리"
```

### 작업 5: release workflow 초안 추가

**파일:**
- 생성: `.github/workflows/release.yml`
- 수정: `docs/release/npm-publish.md`
- 수정: `docs/browse-sent-event-adr.md`

**단계 1: publish 인증 방식 결정 gate 작성**

문서에 두 방식 중 하나만 선택하도록 명시한다.

| 방식 | 조건 | 주의 |
| --- | --- | --- |
| `NPM_TOKEN` | npm automation token을 GitHub secret으로 등록 | token rotation과 최소 권한 관리 필요 |
| npm trusted publishing | npm package와 GitHub workflow를 trusted publisher로 연결 | `id-token: write` 권한이 필요하며 workflow 오염 방지 gate가 중요 |

둘을 동시에 활성화하지 않는다.

**단계 2: workflow 초안 작성**

`release.yml`은 `main` push와 `workflow_dispatch`에서만 실행한다.

필수 속성:

```yaml
permissions:
  contents: write
  pull-requests: write
```

trusted publishing을 선택한 경우에만 다음 권한을 추가한다.

```yaml
id-token: write
```

필수 단계:

1. checkout, `fetch-depth: 0`, `persist-credentials: false`
2. Node.js `24.13.0`
3. `corepack prepare pnpm@11.2.2 --activate`
4. `pnpm install --frozen-lockfile`
5. `pnpm audit --audit-level moderate`
6. `pnpm peers check`
7. `pnpm test`
8. `pnpm exec turbo run typecheck --force`
9. `pnpm exec turbo run build --force`
10. `pnpm pack:check`
11. Changesets action

Changesets action 초안:

```yaml
- name: Create release PR or publish
  uses: changesets/action@v1
  with:
    publish: pnpm changeset publish
    createGithubReleases: true
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

trusted publishing을 채택하면 `NPM_TOKEN` 대신 npm 공식 문서에 맞춰 `pnpm changeset publish`가 provenance를 사용하도록 조정한다. 이 부분은 구현 시점의 npm 공식 문서를 확인한 뒤 확정한다.

**단계 3: workflow와 ADR 정합성 확인**

ADR-009의 Release workflow 설명이 실제 workflow와 어긋나지 않게 보정한다.

**의식적 부채:**

- 포기하는 것: release workflow 추가와 동시에 실제 npm publish까지 수행하는 것.
- 감당 가능한 이유: publish 권한, scope 소유권, package tarball, dry-run 검증은 repo 안팎의 상태를 함께 요구한다. workflow 초안과 dry-run gate를 먼저 만들면 실제 배포 전 위험을 줄일 수 있다.
- 회수 시점: npm scope 권한 확인, release secret 또는 trusted publisher 설정, `npm publish --dry-run` 통과 후 첫 alpha publish 승인 시점.

**커밋:**

```bash
git add .github/workflows/release.yml docs/release/npm-publish.md docs/browse-sent-event-adr.md
git commit -m "ci(release): changesets 배포 워크플로 초안 추가"
```

### 작업 6: 첫 alpha dry-run 실행

**파일:**
- 생성: `.changeset/<generated-name>.md`
- 수정: `package.json`
- 수정: `packages/core/package.json`
- 수정: `packages/plugin-vite/package.json`
- 수정: `pnpm-lock.yaml`
- 수정: `docs/release/npm-publish.md`

**단계 1: registry와 권한 재확인**

```bash
npm view @browse-sent-event/core name version description --json
npm view @browse-sent-event/plugin-vite name version description --json
npm access ls-packages @browse-sent-event
```

기대 결과:

- `npm view`가 여전히 `E404`이거나, 의도한 owner가 아닌 기존 package가 없음을 확인한다.
- `npm access ls-packages`는 현재 계정이 scope에 접근 가능한지 보여준다.

**단계 2: prerelease changeset 생성**

```bash
pnpm changeset pre enter alpha
pnpm changeset
```

changeset 내용:

```markdown
---
"@browse-sent-event/core": minor
"@browse-sent-event/plugin-vite": minor
---

첫 npm alpha 배포 후보를 준비한다.
```

**단계 3: version 적용**

```bash
pnpm changeset version
pnpm install --frozen-lockfile
```

기대 결과:

- 두 package가 `0.1.0-alpha.0` 후보가 된다.
- plugin package의 internal dependency가 publish 가능한 prerelease range로 갱신된다.

**단계 4: dry-run publish**

```bash
pnpm exec turbo run build --force
pnpm pack:check
npm publish ./packages/core --dry-run --access public
npm publish ./packages/plugin-vite --dry-run --access public
```

기대 결과:

- 두 dry-run 모두 exit code `0`으로 끝난다.
- 실제 publish는 발생하지 않는다.
- package size, unpacked size, total files가 release guide에 기록된다.

**단계 5: 소비자 설치 검증**

```bash
rm -rf .tmp-consumer
mkdir .tmp-consumer
cd .tmp-consumer
npm init -y
npm install ../.tmp-pack/browse-sent-event-core-*.tgz ../.tmp-pack/browse-sent-event-plugin-vite-*.tgz
node --input-type=module -e "import('@browse-sent-event/core').then((m) => console.log(typeof m.installBrowseSentEvent))"
node --input-type=module -e "import('@browse-sent-event/plugin-vite').then((m) => console.log(typeof m.default))"
```

기대 결과:

- core import가 `function`을 출력한다.
- plugin-vite default import가 `function`을 출력한다.
- install 과정에서 peer dependency 경고가 있으면 release guide에 기록하고, Vite peer 설치 안내를 보강한다.

**커밋:**

```bash
git add .changeset package.json packages/core/package.json packages/plugin-vite/package.json pnpm-lock.yaml docs/release/npm-publish.md
git commit -m "chore(release): 첫 alpha dry-run 준비"
```

## 검증 계획

### 로컬 검증

```bash
pnpm install --frozen-lockfile
pnpm audit --audit-level moderate
pnpm peers check
pnpm docs:build
pnpm test
pnpm test:e2e
pnpm exec turbo run typecheck --force
pnpm exec turbo run build --force
pnpm pack:check
pnpm lint
pnpm format:check
git diff --check
```

기대 결과:

- 모든 명령이 exit code `0`으로 끝난다.
- `pnpm docs:build`는 기존 VitePress/Rollup 주석 경고가 있어도 빌드는 성공해야 한다.
- `pnpm pack:check`는 두 package의 tarball 포함/제외 계약을 검증한다.

### npm dry-run 검증

```bash
npm view @browse-sent-event/core name version description --json
npm view @browse-sent-event/plugin-vite name version description --json
npm publish ./packages/core --dry-run --access public
npm publish ./packages/plugin-vite --dry-run --access public
```

기대 결과:

- 기존 package와 이름 충돌이 없다.
- dry-run 결과에 실제 publish가 발생하지 않는다.
- tarball 파일 수, 크기, dependency metadata가 release guide의 기록과 일치한다.

### GitHub 검증

```bash
gh workflow view release.yml --repo songforthemute/browse-sent-event
gh pr checks <release-pr-number>
```

기대 결과:

- release workflow가 repository에서 인식된다.
- release PR 또는 dry-run PR의 CI가 통과한다.
- 실제 publish 권한이 필요한 단계는 secret/trusted publisher 설정 전에는 실행하지 않는다.

## 실제 publish 전 차단 조건

다음 중 하나라도 만족하지 않으면 publish하지 않는다.

- npm 계정이 `@browse-sent-event` scope publish 권한을 갖는지 확인되지 않았다.
- `npm view` 결과에서 같은 package name이 다른 owner에 의해 점유되어 있다.
- `pnpm audit --audit-level moderate`가 실패한다.
- Vitest/Vite/VitePress 등 개발 서버 계열 도구가 공개 advisory의 영향 범위에 있다.
- `pnpm peers check`가 실패한다.
- `pnpm pack:check`가 실패한다.
- `npm publish --dry-run`이 실패한다.
- package tarball에 README 또는 license 정보가 없다.
- `@browse-sent-event/plugin-vite` tarball의 dependency가 `workspace:*`로 남아 있다.
- GitHub Actions release workflow의 publish 인증 방식이 하나로 확정되지 않았다.

## 후속 전략

1. 이 계획을 먼저 구현해 dry-run까지 통과시킨다.
2. 첫 alpha publish 승인 여부를 별도로 결정한다.
3. alpha publish 후에는 README 설치 문구에서 "배포 후" 표현을 제거하고 실제 설치 흐름으로 갱신한다.
4. beta 전환 전에는 Linux CI 시각 snapshot 비교 회수와 browser 검증 시나리오 확대를 다시 평가한다.
