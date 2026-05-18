# Vite 8 정렬 구현 계획

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**목표:** Vite 8 전환 이후 문서와 번들러 영향 의존성 계약을 현재 구현 상태에 맞춘다.

**아키텍처:** `packages/plugin-vite`는 Vite 공개 Plugin API 위에만 올라탄다. Vite 8 내부 번들러가 Rolldown/Oxc로 바뀌었으므로, Phase 1에서는 Rollup/esbuild 내부 옵션에 직접 의존하지 않고 Vite 5-8 호환 표면만 문서화한다.

**기술 스택:** Vite 8.0.13, Vitest 4.1.6, tsdown 0.22.0, Rolldown 1.0.1, Lightning CSS 1.32.0, TypeScript 6.0.3.

---

## 배경

Vite 8은 기존의 개발 esbuild + 프로덕션 Rollup 이중 경로에서 벗어나 Rolldown/Oxc 기반 단일 번들러 경로를 사용한다.

참고:

- Vite 8 announcement: https://vite.dev/blog/announcing-vite8
- Vite 8 migration guide: https://vite.dev/guide/migration

## 현재 의존성 점검

`pnpm why vite rolldown esbuild rollup lightningcss tsdown vitest` 결과:

- `vite 8.0.13`은 `rolldown 1.0.1`, `lightningcss 1.32.0`을 사용한다.
- `vitest 4.1.6`은 peer 경로에서 `vite 8.0.13`을 사용한다.
- `tsdown 0.22.0`은 `rolldown 1.0.1`을 사용한다.
- `rollup`과 `esbuild`는 현재 설치 그래프에 남아 있지 않다.

## 작업

### Task 1: 문서 지원 범위 정리

**Files:**
- Modify: `README.md`
- Modify: `docs/browse-sent-event-prd.md`
- Modify: `docs/browse-sent-event-v2.md`
- Modify: `docs/browse-sent-event-adr.md`

**Steps:**

1. README에 현재 개발 기준은 Vite 8이고, `plugin-vite` peer range는 Vite 5-8임을 기록한다.
2. PRD의 Phase 1 non-goal과 Vite 플러그인 요구사항에 Vite 8/Rolldown 제약을 추가한다.
3. v2 문서의 번들러 플러그인 설명에 Vite 8 기준 구현 원칙을 추가한다.
4. ADR에 번들러 영향 의존성 점검 결과와 향후 금지/주의 항목을 기록한다.

### Task 2: 검증

**Commands:**

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm exec turbo run test --force
pnpm exec turbo run typecheck --force
pnpm exec turbo run build --force
pnpm lint
pnpm format:check
git diff --check
```

**Expected:**

- 모든 명령이 exit code `0`으로 끝난다.
- `pnpm test` 출력에 `ES2025`, `esbuild`, `oxc options` 관련 경고가 없어야 한다.

### Task 3: 커밋

```bash
git add README.md docs/browse-sent-event-prd.md docs/browse-sent-event-v2.md docs/browse-sent-event-adr.md docs/plans/2026-05-18-vite-8-alignment.md
git commit -m "docs(vite): Vite 8 번들러 영향 범위 정리"
```
