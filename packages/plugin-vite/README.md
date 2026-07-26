# @browse-sent-event/plugin-vite

Vite 개발 서버 entry에 `browse-sent-event` runtime bootstrap을 주입하는
플러그인입니다. 프로덕션 build에는 적용되지 않습니다.

현재 공개 alpha이며 API는 정식 릴리스 전에 바뀔 수 있습니다.

## 설치

```bash
pnpm add -D @browse-sent-event/plugin-vite@alpha
```

`0.1.0-alpha.0`은 잘못된 내부 의존성 manifest 때문에 deprecated 처리했습니다.
새 설치에서는 `@alpha` dist-tag를 사용합니다.

## 사용

```ts
import { defineConfig } from "vite";
import browseSentEvent from "@browse-sent-event/plugin-vite";

export default defineConfig({
  plugins: [browseSentEvent()],
});
```

현재 공개 옵션은 `enabled?: boolean` 하나입니다.

```ts
export default defineConfig({
  plugins: [
    browseSentEvent({
      enabled: process.env.BSE_ENABLED !== "false",
    }),
  ],
});
```

peer dependency 범위는 Vite `>=5.0.0 <9.0.0`이며 저장소와 CI의 현재 기준은 Vite
8.0.16입니다. 범위 안의 모든 버전 조합을 같은 수준으로 검증한다는 뜻은
아닙니다.

## 문서

공개 기술 문서는 <https://songforthemute.github.io/browse-sent-event/>에서 확인합니다.

- [시작하기](https://songforthemute.github.io/browse-sent-event/guides/getting-started)
- [설정과 제한 사항](https://songforthemute.github.io/browse-sent-event/guides/configuration-and-limitations)
