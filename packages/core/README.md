# @browse-sent-event/core

WebSocket, fetch ReadableStream, EventSource, XMLHttpRequest 흐름을 브라우저 개발
환경에서 관찰하는 `browse-sent-event` core runtime입니다. 현재 공개 alpha이며
API는 정식 릴리스 전에 바뀔 수 있습니다.

## 설치

```bash
pnpm add -D @browse-sent-event/core@alpha
```

현재 `alpha`는 `0.1.0-alpha.1`입니다. `latest`는 `0.1.0-alpha.0`을 유지하므로
version이나 dist-tag를 생략하지 않습니다.

Vite 프로젝트에는 core를 직접 설치하기보다
`@browse-sent-event/plugin-vite@alpha` 사용을 권장합니다. plugin은 개발 서버에만
runtime을 주입하므로 프로덕션 build에서 자동으로 제외됩니다.

## 사용

```ts
import { installBrowseSentEvent } from "@browse-sent-event/core";

const installation = installBrowseSentEvent({
  capacity: 10_000,
  panel: {
    autoOpen: false,
    position: "bottom-right",
    hotkey: "cmd+shift+b",
  },
  filter: {
    excludeUrls: ["/health", /\/internal\/events(?:\?|$)/],
  },
});
```

개발 도구를 제거할 때 반환된 `installation.uninstall()`을 호출합니다. 설치 직후
호출하면 interceptor와 panel이 바로 제거됩니다.

애플리케이션 소스에서 직접 import하면 bundler 설정에 따라 프로덕션 bundle에
포함될 수 있습니다. 개발 전용 entry나 조건부 import를 사용하고 최종 산출물을
확인해야 합니다.

문자열 `excludeUrls`는 기록될 URL 원문에 대한 대소문자 구분 부분 문자열
일치입니다. `RegExp`도 사용할 수 있으며 `g`와 `y` flag를 사용해도 반복 판정
결과가 달라지지 않습니다. 제외된 URL의 native 통신은 그대로 실행되고 DevTools
connection과 message만 기록하지 않습니다.

단축키는 `cmd`, `meta`, `ctrl`, `alt`, `shift` modifier와 key 하나를 조합합니다.
`cmd`는 Meta 또는 Control 중 하나를 뜻합니다. 문법이 잘못되면 단축키만
비활성화되고 panel launcher는 계속 사용할 수 있습니다.

custom hotkey와 URL filter는 `0.1.0-alpha.1`부터 지원합니다.
`0.1.0-alpha.0`은 이 설정을 실제 interceptor에 연결하지 않으므로 기본 단축키와
제한된 개발 환경을 사용합니다.

## 인과 근거 어댑터

프레임워크 어댑터는 전역 envelope에서 `linked-evidence-v1` capability를 요구한 뒤
bridge의 `recordLinkedNode()`와 `subscribeLinkedEvidence()`를 사용해야 합니다.
이 API는 현재 활성 메시지와 부모 노드를 고정하고, 자식 노드와 연결선을 원자적으로
반영합니다. 확장 구독은 이를 하나의 `linked-evidence-recorded` delta로 받고, 기존
`subscribeEvidence()` 구독은 호환성을 위해 `node-recorded`와 `edge-recorded`를
연속으로 받습니다. `subscribeLinkedEvidence()`는 이 원자 delta뿐 아니라 기존 모든
bridge-v1 delta도 함께 받습니다. 이 capability가 없는 이전 core에서는 추적을 생략하고
애플리케이션 상태 변경을 그대로 수행해야 합니다.

### 마이그레이션

`bridge-v1`은 기존 API 표면을 유지합니다. `linked-evidence-v1`를 요구한 뒤
`hasBrowseSentEventCausalityLinkedEvidenceBridge()`로 bridge를 좁혀야
`recordLinkedNode()`와 `subscribeLinkedEvidence()`를 호출할 수 있습니다. 기본
`subscribeEvidence()`는 새 atomic delta를 받지 않으므로 기존 exhaustive switch를
변경할 필요가 없습니다. 또한 구독 콜백에서 다시 근거를 기록하면 모든 등록 구독자가
현재 delta를 받은 뒤 다음 delta를 받습니다. linked 근거의 기본 구독 투영 두 건도
재진입 이벤트보다 먼저 연속 전달됩니다.

## 관찰 범위

- 브라우저 main thread에 runtime을 설치합니다.
- WebSocket, fetch ReadableStream, EventSource, XMLHttpRequest 이벤트를 수집합니다.
- DevTools panel UI와 export 이벤트를 제공합니다.

XMLHttpRequest는 `open()`에 문자열 URL을 전달한 요청만 계측합니다. URL 객체를 전달한 요청과 요청 header, progress chunk는 수집하지 않으며 응답 header는 `content-type`만 기록합니다. GET/HEAD body는 빈 payload로 기록하고, FormData는 값 없이 제한된 field 이름만, Blob과 Document는 metadata만 요약합니다.

## 문서

공개 기술 문서는 <https://songforthemute.github.io/browse-sent-event/>에서 확인합니다.

- [시작하기](https://songforthemute.github.io/browse-sent-event/guides/getting-started)
- [설정과 제한 사항](https://songforthemute.github.io/browse-sent-event/guides/configuration-and-limitations)
