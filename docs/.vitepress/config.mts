import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitepress";

export default defineConfig({
  title: "browse-sent-event",
  description: "실시간 transport 흐름을 관찰하는 프론트엔드 DevTools",
  base: "/browse-sent-event/",
  cleanUrls: true,
  lastUpdated: true,
  vite: {
    resolve: {
      alias: {
        "@browse-sent-event/core": fileURLToPath(
          new URL("../../packages/core/src/index.ts", import.meta.url),
        ),
      },
    },
  },
  themeConfig: {
    nav: [
      { text: "시작하기", link: "/guides/getting-started" },
      {
        text: "가이드",
        items: [
          { text: "패널과 내보내기", link: "/guides/panel-and-export" },
          { text: "설정과 제한 사항", link: "/guides/configuration-and-limitations" },
        ],
      },
      { text: "예제", link: "/examples/devtools-panel" },
      {
        text: "프로젝트",
        items: [
          { text: "제품 요구사항", link: "/browse-sent-event-prd" },
          { text: "아키텍처 결정", link: "/browse-sent-event-adr" },
          { text: "구현 계획 기록", link: "/plans/" },
        ],
      },
    ],
    search: {
      provider: "local",
    },
    sidebar: [
      {
        text: "시작하기",
        items: [
          { text: "문서 홈", link: "/" },
          { text: "설치와 Vite 설정", link: "/guides/getting-started" },
        ],
      },
      {
        text: "사용 가이드",
        items: [
          { text: "패널과 내보내기", link: "/guides/panel-and-export" },
          { text: "설정과 제한 사항", link: "/guides/configuration-and-limitations" },
        ],
      },
      {
        text: "예제",
        items: [{ text: "DevTools panel", link: "/examples/devtools-panel" }],
      },
      {
        text: "프로젝트",
        items: [
          { text: "제품 요구사항", link: "/browse-sent-event-prd" },
          { text: "아키텍처 결정 기록", link: "/browse-sent-event-adr" },
          { text: "v2 설계 메모", link: "/browse-sent-event-v2" },
        ],
      },
      {
        text: "릴리스",
        items: [
          { text: "npm 배포", link: "/release/npm-publish" },
          { text: "GitHub Release", link: "/release/github-release" },
        ],
      },
      {
        text: "개발 기록",
        items: [{ text: "구현 계획 인덱스", link: "/plans/" }],
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
