# Changesets

Changesets는 package version과 changelog 후보를 관리한다. 실제 npm publish 권한은 자동화하지 않고 maintainer의 수동 승인과 수동 실행으로만 유지한다.

## 작성이 필요한 변경

| 변경 종류                                       | changeset |
| ----------------------------------------------- | --------- |
| public API 추가, 제거, 타입 변경                | 필요      |
| runtime 동작 변경                               | 필요      |
| Vite plugin 사용자 동작 변경                    | 필요      |
| package dependency 또는 peer dependency 변경    | 필요      |
| package metadata, README, release 검증 workflow | 필요 없음 |
| docs site 문서만 변경                           | 필요 없음 |
| test, lint, CI 검증만 변경                      | 필요 없음 |

## 0.x 버전 기준

첫 공개 배포 전후의 0.x 단계에서는 다음 기준을 사용한다.

| 변경                        | bump  |
| --------------------------- | ----- |
| breaking change             | minor |
| backward-compatible feature | minor |
| bug fix                     | patch |
| docs-only                   | none  |

stable `1.0.0` 이후에는 일반 SemVer 기준으로 전환한다.

## 첫 alpha 후보

첫 npm alpha 후보는 `0.1.0-alpha.0`를 기준으로 한다. `@browse-sent-event/core`와 `@browse-sent-event/plugin-vite`는 같은 alpha 후보 안에서 함께 versioning한다.

```bash
pnpm changeset pre enter alpha
pnpm changeset
pnpm changeset version
pnpm install --frozen-lockfile
```

version 적용 후에는 `pnpm pack:check`와 `npm publish --dry-run`을 다시 실행하고, 결과를 release 문서 또는 PR 본문에 기록한다.

## publish 권한

Changesets는 version/changelog 후보를 만들기 위한 도구다. `pnpm changeset publish`, `npm publish`, GitHub Actions publish workflow는 maintainer가 별도로 승인하기 전까지 실행하지 않는다.
