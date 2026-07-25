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

`@browse-sent-event/devtools-browser-fixture`는 `private: true`인 비배포 검증 앱이므로 version과 tag를 만들지 않는다. fixture가 외부 배포 대상이나 독립 version contract를 갖게 되면 `.changeset/config.json`의 ignore 정책을 제거하고 별도 version 정책을 정한다.

첫 alpha version을 만들 때는 이미 병합된 사용자 변경 changeset을 사용한다. 배포 준비만을 위한 changeset을 중복 생성하지 않는다.

```bash
pnpm changeset pre enter alpha
pnpm changeset version
pnpm install
pnpm install --frozen-lockfile
```

첫 install은 package version 변경을 lockfile에 반영하고, 이어지는 frozen install은 clean checkout 재현성을 확인한다. version 적용 후에는 `pnpm pack:check`와 `npm publish --dry-run`을 다시 실행하고, 결과를 release 문서 또는 PR 본문에 기록한다.

## publish 권한

Changesets는 version/changelog 후보를 만들기 위한 도구다. `pnpm changeset publish`, `npm publish`, GitHub Actions publish workflow는 maintainer가 별도로 승인하기 전까지 실행하지 않는다.
