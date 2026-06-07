# @browse-sent-event/plugin-vite

Vite 개발 서버 entry에 browse-sent-event runtime bootstrap을 주입하는 플러그인입니다.

## 설치

```bash
pnpm add -D @browse-sent-event/plugin-vite
```

## 사용

```ts
import { defineConfig } from "vite";
import browseSentEvent from "@browse-sent-event/plugin-vite";

export default defineConfig({
  plugins: [browseSentEvent()],
});
```

## 문서

공개 기술 문서는 <https://songforthemute.github.io/browse-sent-event/>에서 확인합니다.
