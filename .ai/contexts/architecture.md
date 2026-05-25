# 아키텍처 컨텍스트

`browse-sent-event`는 pnpm 모노레포이다.

- `packages/core`는 브라우저 런타임, 엔진, 인터셉터, 스토리지, 검색, export, Lit UI를 포함한다.
- `packages/plugin-vite`는 Phase 1 Vite 통합을 포함한다.
- 이후 package들은 framework adapter, middleware, CLI, server endpoint를 추가한다.

Phase 1은 Vite 전용이며 main thread 전용이다.
