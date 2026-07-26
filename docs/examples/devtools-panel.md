---
outline: deep
---

# DevTools panel 예제

이 페이지는 `browse-sent-event` DevTools panel의 정적 문서용 seeded demo다.

실제 transport interceptor 검증은 `examples/devtools-browser-fixture`와 Playwright E2E에서 수행한다. 이 문서 예제는 GitHub Pages 정적 배포에서도 동작하도록 서버 endpoint 없이 샘플 connection과 message를 직접 seed한다.

처음 설치한다면 [시작하기](../guides/getting-started.md)를 먼저 확인한다. 패널의
검색, 방향 필터와 export 계약은
[패널과 내보내기](../guides/panel-and-export.md)에 정리되어 있다.

<script setup>
import DevtoolsPanelDemo from "../.vitepress/components/DevtoolsPanelDemo.vue";
</script>

<ClientOnly>
  <DevtoolsPanelDemo />
</ClientOnly>
