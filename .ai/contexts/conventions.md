# 컨벤션

- 코드는 English로 작성한다.
- 커밋 메시지는 Conventional Commits 형식과 Korean description을 사용한다.
- Package는 ESM-only로 배포한다.
- 런타임 의존성은 최소화한다.
- `packages/core`는 `lit` 의존을 허용한다.
- `packages/plugin-vite`는 `vite`를 peer dependency로 선언한다.
- `isolatedDeclarations`가 활성화되어 있으므로 export되는 TypeScript API에는 명시적 타입이 필요하다.
