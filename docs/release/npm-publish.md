# npm 배포 가이드

`browse-sent-event`의 npm 배포는 첫 alpha 공개 전까지 dry-run과 승인 gate를 통과해야 한다. 이 문서는 실제 publish를 누르기 전 확인해야 할 절차를 한곳에 모은다.

## 현재 원칙

1. 실제 publish는 별도 승인 없이는 수행하지 않는다.
2. 배포 대상은 `packages/*` 하위 public package로 제한한다.
3. root workspace와 examples, docs는 npm publish 대상이 아니다.
4. user-visible package 변경은 Changesets 기록을 요구한다.
5. npm scope 권한, registry 상태, tarball 내용은 배포 직전에 다시 확인한다.
6. 공급망 보안 gate를 통과하지 못하면 publish하지 않는다.

## 배포 대상

| package                          | publish | 이유                                      |
| -------------------------------- | ------- | ----------------------------------------- |
| `@browse-sent-event/core`        | yes     | runtime, interceptors, DevTools panel API |
| `@browse-sent-event/plugin-vite` | yes     | Vite 개발 서버 bootstrap injection        |
| `browse-sent-event-monorepo`     | no      | root workspace, `private: true`           |
| `examples/*`                     | no      | 테스트 fixture와 데모                     |
| `docs/`                          | no      | GitHub Pages 배포 대상                    |

## 배포 전 확인 순서

### 1. registry와 scope 권한 확인

배포 직전에 npm registry 상태를 다시 본다.

```bash
npm view @browse-sent-event/core name version description --json
npm view @browse-sent-event/plugin-vite name version description --json
npm access ls-packages @browse-sent-event
```

기대 결과:

- `npm view`가 `E404`를 반환하거나, 의도한 owner의 기존 package만 보여야 한다.
- 같은 package name이 다른 owner에게 점유되어 있으면 배포를 중단한다.
- `npm access ls-packages`로 현재 계정이 `@browse-sent-event` scope에 접근 가능한지 확인한다.

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
rm -rf .tmp-pack
mkdir -p .tmp-pack
npm pack ./packages/core --pack-destination .tmp-pack --json
npm pack ./packages/plugin-vite --pack-destination .tmp-pack --json
```

tarball에는 최소 다음 파일이 있어야 한다.

- `package/package.json`
- `package/dist/index.mjs`
- `package/dist/index.mjs.map`
- `package/dist/index.d.mts`
- `package/dist/index.d.mts.map`
- `package/README.md`
- license 정보

tarball에는 다음 파일이 없어야 한다.

- source test files
- `node_modules/`
- `.tmp-*`
- `playwright-report/`
- `test-results/`

`@browse-sent-event/plugin-vite`의 tarball metadata도 확인한다. `dependencies["@browse-sent-event/core"]`가 `workspace:*`로 남아 있으면 publish하지 않는다.

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
pnpm changeset
pnpm changeset version
pnpm install --frozen-lockfile
```

첫 alpha 후보는 `0.1.0-alpha.0`를 기준으로 한다.

changeset 예시:

```markdown
---
"@browse-sent-event/core": minor
"@browse-sent-event/plugin-vite": minor
---

첫 npm alpha 배포 후보를 준비한다.
```

version 적용 후에는 다시 build, pack, dry-run을 실행한다.

### 7. release workflow publish 또는 수동 publish 승인

실제 publish 방식은 다음 중 하나로 확정한다.

| 방식                   | 조건                                                     | 주의                                                  |
| ---------------------- | -------------------------------------------------------- | ----------------------------------------------------- |
| `NPM_TOKEN`            | npm automation token을 GitHub secret으로 등록            | token rotation과 최소 권한 관리 필요                  |
| npm trusted publishing | npm package와 GitHub workflow를 trusted publisher로 연결 | `id-token: write` 권한과 workflow 오염 방지 gate 필요 |

둘을 동시에 활성화하지 않는다.

첫 publish 전에는 다음을 다시 확인한다.

- npm scope 권한
- release workflow 인증 방식
- latest dry-run 결과
- CI 성공
- package tarball 내용
- Changesets version PR diff

## changeset 작성 기준

| 변경 종류                                  | changeset |
| ------------------------------------------ | --------- |
| public API 추가, 제거, 타입 변경           | 필요      |
| runtime 동작 변경                          | 필요      |
| Vite plugin 사용자 동작 변경               | 필요      |
| package metadata, README, release workflow | 필요 없음 |
| docs site 문서만 변경                      | 필요 없음 |
| test, lint, CI 검증만 변경                 | 필요 없음 |

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
- `pnpm peers check`가 실패한다.
- pack tarball에 README 또는 license 정보가 없다.
- `@browse-sent-event/plugin-vite` tarball의 dependency가 `workspace:*`로 남아 있다.
- `npm publish --dry-run`이 실패한다.
- release workflow의 publish 인증 방식이 하나로 확정되지 않았다.

## 관련 문서

- [npm 배포 준비 구현 계획](../plans/2026-06-03-npm-publish-readiness.md)
- [문서 공개와 릴리즈 준비](../plans/2026-05-27-docs-release-readiness.md)
- [기술 문서 배포와 공급망 보안](../plans/2026-05-25-docs-site-supply-chain.md)
