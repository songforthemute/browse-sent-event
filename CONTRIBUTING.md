# 기여 가이드

## 요구사항

- Node.js 20+
- pnpm 9+

## 작업 흐름

1. `docs/browse-sent-event-prd.md`를 읽는다.
2. `docs/browse-sent-event-adr.md`에서 관련 ADR을 확인한다.
3. 변경 범위는 하나의 논리적 커밋으로 유지한다.
4. 커밋 전에 검증을 실행한다.

## 검증

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
```

## Changesets

사용자에게 보이는 package 변경에는 `pnpm changeset`을 실행한다.
기반 설정만 변경하는 경우 release changeset은 작성하지 않는다.
