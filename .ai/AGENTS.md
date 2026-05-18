# browse-sent-event 에이전트 가이드

## 먼저 읽을 문서

구현 전에 아래 파일을 읽는다.

1. `docs/browse-sent-event-prd.md`
2. `docs/browse-sent-event-adr.md`
3. `.ai/contexts/phase-1-scope.md`
4. `.ai/contexts/conventions.md`
5. `.ai/contexts/testing.md`

## 원칙

- 요구사항이 모호하면 구현 전에 질문한다.
- 추측보다 도구 출력과 파일 내용을 우선한다.
- 구현 전에 접근 방식을 요약한다.
- 필요한 경우 구현, 테스트, 문서, changeset까지 한 사이클로 완료한다.
- 기술 부채를 선택한다면 의식적 선택임을 명시한다.
