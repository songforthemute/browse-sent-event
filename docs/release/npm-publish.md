# npm 배포 가이드

`browse-sent-event`는 공개 alpha를 npm에 배포했다. 실제 publish는 자동화하지 않고
maintainer가 수동으로만 실행한다. 이 문서는 현재 registry 상태, 다음 alpha를
publish하기 전의 gate, 첫 배포에서 얻은 교훈을 한곳에 모은다.

## 현재 공개 상태

검증 기준: `2026-08-11 KST`

| package                          | `alpha`         | `latest`        | 상태            |
| -------------------------------- | --------------- | --------------- | --------------- |
| `@browse-sent-event/core`        | `0.1.0-alpha.1` | `0.1.0-alpha.0` | alpha 공개 완료 |
| `@browse-sent-event/plugin-vite` | `0.1.0-alpha.2` | `0.1.0-alpha.1` | alpha 공개 완료 |

`@browse-sent-event/plugin-vite@0.1.0-alpha.0`은 공개 manifest에 `workspace:*`
의존성이 남은 잘못된 배포이며 deprecated 상태다. 재사용하거나 정상 release로
기록하지 않는다.

이번 공개에서는 `alpha` dist-tag만 새 version으로 이동했고 `latest`는 기존
version을 유지했다. 설치 문서는 version 생략 대신 `@alpha`를 사용한다. npm
publish와 source commit `0e3f9dd`를 가리키는 원격 annotated tag push는 완료됐다.
두 GitHub Release는 Pre-release draft로 저장했으며 최종 검토와 publish를 기다린다.

## 현재 원칙

1. 실제 publish는 maintainer가 로컬에서 수동으로만 수행한다.
2. 배포 대상은 `pnpm pack:check`가 생성하고 검증한 public package tarball로 제한한다.
3. root workspace와 examples, docs는 npm publish 대상이 아니다.
4. user-visible package 변경은 Changesets 기록을 요구한다.
5. npm scope 권한, registry 상태, tarball 내용은 배포 직전에 다시 확인한다.
6. 공급망 보안 gate를 통과하지 못하면 publish하지 않는다.
7. GitHub Actions에는 npm publish 권한, `NPM_TOKEN`, trusted publishing 설정을 두지 않는다.
8. package는 독립적으로 versioning하고 설치 문서에서는 `@alpha` dist-tag를 사용한다.
9. Git tag와 GitHub Release는 npm publish 검증 후 별도 절차로 만든다.

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

## 다음 alpha 배포 runbook

### 1. registry와 scope 권한 확인

배포 직전에 npm registry 상태를 다시 본다.

```bash
npm view @browse-sent-event/core name version description --json
npm view @browse-sent-event/plugin-vite name version description --json
npm view @browse-sent-event/core dist-tags --json
npm view @browse-sent-event/plugin-vite dist-tags --json
npm access list packages @browse-sent-event --json
```

기대 결과:

- `npm view`가 위 현재 공개 상태와 일치해야 한다.
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

`pack:check`는 각 package마다 실제로 생성된 tarball의 절대 경로와 dry-run, publish 명령을 출력한다. 이후 단계에서는 이 출력에 있는 tarball 경로만 사용한다.

### 5. npm publish dry-run

```bash
pnpm pack:check
# 위 명령이 출력한 각 `dry-run:` 명령을 실행한다.
```

기대 결과:

- 실제 publish가 발생하지 않는다.
- package name, version, tarball file count, unpacked size를 확인할 수 있다.
- dry-run 대상 경로가 `pnpm pack:check`가 검증한 `.tmp-pack/*.tgz`와 일치한다.
- dry-run 결과는 PR 또는 release 문서에 기록한다.

package 디렉터리를 `npm publish ./packages/...`로 직접 배포하면 안 된다. npm은 pnpm이 수행하는 `workspace:*` 변환을 적용하지 않으므로, 검증한 tarball과 다른 manifest가 공개될 수 있다.

### 6. Changesets version 변경

새 prerelease 주기를 시작할 때만 prerelease mode에 진입한다.

```bash
pnpm changeset pre enter alpha
pnpm changeset version
pnpm install
pnpm install --frozen-lockfile
```

이미 병합된 사용자 변경 changeset을 사용하고 배포 준비만을 위한 changeset을
중복 생성하지 않는다. package는 독립적으로 versioning하므로 실제 변경이 없는
package를 같은 번호로 맞추기 위해 bump하지 않는다.

version 적용 후에는 다시 build, pack, dry-run을 실행한다.

첫 install은 package version 변경에 필요한 lockfile 갱신 기회를 제공한다. workspace package version을 lockfile에 기록하지 않는 현재 pnpm 구조에서는 diff가 없을 수 있다. 이어지는 frozen install은 lockfile이 clean checkout에서도 추가 변경 없이 재현되는지 확인한다.

### 7. maintainer 수동 publish 승인

실제 publish는 자동 workflow로 수행하지 않는다. `NPM_TOKEN` secret, npm trusted
publishing, `changesets/action`의 publish 단계를 추가하지 않는다.

publish 전에는 다음을 다시 확인한다.

- npm scope 권한
- latest dry-run 결과
- CI 성공
- package tarball 내용
- Changesets version PR diff
- maintainer가 직접 실행할 publish 명령과 npm 로그인 상태

수동 publish 명령은 최종 승인 시점에만 실행한다.

```bash
pnpm pack:check
# 위 명령이 출력한 각 `publish:` 명령을 maintainer가 실행한다.
```

publish 후에는 npm registry에서 정확한 version과 dist-tag를 확인하고, 깨끗한 임시
project에서 설치와 ESM import를 검증한다. 이어서
[GitHub Release 가이드](./github-release.md)에 따라 package tag와 prerelease를
준비한다.

## 역사 기록

아래 내용은 첫 공개 alpha에서 발생한 문제와 복구 검증 기록이다. 현재 실행할
명령은 위 runbook을 기준으로 판단한다.

### 0.1.0-alpha.0 plugin-vite 복구

`@browse-sent-event/plugin-vite@0.1.0-alpha.0`은 package 디렉터리에서 `npm publish`되어, 공개 manifest의 `@browse-sent-event/core` 의존성에 `workspace:*`가 남았다. `pnpm pack:check`가 만든 tarball은 올바르게 변환됐지만 실제 publish가 그 산출물을 사용하지 않아 발생한 문제다.

복구 순서는 다음과 같다.

1. `@browse-sent-event/plugin-vite@0.1.0-alpha.1` 후보를 Changesets로 만든다.
2. `pnpm pack:check`가 생성한 `alpha.1` tarball의 manifest에서 core 의존성이 `0.1.0-alpha.0`인지 확인한다.
3. 해당 tarball의 dry-run과 소비자 설치 검증을 통과시킨다.
4. maintainer가 `pack:check` 출력의 `publish:` 명령으로 `alpha.1`을 공개한다.
5. registry에서 `alpha` dist-tag가 `alpha.1`을 가리키는지 확인한다.
6. `alpha.0`을 deprecate하고, `latest` dist-tag를 깨진 `alpha.0`에서 정상인 `alpha.1`로 이동한다.

`alpha.1` 공개를 확인하기 전에는 deprecate나 dist-tag 정리를 먼저 실행하지 않는다. 공개 후 maintainer가 실행할 명령은 다음과 같다.

```bash
npm deprecate @browse-sent-event/plugin-vite@0.1.0-alpha.0 "workspace:* 의존성이 포함된 잘못된 배포입니다. 0.1.0-alpha.1 이상을 사용하세요."
npm dist-tag add @browse-sent-event/plugin-vite@0.1.0-alpha.1 latest
```

첫 publish에서 생성된 `latest`를 제거하려 했지만 npm registry는 두 package 모두 `E400 Bad Request`로 거부했다. npm은 version을 생략한 설치에서 `latest`를 사용하며, registry metadata도 `latest`가 있는 dist-tag 구조를 전제로 한다. 당시 복구에서는 `latest`를 삭제하지 않고 정상 package인 core alpha.0과 plugin-vite alpha.1을 가리키도록 유지했다. 이후 alpha publish도 `latest`를 자동으로 이동하는 근거로 삼지 않으며, 현재 설치 문서는 `@alpha`를 명시한다. 자세한 동작은 [npm dist-tag 문서](https://docs.npmjs.com/cli/dist-tag/)와 [npm registry API 문서](https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md)를 참고한다.

이 선택은 다음 조건을 가진 의식적인 기술 부채다.

- 포기하는 것: version이나 tag를 생략한 설치가 stable이 아닌 alpha를 받는다.
- 지금 감당 가능한 이유: stable version이 아직 없고, `latest`가 deprecated된 깨진 package를 가리키는 위험이 더 크다.
- 회수 시점: 첫 stable version을 배포하면서 `latest`를 stable로 이동하고, 설치 문서의 prerelease 안내를 갱신한다.

복구 당시 정상적으로 공개된 `@browse-sent-event/core@0.1.0-alpha.0`의 `latest`와
`alpha`는 그대로 유지했다. 현재 dist-tag는 이 문서의 [현재 공개 상태](#현재-공개-상태)를
기준으로 확인한다.

### 0.1.0-alpha.1 복구 후보 검증

검증 일시: `2026-07-26 KST`

| gate                    | 결과 | 비고                                                               |
| ----------------------- | ---- | ------------------------------------------------------------------ |
| Changesets version 계산 | 통과 | plugin-vite만 `0.1.0-alpha.1`, core는 `0.1.0-alpha.0` 유지         |
| package build           | 통과 | core와 plugin-vite 강제 재빌드 성공                                |
| plugin-vite tarball     | 통과 | 7 files, 4,046 bytes, unpacked 10,514 bytes                        |
| tarball SHA-256         | 기록 | `fe6f31891aee5a91e6fabf4ecfac0995e895ed2af6c1610f5c326db168c69a19` |
| publish manifest        | 통과 | core 의존성이 `0.1.0-alpha.0`으로 변환됨                           |
| npm publish dry-run     | 통과 | 검증된 `alpha.1` tarball 대상, `alpha` tag, 실제 publish 없음      |
| 소비자 설치             | 통과 | 공개 core alpha.0 해석, Vite 8.0.16과 함께 설치, 취약점 0건        |
| ESM import              | 통과 | plugin-vite default export와 core public export 로드 성공          |

복구 후보 tarball은 `.tmp-pack/browse-sent-event-plugin-vite-0.1.0-alpha.1.tgz`였다.
`.tmp-pack`은 임시 산출물이므로 Git에는 포함하지 않는다. 이 후보는 검증 후
공개되었고, 이미 정상인 core alpha.0은 다시 publish하지 않았다.

### registry 복구 결과

검증 일시: `2026-07-26 KST`

| package                                  | `alpha`         | `latest`        | 상태                                   |
| ---------------------------------------- | --------------- | --------------- | -------------------------------------- |
| `@browse-sent-event/core`                | `0.1.0-alpha.0` | `0.1.0-alpha.0` | 정상                                   |
| `@browse-sent-event/plugin-vite`         | `0.1.0-alpha.1` | `0.1.0-alpha.1` | 정상                                   |
| `@browse-sent-event/plugin-vite@alpha.0` | -               | -               | 잘못된 `workspace:*` 배포로 deprecated |

`plugin-vite@alpha.1`의 공개 manifest는 core 의존성을 `0.1.0-alpha.0`으로 포함한다. `npm view`에서 tag를 생략한 plugin-vite version도 `0.1.0-alpha.1`로 확인했다.

### 0.1.0-alpha.0 후보 검증

검증 일시: `2026-07-25 10:17 KST`
검증 기준 커밋: `c95b3bf`

| gate                  | 결과        | 비고                                                             |
| --------------------- | ----------- | ---------------------------------------------------------------- |
| npm package 이름 조회 | 조건부 통과 | core와 plugin-vite 모두 `E404`; 미로그인 상태라 소유권 단정 불가 |
| npm scope 접근        | 차단        | `npm whoami`, `npm access list packages`가 `E401` 반환           |
| frozen install        | 통과        | lockfile 추가 변경 없음                                          |
| audit moderate        | 통과        | 알려진 취약점 0건                                                |
| peer dependency       | 통과        | 오류 없음                                                        |
| format/lint/typecheck | 통과        | 오류 없음                                                        |
| unit test             | 통과        | core 90건, plugin-vite 12건                                      |
| release test          | 통과        | tarball validator 6건                                            |
| Chromium E2E          | 통과        | desktop/mobile 10건                                              |
| package/docs build    | 통과        | package 2개와 VitePress build 성공                               |
| core tarball          | 통과        | 7 files, 38,847 bytes, unpacked 169,572 bytes                    |
| plugin-vite tarball   | 통과        | 7 files, 4,030 bytes, unpacked 10,513 bytes                      |
| 소비자 tarball 설치   | 통과        | 두 공개 export와 core `0.1.0-alpha.0` 의존성 확인                |
| npm publish dry-run   | 통과        | `alpha` dist-tag, 실제 publish 없음                              |

첫 dry-run은 prerelease dist-tag를 생략해 npm 11의 `You must specify a tag using --tag when publishing a prerelease version` 오류로 실패했다. 명령에 `--tag alpha`를 추가한 뒤 두 package 모두 성공했다.

이 표는 publish 전 후보 검증 시점의 기록이다. 이후 npm 로그인과 scope 권한을
확인하고 수동 publish를 진행했다. plugin-vite alpha.0의 잘못된 manifest와 alpha.1
복구 결과는 위 역사 기록을 따른다.

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
- publish 대상이 `pnpm pack:check`가 생성한 tarball이 아니다.
- maintainer가 직접 publish를 승인하지 않았다.
- GitHub Actions 또는 repository secret에 npm publish 권한이 연결되어 있다.

## 관련 문서

- [GitHub Release 가이드](./github-release.md)
- [아키텍처 결정 기록 ADR-023](../browse-sent-event-adr.md#adr-023-공개-alpha-릴리스-identity와-수동-publish)
- [npm 배포 준비 구현 계획](../plans/2026-06-03-npm-publish-readiness.md)
- [문서 공개와 릴리즈 준비](../plans/2026-05-27-docs-release-readiness.md)
- [기술 문서 배포와 공급망 보안](../plans/2026-05-25-docs-site-supply-chain.md)
