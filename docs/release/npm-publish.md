# npm 배포 가이드

`browse-sent-event`의 npm 배포는 첫 alpha 공개 전까지 dry-run과 승인 gate를 통과해야 한다. 실제 publish는 자동화하지 않고 maintainer가 수동으로만 실행한다. 이 문서는 실제 publish를 누르기 전 확인해야 할 절차를 한곳에 모은다.

## 현재 원칙

1. 실제 publish는 maintainer가 로컬에서 수동으로만 수행한다.
2. 배포 대상은 `packages/*` 하위 public package로 제한한다.
3. root workspace와 examples, docs는 npm publish 대상이 아니다.
4. user-visible package 변경은 Changesets 기록을 요구한다.
5. npm scope 권한, registry 상태, tarball 내용은 배포 직전에 다시 확인한다.
6. 공급망 보안 gate를 통과하지 못하면 publish하지 않는다.
7. GitHub Actions에는 npm publish 권한, `NPM_TOKEN`, trusted publishing 설정을 두지 않는다.

## 배포 대상

| package                                       | publish | 이유                                      |
| --------------------------------------------- | ------- | ----------------------------------------- |
| `@browse-sent-event/core`                     | yes     | runtime, interceptors, DevTools panel API |
| `@browse-sent-event/plugin-vite`              | yes     | Vite 개발 서버 bootstrap injection        |
| `browse-sent-event-monorepo`                  | no      | root workspace, `private: true`           |
| `@browse-sent-event/devtools-browser-fixture` | no      | 브라우저 E2E용 비공개 검증 앱             |
| `examples/*`                                  | no      | 테스트 fixture와 데모                     |
| `docs/`                                       | no      | GitHub Pages 배포 대상                    |

비공개 브라우저 fixture는 `0.0.0`을 유지하고 Changesets 버전 변경 대상에서 제외한다. `changeset status --output` JSON에는 `type: "none"`으로 남을 수 있지만, version과 changelog는 만들지 않는다. fixture가 외부 배포 대상이나 독립 version contract를 갖게 되면 ignore 정책을 제거하고 별도 version 정책을 정한다.

## 배포 전 확인 순서

### 1. registry와 scope 권한 확인

배포 직전에 npm registry 상태를 다시 본다.

```bash
npm view @browse-sent-event/core name version description --json
npm view @browse-sent-event/plugin-vite name version description --json
npm access list packages @browse-sent-event --json
```

기대 결과:

- `npm view`가 `E404`를 반환하거나, 의도한 owner의 기존 package만 보여야 한다.
- 같은 package name이 다른 owner에게 점유되어 있으면 배포를 중단한다.
- `npm access list packages`로 현재 계정이 `@browse-sent-event` scope에 접근 가능한지 확인한다.

주의:

- scoped package는 권한이 없을 때도 `E404`처럼 보일 수 있다.
- 따라서 `npm view` 결과만으로 배포 가능을 단정하지 않는다.

### 2. 설치와 공급망 보안 확인

```bash
pnpm install --frozen-lockfile
pnpm audit --audit-level moderate
pnpm peers check
```

기대 결과:

- frozen install이 lockfile 변경 없이 끝난다.
- moderate 이상 audit advisory가 없다.
- peer dependency 오류가 없다.

설치 단계에서 새 install script, exotic dependency, lockfile 변동이 생기면 원인을 먼저 문서화한다.

2026-06-06 KST 기준 Vitest 보안 점검 결과:

- `vitest@4.1.8`은 확인한 Vitest advisory의 patched range 이후 버전이다.
- `@vitest/browser`와 `@vitest/ui`는 현재 직접 사용하지 않는다.
- `vitest.config.ts`는 `happy-dom` 환경만 사용하며 Browser Mode를 켜지 않는다.
- 확인한 advisory는 `GHSA-5xrq-8626-4rwp`, `GHSA-2h32-95rg-cppp`, `GHSA-9crc-q9x8-hgqq`, `GHSA-8gvc-j273-4wm5`다.

release 후보를 만들 때 Vitest/Vite/VitePress 같은 개발 서버 계열 도구에 새 advisory가 있으면, patched range와 실제 사용 모드를 확인하기 전까지 publish하지 않는다.

### 3. 기능 검증

```bash
pnpm docs:build
pnpm test
pnpm test:e2e
pnpm exec turbo run typecheck --force
pnpm exec turbo run build --force
pnpm lint
pnpm format:check
git diff --check
```

기대 결과:

- 모든 명령이 exit code `0`으로 끝난다.
- `packages/core/dist`와 `packages/plugin-vite/dist`가 생성된다.
- `docs:build`에서 기존 VitePress/Rollup 주석 경고가 출력되더라도 build는 성공해야 한다.

### 4. pack tarball 확인

```bash
pnpm pack:check
```

`pack:check`는 각 package 디렉터리에서 `pnpm pack --pack-destination .tmp-pack --json`을 실행하고, 실제 생성된 tarball의 `package/package.json`까지 확인한다.

tarball에는 최소 다음 파일이 있어야 한다.

- `package/package.json`
- `package/dist/index.mjs`
- `package/dist/index.mjs.map`
- `package/dist/index.d.mts`
- `package/dist/index.d.mts.map`
- `package/README.md`
- `package/LICENSE`

tarball에는 다음 파일이 없어야 한다.

- `src/`
- `__tests__/`
- `node_modules/`
- `.tmp-*`
- `playwright-report/`
- `test-results/`

`@browse-sent-event/plugin-vite`의 tarball metadata도 확인한다. tarball 안의 `dependencies["@browse-sent-event/core"]`가 `workspace:*`로 남아 있으면 publish하지 않는다. source package는 monorepo 개발을 위해 `workspace:*`를 유지할 수 있지만, publish manifest에는 배포 가능한 semver 범위로 변환되어야 한다.

### 5. npm publish dry-run

```bash
npm publish ./packages/core --dry-run --access public
npm publish ./packages/plugin-vite --dry-run --access public
```

기대 결과:

- 실제 publish가 발생하지 않는다.
- package name, version, tarball file count, unpacked size를 확인할 수 있다.
- dry-run 결과는 PR 또는 release 문서에 기록한다.

### 6. Changesets version PR 생성

첫 alpha 배포는 prerelease 흐름으로 시작한다.

```bash
pnpm changeset pre enter alpha
pnpm changeset version
pnpm install
pnpm install --frozen-lockfile
```

첫 alpha 후보는 `0.1.0-alpha.0`를 기준으로 한다.

첫 alpha version은 이미 병합된 사용자 변경 changeset을 사용한다. 배포 준비만을 위한 changeset을 중복 생성하지 않는다. 적용할 changeset은 다음 형태다.

```markdown
---
"@browse-sent-event/core": minor
"@browse-sent-event/plugin-vite": minor
---

첫 npm alpha 배포 후보를 준비한다.
```

version 적용 후에는 다시 build, pack, dry-run을 실행한다.

첫 install은 package version 변경을 lockfile에 반영한다. 이어지는 frozen install은 생성된 lockfile이 clean checkout에서도 추가 변경 없이 재현되는지 확인한다.

### 7. maintainer 수동 publish 승인

실제 publish는 자동 workflow로 수행하지 않는다. `NPM_TOKEN` secret, npm trusted publishing, `changesets/action`의 publish 단계는 첫 alpha 전까지 추가하지 않는다.

첫 publish 전에는 다음을 다시 확인한다.

- npm scope 권한
- latest dry-run 결과
- CI 성공
- package tarball 내용
- Changesets version PR diff
- maintainer가 직접 실행할 publish 명령과 npm 로그인 상태

수동 publish 명령은 최종 승인 시점에만 실행한다.

```bash
npm publish ./packages/core --access public
npm publish ./packages/plugin-vite --access public
```

publish 후에는 npm registry에서 실제 version을 확인하고, README의 설치 문구에서 "배포 후" 표현을 제거한다.

## changeset 작성 기준

| 변경 종류                                       | changeset |
| ----------------------------------------------- | --------- |
| public API 추가, 제거, 타입 변경                | 필요      |
| runtime 동작 변경                               | 필요      |
| Vite plugin 사용자 동작 변경                    | 필요      |
| package metadata, README, release 검증 workflow | 필요 없음 |
| docs site 문서만 변경                           | 필요 없음 |
| test, lint, CI 검증만 변경                      | 필요 없음 |

0.x에서는 다음 bump 기준을 사용한다.

| 변경                        | bump  |
| --------------------------- | ----- |
| breaking change             | minor |
| backward-compatible feature | minor |
| bug fix                     | patch |
| docs-only                   | none  |

stable `1.0.0` 이후에는 일반 SemVer 기준으로 전환한다.

## publish 차단 조건

다음 중 하나라도 해당하면 publish하지 않는다.

- npm 계정이 `@browse-sent-event` scope publish 권한을 갖는지 확인되지 않았다.
- 같은 package name이 의도하지 않은 owner에게 점유되어 있다.
- `pnpm audit --audit-level moderate`가 실패한다.
- Vitest/Vite/VitePress 등 개발 서버 계열 도구가 공개 advisory의 영향 범위에 있다.
- `pnpm peers check`가 실패한다.
- pack tarball에 README 또는 license 정보가 없다.
- `@browse-sent-event/plugin-vite` tarball의 dependency가 `workspace:*`로 남아 있다.
- `npm publish --dry-run`이 실패한다.
- maintainer가 직접 publish를 승인하지 않았다.
- GitHub Actions 또는 repository secret에 npm publish 권한이 연결되어 있다.

## 관련 문서

- [npm 배포 준비 구현 계획](../plans/2026-06-03-npm-publish-readiness.md)
- [문서 공개와 릴리즈 준비](../plans/2026-05-27-docs-release-readiness.md)
- [기술 문서 배포와 공급망 보안](../plans/2026-05-25-docs-site-supply-chain.md)
