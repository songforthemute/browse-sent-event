import { defineConfig } from "vitepress";

export default defineConfig({
  title: "browse-sent-event",
  description: "실시간 transport 흐름을 관찰하는 프론트엔드 DevTools",
  base: "/browse-sent-event/",
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: "문서", link: "/" },
      { text: "PRD", link: "/browse-sent-event-prd" },
      { text: "ADR", link: "/browse-sent-event-adr" },
      { text: "계획", link: "/plans/2026-05-25-docs-site-supply-chain" },
    ],
    search: {
      provider: "local",
    },
    sidebar: [
      {
        text: "프로젝트",
        items: [
          { text: "문서 홈", link: "/" },
          { text: "제품 요구사항", link: "/browse-sent-event-prd" },
          { text: "아키텍처 결정 기록", link: "/browse-sent-event-adr" },
          { text: "v2 설계 메모", link: "/browse-sent-event-v2" },
        ],
      },
      {
        text: "구현 계획",
        items: [
          {
            text: "기술 문서 배포와 공급망 보안",
            link: "/plans/2026-05-25-docs-site-supply-chain",
          },
          { text: "DevTools UI", link: "/plans/2026-05-19-devtools-ui" },
          { text: "DevTools UI 배치 2", link: "/plans/2026-05-19-devtools-ui-batch-2" },
          { text: "프로토콜 인터셉터", link: "/plans/2026-05-19-protocol-interceptors" },
          { text: "Vite 8 정렬", link: "/plans/2026-05-18-vite-8-alignment" },
        ],
      },
    ],
    socialLinks: [
      {
        icon: "github",
        link: "https://github.com/songforthemute/browse-sent-event",
      },
    ],
  },
});
