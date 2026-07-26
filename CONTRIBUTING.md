# 기여 가이드

## 요구사항

- Node.js `^20.19.0` 또는 `>=22.12.0`
- pnpm `11.2.2`

## 작업 흐름

1. `docs/browse-sent-event-prd.md`를 읽는다.
2. `docs/browse-sent-event-adr.md`에서 관련 ADR을 확인한다.
3. 변경 범위는 하나의 논리적 커밋으로 유지한다.
4. 커밋 전에 검증을 실행한다.

## 검증

```bash
pnpm install
pnpm docs:build
pnpm build
pnpm test
pnpm test:e2e
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test:release
```

## Changesets

사용자에게 보이는 package 변경에는 `pnpm changeset`을 실행한다.
기반 설정만 변경하는 경우 release changeset은 작성하지 않는다.

자세한 기준은 `.changeset/README.md`와 `docs/release/npm-publish.md`를 따른다.

## npm publish

npm publish는 자동화하지 않는다. 현재 공개 alpha도 `NPM_TOKEN`, trusted
publishing, GitHub Actions publish workflow를 사용하지 않고 maintainer가 release
gate를 확인한 뒤 로컬에서 수동으로만 실행한다.

package version은 서로 독립적으로 관리한다. 한 package의 변경 때문에 다른
package의 version을 불필요하게 올리지 않는다. 다만 내부 dependency 범위가 바뀌면
Changesets가 의존 package의 필요한 bump를 함께 계산하도록 한다.

배포 절차와 현재 alpha 상태는 `docs/release/npm-publish.md`를 따른다. Git tag와
GitHub Release는 npm publish를 검증한 뒤 별도로 생성한다.
