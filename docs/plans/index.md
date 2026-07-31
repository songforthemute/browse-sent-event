---
outline: deep
---

# 구현 계획 기록

이 디렉터리는 `browse-sent-event`를 설계하고 구현할 당시의 판단, 순서와 검증
기록을 보존한다. 계획 안의 version, 미완료 목록, registry 상태와 실행 명령은
작성 시점의 정보일 수 있다.

현재 사용자 계약은 [시작하기](../guides/getting-started.md),
[설정과 제한 사항](../guides/configuration-and-limitations.md), [npm 배포
가이드](../release/npm-publish.md)를 우선한다. 아키텍처 결정은
[ADR](../browse-sent-event-adr.md)을 기준으로 판단한다.

## 공개 alpha 기준선

| 날짜 | 계획 | 상태 |
| --- | --- | --- |
| 2026-07-31 | [Runtime 옵션 alpha 릴리스 후보](./2026-07-31-runtime-options-alpha-release-candidate.md) | 진행 중 |
| 2026-07-27 | [Vite plugin runtime 옵션 설계](./2026-07-27-vite-plugin-runtime-options-design.md) | 완료 |
| 2026-07-27 | [Vite plugin runtime 옵션 구현](./2026-07-27-vite-plugin-runtime-options.md) | 완료 |
| 2026-07-26 | [공개 alpha 문서 기준선 설계](./2026-07-26-public-alpha-docs-baseline-design.md) | 완료 |
| 2026-07-26 | [공개 alpha 문서 기준선 구현](./2026-07-26-public-alpha-docs-baseline.md) | 완료 |
| 2026-07-24 | [첫 alpha 배포 후보](./2026-07-24-alpha-release-candidate.md) | 완료, 역사 기록 |
| 2026-06-03 | [npm 배포 준비](./2026-06-03-npm-publish-readiness.md) | 완료, 역사 기록 |

## Runtime과 interceptor

| 날짜 | 계획 | 상태 |
| --- | --- | --- |
| 2026-07-23 | [XMLHttpRequest 인터셉터 설계](./2026-07-23-xhr-interceptor-design.md) | 완료 |
| 2026-07-23 | [XMLHttpRequest 인터셉터 구현](./2026-07-23-xhr-interceptor.md) | 완료 |
| 2026-06-08 | [Runtime/UI 하드닝 설계](./2026-06-08-runtime-ui-hardening-design.md) | 완료 |
| 2026-05-19 | [프로토콜 인터셉터 구현](./2026-05-19-protocol-interceptors.md) | 완료 |

## DevTools UI와 브라우저 검증

| 날짜 | 계획 | 상태 |
| --- | --- | --- |
| 2026-06-03 | [Export 검색어 필터 회수](./2026-06-03-export-search-filter.md) | 완료 |
| 2026-05-25 | [DevTools 브라우저 검증](./2026-05-25-devtools-browser-verification.md) | 완료 |
| 2026-05-19 | [DevTools UI 배치 2](./2026-05-19-devtools-ui-batch-2.md) | 완료 |
| 2026-05-19 | [DevTools UI 구현](./2026-05-19-devtools-ui.md) | 완료 |

## 문서와 공급망

| 날짜 | 계획 | 상태 |
| --- | --- | --- |
| 2026-06-03 | [문서 SPA 인터랙티브 예제](./2026-06-03-docs-interactive-demo.md) | 완료 |
| 2026-05-27 | [문서 공개와 릴리즈 준비](./2026-05-27-docs-release-readiness.md) | 완료 |
| 2026-05-25 | [기술 문서 배포와 공급망 보안](./2026-05-25-docs-site-supply-chain.md) | 완료 |

## 프로젝트 기반과 Vite

| 날짜 | 계획 | 상태 |
| --- | --- | --- |
| 2026-05-18 | [Vite 8 정렬](./2026-05-18-vite-8-alignment.md) | 완료 |
| 2026-05-18 | [Vite plugin 주입](./2026-05-18-vite-plugin-injection.md) | 완료 |
| 2026-05-18 | [Phase 1 기반](./2026-05-18-phase-1-foundation.md) | 완료 |

## 기록 읽는 법

- 계획의 체크리스트보다 현재 code와 verification 결과를 우선한다.
- superseded된 선택은 후속 ADR과 현재 package manifest를 확인한다.
- 실제 npm publish, dist-tag, Git tag와 GitHub Release 상태는 release 문서를
  기준으로 재확인한다.
- 과거 명령을 그대로 실행하기 전에 현재 branch와 package version을 확인한다.
