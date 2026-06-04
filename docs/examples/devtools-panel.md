---
outline: deep
---

# DevTools panel 예제

이 페이지는 `browse-sent-event` DevTools panel의 정적 문서용 seeded demo다.

실제 transport interceptor 검증은 `examples/devtools-browser-fixture`와 Playwright E2E에서 수행한다. 이 문서 예제는 GitHub Pages 정적 배포에서도 동작하도록 서버 endpoint 없이 샘플 connection과 message를 직접 seed한다.

<script setup>
import DevtoolsPanelDemo from "../.vitepress/components/DevtoolsPanelDemo.vue";
</script>

<ClientOnly>
  <DevtoolsPanelDemo />
</ClientOnly>
