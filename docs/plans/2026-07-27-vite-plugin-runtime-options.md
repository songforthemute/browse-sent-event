---
search: false
---

# Vite plugin runtime 옵션 구현 계획

> **Codex용:** 구현 단계에서는 `executing-plans`, `test-driven-development`,
> `verification-before-completion`을 사용해 작업 단위로 진행한다.

**목표:** Vite plugin에서 기존 core runtime 옵션 전체를 안전하게 전달하고,
custom hotkey와 URL 제외 필터를 공개 계약대로 실제 동작하게 만든다.

**아키텍처:** core는 설치 시 URL matcher와 hotkey matcher를 한 번 구성해
interceptor와 panel에 전달한다. plugin은 core 옵션 타입을 재사용하되, 작은
스키마 기반 serializer로 Node 설정을 virtual browser module에 안전하게
직렬화한다. native transport 호출과 첫 설치 우선 규칙은 유지한다.

**기술 스택:** TypeScript 6, Vitest 4, happy-dom, Vite 8, Playwright,
pnpm workspace, Turborepo, Changesets, VitePress 2.

**설계 문서:**
`docs/plans/2026-07-27-vite-plugin-runtime-options-design.md`

---

## 구현 원칙

1. 각 동작은 실패하는 테스트로 시작하고 예상한 이유로 실패하는지 확인한다.
2. URL 제외는 native 요청을 막지 않고 DevTools 기록만 생략한다.
3. 필터와 단축키 설정 오류가 애플리케이션 실행을 중단하지 않게 한다.
4. `BrowseSentEventOptions`를 core와 plugin 설정의 SSOT로 유지한다.
5. 직렬화 코드에 `eval` 또는 `Function` constructor를 사용하지 않는다.
6. production build 제외와 첫 설치 우선 규칙을 바꾸지 않는다.
7. 과거 계획 문서 본문은 수정하지 않는다.
8. 각 커밋은 하나의 기능 또는 검증 책임만 포함한다.

## 커밋 구성

| 순서 | 책임 | 커밋 메시지 |
| --- | --- | --- |
| 1 | 네 interceptor의 URL 제외 | `feat(core): URL 제외 필터를 인터셉터에 연결` |
| 2 | custom hotkey parser | `feat(ui): 사용자 단축키 조합 지원` |
| 3 | Vite plugin 옵션 직렬화 | `feat(plugin-vite): core runtime 옵션 전달` |
| 4 | 실제 browser 통합 검증 | `test(e2e): runtime 옵션 전달 검증 추가` |
| 5 | 사용자 문서 계약 갱신 | `docs(guide): runtime 설정 계약 반영` |
| 6 | 다음 prerelease 변경 기록 | `chore(release): runtime 옵션 기능 변경 기록` |

# 구현 계획

## 작업 1: URL 제외 matcher

**파일:**

- 생성: `packages/core/src/runtime/url-filter.ts`
- 생성: `packages/core/src/runtime/__tests__/url-filter.test.ts`

### 단계 1: 문자열과 정규식 실패 테스트 작성

`packages/core/src/runtime/__tests__/url-filter.test.ts`에 다음 핵심 사례를
작성한다.

```ts
import { describe, expect, it } from "vitest";
import { createUrlFilter } from "../url-filter.js";

describe("createUrlFilter", () => {
  it("matches a case-sensitive URL substring", () => {
    const shouldExcludeUrl = createUrlFilter(["/health"]);

    expect(shouldExcludeUrl("https://example.test/health?ready=1")).toBe(true);
    expect(shouldExcludeUrl("https://example.test/HEALTH")).toBe(false);
  });

  it("keeps global regular expressions deterministic without mutating the input", () => {
    const pattern = /\/internal\/events/g;
    pattern.lastIndex = 4;
    const shouldExcludeUrl = createUrlFilter([pattern]);

    expect(shouldExcludeUrl("https://example.test/internal/events")).toBe(true);
    expect(shouldExcludeUrl("https://example.test/internal/events")).toBe(true);
    expect(pattern.lastIndex).toBe(4);
  });
});
```

빈 pattern 목록, 일치하지 않는 URL, `y` flag와 정규식 source 접근 실패도
추가한다. 실패하는 pattern은 해당 URL을 포함하는 쪽으로 퇴행해야 한다.

### 단계 2: 실패 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/runtime/__tests__/url-filter.test.ts
```

기대 결과:

- `../url-filter.js` module을 찾을 수 없어 실패한다.
- 기존 test 실패는 없어야 한다.

### 단계 3: 최소 matcher 구현

`packages/core/src/runtime/url-filter.ts`에 내부 matcher를 만든다.

```ts
export type BrowseSentEventUrlFilter = (url: string) => boolean;

type UrlMatcher = (url: string) => boolean;

function createRegExpMatcher(pattern: RegExp): UrlMatcher | undefined {
  try {
    const matcher = new RegExp(pattern.source, pattern.flags);

    return (url) => {
      try {
        matcher.lastIndex = 0;
        return matcher.test(url);
      } catch {
        return false;
      } finally {
        matcher.lastIndex = 0;
      }
    };
  } catch {
    return undefined;
  }
}

export function createUrlFilter(
  patterns: readonly (string | RegExp)[],
): BrowseSentEventUrlFilter {
  const matchers = patterns.flatMap<UrlMatcher>((pattern) => {
    if (typeof pattern === "string") {
      return [(url) => url.includes(pattern)];
    }

    const matcher = createRegExpMatcher(pattern);

    return matcher ? [matcher] : [];
  });

  return (url) => matchers.some((matcher) => matcher(url));
}
```

정규식 getter 실패와 matcher 실패를 모두 catch하되 문자열은 가공하거나
소문자로 바꾸지 않는다.

### 단계 4: matcher 테스트 통과 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/runtime/__tests__/url-filter.test.ts
```

기대 결과:

- URL filter test가 모두 통과한다.
- 같은 `g` 또는 `y` 정규식을 반복 실행해도 결과가 같다.
- 입력 정규식의 `lastIndex`가 유지된다.

## 작업 2: URL 필터를 네 interceptor에 연결

**파일:**

- 수정: `packages/core/src/interceptors/types.ts`
- 수정: `packages/core/src/interceptors/websocket.ts`
- 수정: `packages/core/src/interceptors/eventsource.ts`
- 수정: `packages/core/src/interceptors/fetch-stream.ts`
- 수정: `packages/core/src/interceptors/xml-http-request.ts`
- 수정: `packages/core/src/runtime/install.ts`
- 수정: `packages/core/src/interceptors/__tests__/websocket.test.ts`
- 수정: `packages/core/src/interceptors/__tests__/eventsource.test.ts`
- 수정: `packages/core/src/interceptors/__tests__/fetch-stream.test.ts`
- 수정: `packages/core/src/interceptors/__tests__/xml-http-request.test.ts`

### 단계 1: 프로토콜별 제외 실패 테스트 작성

각 interceptor test에 제외 URL이 native 동작은 실행하지만 engine에는 기록되지
않는 사례를 하나씩 추가한다.

WebSocket은 다음 상태를 확인한다.

```ts
const socket = new globalThis.window.WebSocket("wss://example.test/ignored");

socket.send("native message");

expect(Reflect.get(socket, "sent")).toEqual(["native message"]);
expect(Object.hasOwn(socket, "send")).toBe(false);
expect(engine.getConnections()).toEqual([]);
expect(engine.getMessages()).toEqual([]);
```

EventSource는 instance가 반환되고 `close`가 own property로 덮이지 않았으며
기록이 없는지 확인한다. fetch는 `clone()` spy가 호출되지 않고 원본 response
payload를 읽을 수 있는지 확인한다.

XHR은 다음 흐름을 사용한다.

```ts
request.open("POST", "https://example.test/ignored");
request.send("native body");
Reflect.apply(Reflect.get(request, "succeed"), request, ["native response"]);

expect(Reflect.get(request, "sentBodies")).toEqual(["native body"]);
expect(engine.getConnections()).toEqual([]);
expect(engine.getMessages()).toEqual([]);
```

각 설치 context에는 `shouldExcludeUrl: (url) => url.includes("/ignored")`를
전달한다.

### 단계 2: interceptor 테스트 실패 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- \
  src/interceptors/__tests__/websocket.test.ts \
  src/interceptors/__tests__/eventsource.test.ts \
  src/interceptors/__tests__/fetch-stream.test.ts \
  src/interceptors/__tests__/xml-http-request.test.ts
```

기대 결과:

- 제외 URL도 현재 engine에 기록되므로 새 assertion이 실패한다.
- native instance와 response를 사용할 수 있다는 assertion은 통과한다.

### 단계 3: context의 안전한 판정 helper 추가

`packages/core/src/interceptors/types.ts`에 선택 predicate와 실패 격리 helper를
추가한다. 선택 속성으로 두면 filter를 지정하지 않은 low-level interceptor
테스트와 내부 호출은 기존처럼 모든 URL을 포함한다.

```ts
export interface BrowseSentEventInterceptorContext {
  readonly engine: BrowseSentEventEngine;
  readonly target: BrowseSentEventInterceptorTarget;
  readonly shouldExcludeUrl?: (url: string) => boolean;
}

export function shouldExcludeUrl(
  context: BrowseSentEventInterceptorContext,
  url: string,
): boolean {
  try {
    return context.shouldExcludeUrl?.(url) === true;
  } catch {
    return false;
  }
}
```

### 단계 4: 프로토콜별 적용

WebSocket과 EventSource는 native constructor가 성공하고 URL 문자열을 얻은 뒤
다음 guard를 넣는다.

```ts
if (shouldExcludeUrl(context, url)) {
  return socket;
}
```

EventSource에서는 `source`를 반환한다. 이 guard는 event listener 등록과 instance
method wrapping보다 앞에 둔다.

fetch는 `originalFetch()`와 기존 body 존재 확인 뒤 URL을 얻어 body clone보다
앞에서 반환한다.

```ts
const url = getRequestUrl(input);

if (shouldExcludeUrl(context, url)) {
  return response;
}
```

connection 기록에는 같은 `url` 변수를 사용해 URL 변환을 중복하지 않는다.

XHR은 `beginObservation()` 첫머리에서 `currentDescriptor.url`을 판정해 제외 시
active connection을 만들지 않고 반환한다. 이후 wrapper는 원본 `send()`를
그대로 실행한다.

### 단계 5: runtime에서 matcher 한 개 공유

`packages/core/src/runtime/install.ts`에서 resolved filter를 matcher로 바꾸고
공통 context를 만든다.

```ts
const resolvedOptions = resolveOptions(options);
const interceptorContext = {
  engine: runtime.engine,
  shouldExcludeUrl: createUrlFilter(resolvedOptions.filter.excludeUrls),
  target,
};
```

네 installer에 같은 `interceptorContext`를 전달한다. panel은 기존처럼
`resolvedOptions.panel`을 받는다.

### 단계 6: core 회귀 테스트

실행:

```bash
pnpm --filter @browse-sent-event/core test
pnpm --filter @browse-sent-event/core typecheck
```

기대 결과:

- URL matcher와 네 interceptor test가 통과한다.
- 포함 URL의 기존 connection, message, lifecycle test도 모두 통과한다.
- TypeScript 오류가 없다.

### 단계 7: 첫 기능 커밋

```bash
git add \
  packages/core/src/runtime/url-filter.ts \
  packages/core/src/runtime/__tests__/url-filter.test.ts \
  packages/core/src/interceptors/types.ts \
  packages/core/src/interceptors/websocket.ts \
  packages/core/src/interceptors/eventsource.ts \
  packages/core/src/interceptors/fetch-stream.ts \
  packages/core/src/interceptors/xml-http-request.ts \
  packages/core/src/runtime/install.ts \
  packages/core/src/interceptors/__tests__/websocket.test.ts \
  packages/core/src/interceptors/__tests__/eventsource.test.ts \
  packages/core/src/interceptors/__tests__/fetch-stream.test.ts \
  packages/core/src/interceptors/__tests__/xml-http-request.test.ts
git commit -m "feat(core): URL 제외 필터를 인터셉터에 연결"
```

## 작업 3: Custom hotkey parser

**파일:**

- 생성: `packages/core/src/ui/hotkey.ts`
- 생성: `packages/core/src/ui/__tests__/hotkey.test.ts`
- 수정: `packages/core/src/ui/mount.ts`
- 수정: `packages/core/src/ui/__tests__/mount.test.ts`

### 단계 1: parser 실패 테스트 작성

`packages/core/src/ui/__tests__/hotkey.test.ts`에 다음 계약을 작성한다.

```ts
import { describe, expect, it } from "vitest";
import { createHotkeyMatcher } from "../hotkey.js";

function keyboardEvent(
  key: string,
  init: Omit<KeyboardEventInit, "key"> = {},
): KeyboardEvent {
  return new globalThis.KeyboardEvent("keydown", { ...init, key });
}

describe("createHotkeyMatcher", () => {
  it("matches portable cmd with either meta or control", () => {
    const matches = createHotkeyMatcher("cmd+shift+b");

    expect(matches?.(keyboardEvent("b", { metaKey: true, shiftKey: true }))).toBe(true);
    expect(matches?.(keyboardEvent("B", { ctrlKey: true, shiftKey: true }))).toBe(true);
  });

  it("requires an exact modifier set", () => {
    const matches = createHotkeyMatcher("ctrl+alt+k");

    expect(matches?.(keyboardEvent("k", { altKey: true, ctrlKey: true }))).toBe(true);
    expect(
      matches?.(
        keyboardEvent("k", {
          altKey: true,
          ctrlKey: true,
          shiftKey: true,
        }),
      ),
    ).toBe(false);
  });

  it.each(["", "cmd", "cmd++r", "cmd+r+k", "shift+shift+r", "cmd+ctrl+r"])(
    "rejects invalid hotkey %s",
    (hotkey) => {
      expect(createHotkeyMatcher(hotkey)).toBeUndefined();
    },
  );
});
```

토큰 순서, 공백, `meta`, `ctrl`, `alt`, `shift`, primary modifier 두 개를 동시에
누른 경우도 추가한다.

### 단계 2: 실패 확인

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/ui/__tests__/hotkey.test.ts
```

기대 결과:

- `../hotkey.js` module을 찾을 수 없어 실패한다.

### 단계 3: parser와 matcher 최소 구현

`packages/core/src/ui/hotkey.ts`에서 modifier token과 key token을 분리한다.

```ts
export type BrowseSentEventHotkeyMatcher = (event: KeyboardEvent) => boolean;

const modifiers = new Set(["alt", "cmd", "ctrl", "meta", "shift"]);

export function createHotkeyMatcher(
  hotkey: string,
): BrowseSentEventHotkeyMatcher | undefined {
  const tokens = hotkey
    .toLowerCase()
    .split("+")
    .map((token) => token.trim());

  if (tokens.some((token) => token.length === 0)) {
    return undefined;
  }

  const declaredModifiers = new Set<string>();
  const keys: string[] = [];

  for (const token of tokens) {
    if (!modifiers.has(token)) {
      keys.push(token);
      continue;
    }

    if (declaredModifiers.has(token)) {
      return undefined;
    }

    declaredModifiers.add(token);
  }

  if (
    keys.length !== 1 ||
    (declaredModifiers.has("cmd") &&
      (declaredModifiers.has("meta") || declaredModifiers.has("ctrl")))
  ) {
    return undefined;
  }

  const key = keys[0];

  return (event) => {
    const primaryMatches = declaredModifiers.has("cmd")
      ? event.metaKey !== event.ctrlKey
      : event.metaKey === declaredModifiers.has("meta") &&
        event.ctrlKey === declaredModifiers.has("ctrl");

    return (
      primaryMatches &&
      event.altKey === declaredModifiers.has("alt") &&
      event.shiftKey === declaredModifiers.has("shift") &&
      event.key.toLowerCase() === key
    );
  };
}
```

`keys[0]`의 `undefined` narrowing은 `noUncheckedIndexedAccess`에서 확인하고,
필요하면 length 검사 뒤 지역 변수 guard를 추가한다.

### 단계 4: mount에 설치 시 한 번 연결

`packages/core/src/ui/mount.ts`의 고정 matcher를 제거하고 panel을 만들 때
`createHotkeyMatcher(options.options.hotkey)`를 한 번 호출한다.

유효한 matcher가 있을 때만 `keydown` listener를 등록한다. `unmount()`에서도
등록된 경우에만 제거한다. invalid hotkey에서도 element append와 launcher는
유지한다.

`mount.test.ts`에는 `ctrl+alt+k`로 toggle되는 사례와 invalid hotkey가 panel
mount를 막지 않는 사례를 추가한다.

### 단계 5: UI 테스트와 typecheck

실행:

```bash
pnpm --filter @browse-sent-event/core test -- \
  src/ui/__tests__/hotkey.test.ts \
  src/ui/__tests__/mount.test.ts
pnpm --filter @browse-sent-event/core typecheck
```

기대 결과:

- 기본 `cmd+shift+r`과 custom 조합이 통과한다.
- 추가 modifier와 invalid 문법은 toggle하지 않는다.
- panel mount와 unmount 회귀가 없다.

### 단계 6: 두 번째 기능 커밋

```bash
git add \
  packages/core/src/ui/hotkey.ts \
  packages/core/src/ui/__tests__/hotkey.test.ts \
  packages/core/src/ui/mount.ts \
  packages/core/src/ui/__tests__/mount.test.ts
git commit -m "feat(ui): 사용자 단축키 조합 지원"
```

## 작업 4: Plugin 옵션 직렬화

**파일:**

- 수정: `packages/plugin-vite/src/index.ts`
- 수정: `packages/plugin-vite/src/injection.ts`
- 수정: `packages/plugin-vite/src/__tests__/injection.test.ts`
- 수정: `packages/plugin-vite/src/__tests__/plugin.test.ts`
- 수정: `packages/plugin-vite/src/__tests__/vite-fixture.test.ts`

### 단계 1: 직렬화 실패 테스트 작성

`injection.test.ts`에 nested option과 정규식 source를 고정한다.

```ts
const code = createBootstrapModuleCode({
  capacity: 250,
  panel: {
    autoOpen: true,
    hotkey: "ctrl+alt+k",
    position: "top-left",
  },
  filter: {
    excludeUrls: ["/health", /\/internal\/events(?:\?|$)/gi],
  },
});

expect(code).toContain('"capacity":250');
expect(code).toContain('"hotkey":"ctrl+alt+k"');
expect(code).toContain('new RegExp("\\\\/internal\\\\/events(?:\\\\?|$)", "gi")');
expect(code).not.toContain('"enabled"');
```

실제 expected string은 `JSON.stringify(pattern.source)`의 결과를 조합해
backslash 개수를 사람이 중복 정의하지 않게 한다. quote, 줄바꿈, `</script>`와
Unicode 문자열도 JSON 문자열로 보존되는지 확인한다.

`plugin.test.ts`에는 plugin option을 준 뒤 virtual module `load()` 결과가 같은
capacity와 filter를 포함하는 사례를 추가한다.

### 단계 2: 실패 확인

실행:

```bash
pnpm --filter @browse-sent-event/plugin-vite test -- \
  src/__tests__/injection.test.ts \
  src/__tests__/plugin.test.ts
```

기대 결과:

- `createBootstrapModuleCode()`가 인자를 받지 않거나 생성 코드에 옵션이 없어
  실패한다.

### 단계 3: core 타입을 plugin 옵션의 SSOT로 연결

`packages/plugin-vite/src/index.ts`에서 type-only import를 사용한다.

```ts
import type { BrowseSentEventOptions } from "@browse-sent-event/core";

export interface BrowseSentEventVitePluginOptions extends BrowseSentEventOptions {
  readonly enabled?: boolean;
}
```

plugin 생성 시 bootstrap source를 한 번 만든다.

```ts
const enabled = options.enabled ?? true;
const bootstrapModuleCode = createBootstrapModuleCode(options);
```

`load()`는 같은 source를 반환한다. serializer가 알려진 core option property만
읽으므로 `enabled`와 알 수 없는 runtime property는 생성 코드에 들어가지 않는다.

### 단계 4: 스키마 기반 serializer 구현

`packages/plugin-vite/src/injection.ts`에 type-only core import와 작은 source
builder를 추가한다.

```ts
function serializeProperty(name: string, value: string | undefined): string | undefined {
  return value === undefined ? undefined : `${JSON.stringify(name)}:${value}`;
}

function serializeObject(properties: readonly (string | undefined)[]): string {
  return `{${properties.filter((property) => property !== undefined).join(",")}}`;
}

function serializeExcludeUrl(pattern: string | RegExp): string {
  return typeof pattern === "string"
    ? JSON.stringify(pattern)
    : `new RegExp(${JSON.stringify(pattern.source)}, ${JSON.stringify(pattern.flags)})`;
}
```

`serializePanel`, `serializeFilter`, `serializeBrowseSentEventOptions`를 옵션
schema에 맞춰 분리한다. number, boolean과 string은 `JSON.stringify()` 결과를
사용하고 `undefined` property는 생략한다.

`createBootstrapModuleCode(options = {})`는 다음 형태를 생성한다.

```ts
return [
  `import { installBrowseSentEvent } from "@browse-sent-event/core";`,
  `installBrowseSentEvent(${serializeBrowseSentEventOptions(options)});`,
].join("\n");
```

### 단계 5: Vite fixture에서 production 경계 회귀 확인

`vite-fixture.test.ts`의 dev server test는 plugin에 capacity와 정규식 filter를
전달하고, virtual bootstrap module load 결과에 복원 코드가 있는지 확인한다.
기존 production build test는 그대로 유지해 emitted file에
`browse-sent-event`가 없는지 검증한다.

### 단계 6: plugin 전체 검증

실행:

```bash
pnpm --filter @browse-sent-event/plugin-vite test
pnpm --filter @browse-sent-event/plugin-vite typecheck
pnpm --filter @browse-sent-event/plugin-vite build
```

기대 결과:

- 일반 옵션과 정규식 직렬화 test가 통과한다.
- `enabled: false`와 production build 제외 test가 계속 통과한다.
- build declaration에서 plugin options가 core options를 확장한다.
- runtime import가 아닌 type-only import이므로 plugin Node bundle 초기화에
  불필요한 core 실행이 추가되지 않는다.

### 단계 7: 세 번째 기능 커밋

```bash
git add \
  packages/plugin-vite/src/index.ts \
  packages/plugin-vite/src/injection.ts \
  packages/plugin-vite/src/__tests__/injection.test.ts \
  packages/plugin-vite/src/__tests__/plugin.test.ts \
  packages/plugin-vite/src/__tests__/vite-fixture.test.ts
git commit -m "feat(plugin-vite): core runtime 옵션 전달"
```

## 작업 5: 실제 Chromium 통합 검증

**파일:**

- 수정: `examples/devtools-browser-fixture/vite.config.ts`
- 수정: `examples/devtools-browser-fixture/src/fixture-probe.ts`
- 수정: `e2e/devtools-panel.spec.ts`

### 단계 1: fixture plugin 옵션 설정

`examples/devtools-browser-fixture/vite.config.ts`의 plugin을 다음 설정으로
바꾼다.

```ts
browseSentEvent({
  capacity: 25,
  panel: {
    hotkey: "ctrl+alt+b",
  },
  filter: {
    excludeUrls: [/\/__bse-fixture\/ignored-stream(?:\?|$)/],
  },
});
```

기존 `autoOpen: false`와 `bottom-right` 기본값은 유지해 visual snapshot을
바꾸지 않는다.

fixture endpoint에 `/__bse-fixture/ignored-stream`을 추가하고 정상 text
response를 반환한다. probe에는 요청 전후 snapshot count와 response text를
반환하는 `runIgnoredFetchStream()`을 추가한다.

### 단계 2: browser 실패 테스트 작성

`e2e/devtools-panel.spec.ts`에 다음 시나리오를 추가한다.

1. page를 새로 연다.
2. runtime capacity가 `25`인지 읽는다.
3. `Control+Alt+B`를 눌러 panel이 열리는지 확인한다.
4. `runIgnoredFetchStream()`을 실행한다.
5. response payload가 정상인지 확인한다.
6. 실행 전후 connection과 message 수가 같은지 확인한다.

이 test는 plugin option 전달, 정규식 복원, custom hotkey와 실제 fetch 제외를
한 browser 흐름에서 검증한다.

### 단계 3: 실패 확인

실행:

```bash
pnpm test:e2e --project chromium-desktop --grep "runtime options"
```

기대 결과:

- 작업 1~4 구현 전에는 capacity, custom hotkey 또는 filter assertion 중 하나가
  실패한다.
- 작업 1~4 뒤에는 새 browser test가 통과한다.

계획을 같은 순서로 실행해 이미 기능 구현이 끝난 상태라면, commit 직전
`git show HEAD^` 기반 임시 검증 대신 새 E2E가 현재 구현을 검증하는지 test
assertion과 fixture 경계를 코드 리뷰로 확인한다.

### 단계 4: 전체 desktop E2E 회귀 확인

실행:

```bash
pnpm test:e2e --project chromium-desktop
```

기대 결과:

- panel mount, seeded UI, WebSocket, EventSource, fetch와 XHR test가 모두
  통과한다.
- 기존 visual snapshot에는 변경이 없다.

### 단계 5: 브라우저 검증 커밋

```bash
git add \
  examples/devtools-browser-fixture/vite.config.ts \
  examples/devtools-browser-fixture/src/fixture-probe.ts \
  e2e/devtools-panel.spec.ts
git commit -m "test(e2e): runtime 옵션 전달 검증 추가"
```

## 작업 6: 사용자 문서 갱신

**파일:**

- 수정: `README.md`
- 수정: `packages/core/README.md`
- 수정: `packages/plugin-vite/README.md`
- 수정: `docs/guides/configuration-and-limitations.md`
- 수정: `docs/release/github-release.md`
- 수정: `docs/plans/index.md`

### 단계 1: 제거할 제한 문구 확인

실행:

```bash
rg -n \
  "Vite plugin.*설정 전달|plugin option 전달|custom hotkey.*미지원|excludeUrls.*미적용|현재 공개 옵션은.*enabled" \
  README.md packages docs
```

기대 결과:

- root README, package README, 설정 가이드와 release 문서에서 실제 구현과
  어긋나는 문구 위치를 확인한다.
- 과거 `docs/plans/*`의 역사 기록은 수정 대상에서 제외한다.

### 단계 2: Vite plugin 사용자 예제 갱신

root README, plugin README와 설정 가이드에 다음 형태의 예제를 반영한다.

```ts
browseSentEvent({
  capacity: 5_000,
  panel: {
    autoOpen: true,
    position: "bottom-left",
    hotkey: "cmd+shift+b",
  },
  filter: {
    excludeUrls: ["/health", /\/internal\/events(?:\?|$)/],
  },
});
```

plugin이 `enabled`와 모든 core runtime 옵션을 받는다고 설명한다.
`enabled: false`와 `apply: "serve"`의 production 제외 계약은 유지한다.

### 단계 3: Core 계약과 제한 갱신

core README와 설정 가이드에 다음 내용을 명시한다.

- string filter는 기록 URL 원문의 대소문자 구분 부분 문자열 일치다.
- `RegExp` filter는 반복 호출에도 결정적으로 검사된다.
- 제외 URL도 native 통신은 실행되고 DevTools 기록만 생략된다.
- URL filter는 payload redaction이나 network 차단이 아니다.
- hotkey modifier는 `cmd`, `meta`, `ctrl`, `alt`, `shift`를 지원한다.
- 잘못된 hotkey는 단축키만 비활성화하며 launcher는 유지한다.
- 첫 설치가 옵션을 결정하고 설정 변경에는 page reload가 필요하다.
- XHR `URL` 객체와 Worker 미지원 제한은 그대로다.

지원하게 된 세 항목을 알려진 alpha 제한 표와 root README의 후속 회수
목록에서 제거한다. GitHub release note checklist도 현재 남은 제한만 가리키게
수정한다.

### 단계 4: 계획 인덱스 상태 변경

`docs/plans/index.md`에 구현 계획 링크를 추가하고 설계와 구현 상태를 다음처럼
갱신한다.

| 날짜 | 계획 | 상태 |
| --- | --- | --- |
| 2026-07-27 | Vite plugin runtime 옵션 설계 | 완료 |
| 2026-07-27 | Vite plugin runtime 옵션 구현 | 완료 |

### 단계 5: 문서 검증

실행:

```bash
pnpm docs:build
pnpm format:check
git diff --check
```

기대 결과:

- VitePress가 모든 page를 렌더링한다.
- 새 옵션 예제에 존재하지 않는 export가 없다.
- 현재 사용자 문서에 제거된 제한이 남지 않는다.
- 과거 계획에는 당시 제한 기록이 보존된다.

### 단계 6: 문서 커밋

```bash
git add \
  README.md \
  packages/core/README.md \
  packages/plugin-vite/README.md \
  docs/guides/configuration-and-limitations.md \
  docs/release/github-release.md \
  docs/plans/index.md
git commit -m "docs(guide): runtime 설정 계약 반영"
```

## 작업 7: Changeset 작성

**파일:**

- 생성: `.changeset/<generated-name>.md`

### 단계 1: package bump 기준 확인

이번 변경은 기존 옵션의 실제 동작과 plugin 공개 옵션을 추가하는 하위 호환
기능이다. 저장소의 0.x 정책에 따라 두 package 모두 `minor` changeset을
작성한다.

```md
---
"@browse-sent-event/core": minor
"@browse-sent-event/plugin-vite": minor
---

Vite plugin에서 core runtime 옵션 전체를 전달하고, 모든 browser interceptor의
URL 제외 필터와 사용자 정의 panel 단축키를 지원합니다.
```

현재 prerelease mode를 유지하며 이 PR에서 `changeset version`이나 package
version 변경은 실행하지 않는다.

### 단계 2: Changesets 상태 검증

실행:

```bash
pnpm changeset status
```

기대 결과:

- 새 changeset에 core와 plugin-vite가 `minor`로 표시된다.
- private browser fixture는 release 대상이 아니다.
- 기존 prerelease changeset과 `pre.json`은 임의로 수정하지 않는다.

### 단계 3: release metadata 커밋

```bash
git add .changeset/<generated-name>.md
git commit -m "chore(release): runtime 옵션 기능 변경 기록"
```

# 검증 계획

## 검증 1: 커밋별 표적 검사

각 기능 커밋 전 다음 최소 gate를 통과한다.

| 커밋 | 필수 검사 |
| --- | --- |
| URL 제외 | core URL filter와 네 interceptor test, core typecheck |
| Custom hotkey | hotkey와 mount test, core typecheck |
| Plugin 전달 | plugin 전체 test, typecheck, build |
| Browser 검증 | Chromium desktop E2E 전체 |
| 문서 | docs build, format check, diff check |
| Changeset | `pnpm changeset status` |

실패하면 다음 커밋으로 넘어가지 않고 원인을 현재 책임 안에서 수정한다.

## 검증 2: 전체 자동 검사

모든 커밋 후 저장소 root에서 순서대로 실행한다.

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm docs:build
pnpm test:e2e
pnpm test:release
pnpm pack:check
git diff --check
```

기대 결과:

- 모든 명령이 exit code `0`으로 끝난다.
- Playwright desktop과 mobile project가 모두 통과한다.
- package tarball에 source, test 또는 `workspace:*` dependency가 남지 않는다.
- VitePress의 기존 chunk 크기 warning은 허용하지만 새 build error는 없다.

`test:release`와 `pack:check`가 같은 검증 경로를 일부 공유하더라도 CI와 수동
release gate를 각각 재현하기 위해 둘 다 실행한다.

## 검증 3: 직렬화와 공급망 경계

의존성을 추가하지 않으므로 `package.json`과 `pnpm-lock.yaml`이 바뀌지 않아야
한다.

```bash
git diff main...HEAD -- package.json packages/*/package.json pnpm-lock.yaml
rg -n "eval\\(|new Function|Function\\(" packages/plugin-vite/src
pnpm audit --audit-level high
```

기대 결과:

- manifest와 lockfile diff가 없다.
- production serializer에 동적 코드 실행이 없다.
- audit에서 high 또는 critical advisory가 없다.

audit은 registry network가 필요한 검사다. sandbox 또는 registry 장애로 실행할
수 없으면 그 사유와 마지막 성공 시점을 PR에 기록하고, publish 전 maintainer
환경에서 다시 실행한다.

## 검증 4: 수동 browser 확인

자동 E2E 통과 뒤 fixture dev server를 실행한다.

```bash
pnpm --filter @browse-sent-event/devtools-browser-fixture dev \
  --host 127.0.0.1 \
  --port 4174
```

브라우저에서 `http://127.0.0.1:4174`를 열고 다음을 확인한다.

1. panel host가 하나만 mount된다.
2. 초기 panel은 닫혀 있다.
3. `Ctrl+Alt+B`로 panel이 열리고 다시 닫힌다.
4. seed, WebSocket, EventSource, fetch와 XHR의 기존 기록이 보인다.
5. ignored stream의 response는 정상 수신되지만 timeline에는 나타나지 않는다.
6. console에 bootstrap 또는 option parsing error가 없다.
7. desktop과 mobile viewport에서 panel이 겹치거나 화면 밖으로 밀리지 않는다.

확인이 끝나면 dev server를 정상 종료한다. UI 구조를 바꾸지 않으므로 새 visual
snapshot은 만들지 않는다.

## 검증 5: 최종 diff와 이력

```bash
git status --short
git log --oneline main..HEAD
git diff --stat main...HEAD
git diff --check main...HEAD
```

기대 결과:

- 계획한 파일 외 우발적 변경이 없다.
- 설계와 구현 계획 뒤에 여섯 개 책임별 커밋이 순서대로 존재한다.
- build 산출물, Playwright report와 임시 Vite fixture가 추적되지 않는다.
- working tree가 깨끗하다.

## 완료 보고

최종 보고에는 다음을 포함한다.

- 구현된 plugin 옵션과 hotkey/filter 계약
- native transport 보존 방식
- 기능별 commit hash
- 자동 검사와 browser 검증 결과
- 허용한 기존 warning
- 미지원으로 남은 Worker, XHR URL 객체와 HMR live reconfiguration
- changeset bump와 다음 alpha versioning이 maintainer 승인 단계라는 사실
