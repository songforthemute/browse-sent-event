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

## alpha와 0.x 버전 기준

공개 alpha를 포함한 0.x 단계에서는 다음 기준을 사용한다.

| 변경                        | bump  |
| --------------------------- | ----- |
| breaking change             | minor |
| backward-compatible feature | minor |
| bug fix                     | patch |
| docs-only                   | none  |

stable `1.0.0` 이후에는 일반 SemVer 기준으로 전환한다.

package는 독립적으로 versioning한다. `.changeset/config.json`의 `fixed`와 `linked`를
비워 둔 상태를 유지하며, 실제로 변경된 package만 bump한다. 내부 dependency
계약이 바뀌면 `updateInternalDependencies: "patch"` 정책에 따라 소비 package의
필요한 bump도 함께 검토한다.

## 현재 공개 alpha

| 패키지                           | 공개 alpha      |
| -------------------------------- | --------------- |
| `@browse-sent-event/core`        | `0.1.0-alpha.0` |
| `@browse-sent-event/plugin-vite` | `0.1.0-alpha.1` |

`@browse-sent-event/plugin-vite@0.1.0-alpha.0`은 배포 manifest에 `workspace:*`
의존성이 남아 있어 deprecated 처리했다. 이 버전을 다시 tag하거나 release 기준으로
사용하지 않는다.

`@browse-sent-event/devtools-browser-fixture`는 `private: true`인 비배포 검증
앱이므로 version과 tag를 만들지 않는다. fixture가 외부 배포 대상이나 독립 version
contract를 갖게 되면 `.changeset/config.json`의 ignore 정책을 제거하고 별도
version 정책을 정한다.

## 후속 prerelease version

이미 병합된 사용자 변경 changeset을 사용하고 배포 준비만을 위한 changeset을
중복 생성하지 않는다. prerelease mode에 진입하지 않은 상태에서 다음 alpha
주기를 시작할 때만 아래 명령을 사용한다.

```bash
pnpm changeset pre enter alpha
pnpm changeset version
pnpm install
pnpm install --frozen-lockfile
```

첫 install은 package version 변경에 필요한 lockfile 갱신 기회를 제공한다.
workspace package version을 lockfile에 기록하지 않는 현재 pnpm 구조에서는 diff가
없을 수 있다. 이어지는 frozen install은 clean checkout 재현성을 확인한다. version
적용 후에는 `pnpm pack:check`와 `npm publish --dry-run`을 다시 실행하고, 결과를
release 문서 또는 PR 본문에 기록한다.

## publish 권한

Changesets는 version과 changelog 후보를 만들기 위한 도구다. `pnpm changeset
publish`, `npm publish`, GitHub Actions publish workflow는 maintainer의 명시적
승인 없이 실행하지 않는다. 현재 배포는 maintainer가 검증된 tarball을 로컬에서
수동 publish하는 정책을 유지한다.
