# DevTools 브라우저 검증 구현 계획

> **Claude용:** 필수 하위 스킬: `superpowers:executing-plans`, `superpowers:test-driven-development`, `superpowers:verification-before-completion`를 사용해 이 계획을 작업 단위로 실행한다.

**목표:** DevTools 패널이 실제 Vite 개발 서버와 브라우저에서 mount, 표시, transport 수집, export event까지 동작하는지 Playwright로 검증한다.

**아키텍처:** root에는 Playwright 설정과 `e2e/` 테스트를 둔다. `examples/devtools-browser-fixture`는 실제 Vite 앱으로 만들고 `@browse-sent-event/plugin-vite`를 사용해 runtime bootstrap을 검증한다. closed Shadow DOM 내부는 직접 DOM query하지 않고, host attribute, screenshot, bounding box, accessibility/snapshot 가능한 표면, fixture probe API를 조합해 검증한다.

**기술 스택:** Playwright 1.60, Vite 8, TypeScript 6, pnpm workspace, Turborepo, Node.js built-in HTTP/WebSocket fixture.

## 진행 기록

- 2026-05-25: Playwright 설정, DevTools browser fixture, seeded panel 시각 회귀 테스트를 구현했다.
- 2026-05-25: 실제 브라우저에서 fetch ReadableStream, EventSource, WebSocket 수집 경로를 검증하도록 확장했다.
- 2026-05-25: PR/push에서 단위 테스트, 타입체크, 빌드, 브라우저 E2E, lint, format을 실행하는 CI workflow를 연결했다.
- 2026-05-25: Playwright screenshot baseline이 OS별 파일명으로 분리되므로, Linux CI에서는 기능 E2E만 실행하고 시각 snapshot 비교는 로컬 baseline 검증으로 제한했다.

## 의식적 부채: CI 시각 snapshot

- **포기하는 것:** Linux CI에서 seeded DevTools panel screenshot을 직접 비교하는 검증.
- **왜 지금은 감당 가능한가:** CI는 panel mount, seeded data count, 실제 fetch stream/EventSource/WebSocket 수집 경로를 계속 검증한다. 시각 회귀는 macOS 기준 snapshot으로 로컬에서 유지된다.
- **회수 시점:** Linux snapshot baseline을 생성해 커밋하거나, Playwright 실행 환경을 컨테이너/폰트까지 고정해 OS 차이를 제거할 때 회수한다.

---

## 현재 코드 기준

- `packages/plugin-vite/src/injection.ts`는 dev entry 앞에 `virtual:browse-sent-event/bootstrap`을 주입한다.
- bootstrap은 `installBrowseSentEvent()`를 옵션 없이 호출하므로 패널 기본 상태는 `autoOpen: false`다.
- `installBrowseSentEvent()`는 `window.__browseSentEventRuntime__`에 runtime을 저장하고 `bse-devtools-panel`을 body에 mount한다.
- `bse-devtools-panel`은 closed Shadow DOM을 사용한다.
- panel host는 `setOpen(open: boolean)` public method와 `open` reflected attribute를 가진다.
- 현재 테스트는 happy-dom 단위 테스트와 Vite middleware fixture 중심이며, 실제 브라우저 screenshot/e2e 검증은 없다.

## 구현 계획

### 작업 1: Playwright root 설정 추가

**파일:**
- 생성: `playwright.config.ts`
- 수정: `package.json`
- 수정: `turbo.json`

**단계 1: root script 추가**

`package.json`에 e2e script를 추가한다.

```json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:update": "playwright test --update-snapshots"
  }
}
```

**단계 2: Playwright config 작성**

`playwright.config.ts`를 생성한다.

```typescript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4174",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: "chromium-mobile",
      use: {
        ...devices["Pixel 7"],
      },
    },
  ],
  webServer: {
    command: "pnpm --filter @browse-sent-event/devtools-browser-fixture dev --host 127.0.0.1 --port 4174",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

**단계 3: turbo task 추가**

`turbo.json`에 `test:e2e` task를 추가한다.

```json
{
  "tasks": {
    "test:e2e": {
      "dependsOn": ["build"],
      "outputs": ["playwright-report/**", "test-results/**"]
    }
  }
}
```

**단계 4: 검증**

실행:

```bash
pnpm test:e2e
```

기대 결과:

- 아직 `e2e` 테스트와 fixture가 없어 실패한다.

**커밋:**

```bash
git add package.json turbo.json playwright.config.ts
git commit -m "test(e2e): Playwright 브라우저 검증 설정 추가"
```

### 작업 2: DevTools browser fixture 앱 추가

**파일:**
- 생성: `examples/devtools-browser-fixture/package.json`
- 생성: `examples/devtools-browser-fixture/index.html`
- 생성: `examples/devtools-browser-fixture/src/main.ts`
- 생성: `examples/devtools-browser-fixture/src/fixture-probe.ts`
- 생성: `examples/devtools-browser-fixture/tsconfig.json`
- 생성: `examples/devtools-browser-fixture/vite.config.ts`
- 수정: `examples/README.md`

**단계 1: fixture package 생성**

`examples/devtools-browser-fixture/package.json`:

```json
{
  "name": "@browse-sent-event/devtools-browser-fixture",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@browse-sent-event/core": "workspace:*",
    "@browse-sent-event/plugin-vite": "workspace:*"
  },
  "devDependencies": {
    "vite": "^8.0.14"
  }
}
```

**단계 2: Vite config 생성**

`examples/devtools-browser-fixture/vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import browseSentEvent from "@browse-sent-event/plugin-vite";

export default defineConfig({
  plugins: [browseSentEvent()],
});
```

**단계 3: fixture probe 작성**

`examples/devtools-browser-fixture/src/fixture-probe.ts`는 runtime과 panel host를 테스트가 안전하게 조작할 수 있게 한다.

```typescript
import type { BrowseSentEventRuntime } from "@browse-sent-event/core";

interface BrowseSentEventPanelHost extends HTMLElement {
  setOpen(open: boolean): void;
}

function getRuntime(): BrowseSentEventRuntime {
  const runtime = Reflect.get(globalThis.window, "__browseSentEventRuntime__");

  if (!runtime) {
    throw new Error("browse-sent-event runtime is not installed");
  }

  return runtime as BrowseSentEventRuntime;
}

function getPanel(): BrowseSentEventPanelHost {
  const panel = document.querySelector("bse-devtools-panel");

  if (!panel || !("setOpen" in panel)) {
    throw new Error("browse-sent-event panel is not mounted");
  }

  return panel as BrowseSentEventPanelHost;
}

export function seedPanel(): void {
  const runtime = getRuntime();
  const connection = runtime.engine.recordConnection({
    openedAt: 1_000,
    protocol: "websocket",
    state: "open",
    url: "wss://fixture.test/socket",
  });

  runtime.engine.recordMessage({
    connectionId: connection.id,
    direction: "out",
    payload: "client hello",
    protocol: "websocket",
    timestamp: 1_100,
    type: "message",
  });
  runtime.engine.recordMessage({
    connectionId: connection.id,
    direction: "in",
    payload: "server hello",
    protocol: "websocket",
    timestamp: 1_200,
    type: "message",
  });

  getPanel().setOpen(true);
}

export function closePanel(): void {
  getPanel().setOpen(false);
}

export function getSnapshotCounts(): { connections: number; messages: number } {
  const snapshot = getRuntime().engine.getSnapshot();

  return {
    connections: snapshot.connections.length,
    messages: snapshot.messages.length,
  };
}
```

**단계 4: main entry 작성**

`examples/devtools-browser-fixture/src/main.ts`:

```typescript
import { closePanel, getSnapshotCounts, seedPanel } from "./fixture-probe.js";

declare global {
  interface Window {
    __bseFixture: {
      closePanel(): void;
      getSnapshotCounts(): { connections: number; messages: number };
      seedPanel(): void;
    };
  }
}

window.__bseFixture = {
  closePanel,
  getSnapshotCounts,
  seedPanel,
};

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <main>
    <h1>browse-sent-event browser fixture</h1>
    <button id="seed" type="button">Seed panel</button>
  </main>
`;

document.querySelector<HTMLButtonElement>("#seed")!.addEventListener("click", () => {
  window.__bseFixture.seedPanel();
});
```

**단계 5: typecheck 검증**

실행:

```bash
pnpm --filter @browse-sent-event/devtools-browser-fixture typecheck
```

기대 결과:

- TypeScript typecheck가 통과한다.

**커밋:**

```bash
git add examples/README.md examples/devtools-browser-fixture
git commit -m "test(e2e): DevTools 브라우저 fixture 추가"
```

### 작업 3: 패널 mount와 시각 회귀 테스트 추가

**파일:**
- 생성: `e2e/devtools-panel.spec.ts`

**단계 1: 실패하는 테스트 작성**

`e2e/devtools-panel.spec.ts`:

```typescript
import { expect, test } from "@playwright/test";

test("mounts the closed-shadow DevTools panel host", async ({ page }) => {
  await page.goto("/");

  const panel = page.locator("bse-devtools-panel");

  await expect(panel).toHaveCount(1);
  await expect(panel).not.toHaveAttribute("open", "");
});

test("renders seeded transport data in the panel", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    window.__bseFixture.seedPanel();
  });

  const panel = page.locator("bse-devtools-panel");
  const counts = await page.evaluate(() => window.__bseFixture.getSnapshotCounts());
  const box = await panel.boundingBox();

  expect(counts).toEqual({ connections: 1, messages: 2 });
  await expect(panel).toHaveAttribute("open", "");
  expect(box?.width).toBeGreaterThan(300);
  expect(box?.height).toBeGreaterThan(300);
  await expect(panel).toHaveScreenshot("devtools-panel-seeded.png", {
    animations: "disabled",
  });
});
```

**단계 2: RED 확인**

실행:

```bash
pnpm test:e2e
```

기대 결과:

- screenshot snapshot이 없어서 실패한다.

**단계 3: snapshot 생성**

실행:

```bash
pnpm test:e2e:update
```

기대 결과:

- `e2e/devtools-panel.spec.ts-snapshots/` 아래에 desktop/mobile snapshot이 생성된다.

**단계 4: GREEN 확인**

실행:

```bash
pnpm test:e2e
```

기대 결과:

- Chromium desktop/mobile에서 테스트가 통과한다.

**커밋:**

```bash
git add e2e/devtools-panel.spec.ts e2e/devtools-panel.spec.ts-snapshots
git commit -m "test(e2e): DevTools 패널 시각 검증 추가"
```

### 작업 4: 실제 fetch stream과 EventSource 브라우저 경로 검증

**파일:**
- 수정: `examples/devtools-browser-fixture/vite.config.ts`
- 수정: `examples/devtools-browser-fixture/src/fixture-probe.ts`
- 수정: `e2e/devtools-panel.spec.ts`

**단계 1: Vite middleware fixture 추가**

`vite.config.ts`에 fixture endpoint를 추가한다.

```typescript
import type { Connect } from "vite";

function writeStream(res: Connect.ServerResponse, chunks: readonly string[]): void {
  res.statusCode = 200;
  res.setHeader("content-type", "text/plain; charset=utf-8");

  for (const chunk of chunks) {
    res.write(chunk);
  }

  res.end();
}

function writeSse(res: Connect.ServerResponse, chunks: readonly string[]): void {
  res.statusCode = 200;
  res.setHeader("content-type", "text/event-stream; charset=utf-8");

  for (const chunk of chunks) {
    res.write(`data: ${chunk}\n\n`);
  }

  res.end();
}
```

`configureServer`에서 `/__bse-fixture/stream`과 `/__bse-fixture/events`를 처리한다.

**단계 2: browser probe 추가**

`fixture-probe.ts`에 실제 browser API 호출 함수를 추가한다.

```typescript
export async function runFetchStream(): Promise<void> {
  const response = await fetch("/__bse-fixture/stream");
  await response.text();
}

export async function runEventSource(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const source = new EventSource("/__bse-fixture/events");
    let count = 0;
    source.onmessage = () => {
      count += 1;
      if (count >= 2) {
        source.close();
        resolve();
      }
    };
    source.onerror = () => {
      source.close();
      reject(new Error("EventSource fixture failed"));
    };
  });
}
```

**단계 3: e2e 테스트 추가**

```typescript
test("records fetch stream and EventSource messages in a real browser", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await window.__bseFixture.runFetchStream();
    await window.__bseFixture.runEventSource();
  });

  const counts = await page.evaluate(() => window.__bseFixture.getSnapshotCounts());

  expect(counts.connections).toBeGreaterThanOrEqual(2);
  expect(counts.messages).toBeGreaterThanOrEqual(2);
});
```

**단계 4: 검증**

실행:

```bash
pnpm test:e2e
pnpm test
```

기대 결과:

- e2e와 기존 단위 테스트가 모두 통과한다.

**커밋:**

```bash
git add examples/devtools-browser-fixture e2e/devtools-panel.spec.ts
git commit -m "test(e2e): 브라우저 transport 수집 검증 추가"
```

### 작업 5: WebSocket 브라우저 경로 검증

**파일:**
- 생성: `e2e/support/websocket-fixture.ts`
- 수정: `playwright.config.ts`
- 수정: `examples/devtools-browser-fixture/src/fixture-probe.ts`
- 수정: `e2e/devtools-panel.spec.ts`

**단계 1: 의존성 없는 WebSocket fixture server 작성**

Node.js 표준 `node:http`와 `node:crypto`만 사용해 최소 WebSocket handshake와 text frame echo를 구현한다. 새 npm dependency를 추가하지 않는다.

**단계 2: Playwright global setup 또는 test fixture 연결**

테스트 시작 전에 WebSocket server를 띄우고, 종료 시 닫는다.

**단계 3: browser probe 추가**

```typescript
export async function runWebSocket(url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.onopen = () => socket.send("browser hello");
    socket.onmessage = () => {
      socket.close();
      resolve();
    };
    socket.onerror = () => reject(new Error("WebSocket fixture failed"));
  });
}
```

**단계 4: e2e 테스트 추가**

```typescript
test("records WebSocket messages in a real browser", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async (url) => {
    await window.__bseFixture.runWebSocket(url);
  }, process.env.BSE_WS_FIXTURE_URL);

  const counts = await page.evaluate(() => window.__bseFixture.getSnapshotCounts());

  expect(counts.connections).toBeGreaterThanOrEqual(1);
  expect(counts.messages).toBeGreaterThanOrEqual(2);
});
```

**의식적 부채:**

- 포기하는 것: 완전한 WebSocket protocol server 구현.
- 감당 가능한 이유: 검증 목적은 browser `WebSocket` API와 interceptor 기록 경로이며, echo text frame만 있으면 충분하다.
- 회수 시점: binary frame, close code, reconnect UI를 검증하는 Phase 1 polish/e2e 확장 시점.

**커밋:**

```bash
git add playwright.config.ts e2e examples/devtools-browser-fixture
git commit -m "test(e2e): WebSocket 브라우저 수집 검증 추가"
```

### 작업 6: CI와 문서 연결

**파일:**
- 수정: `.github/workflows/ci.yml` 또는 생성: `.github/workflows/ci.yml`
- 수정: `README.md`
- 수정: `docs/index.md`
- 수정: `docs/plans/2026-05-25-devtools-browser-verification.md`

**단계 1: CI workflow 확인 또는 생성**

현재 저장소에는 docs workflow만 있으므로, CI workflow가 없다면 생성한다.

```yaml
name: CI

on:
  pull_request:
  push:
    branches:
      - main

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false
      - uses: actions/setup-node@v6
        with:
          node-version: 24.13.0
          cache: pnpm
      - run: corepack enable
      - run: corepack prepare pnpm@11.2.2 --activate
      - run: pnpm install --frozen-lockfile
      - run: pnpm audit --audit-level moderate
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm test
      - run: pnpm exec turbo run typecheck --force
      - run: pnpm exec turbo run build --force
      - run: pnpm test:e2e
      - run: pnpm lint
      - run: pnpm format:check
```

**단계 2: README 업데이트**

개발 명령에 `pnpm test:e2e`를 추가한다.

**단계 3: 문서 사이트 index 업데이트**

계획 문서 링크에 이 계획을 추가한다.

**커밋:**

```bash
git add .github/workflows/ci.yml README.md docs/index.md docs/plans/2026-05-25-devtools-browser-verification.md
git commit -m "ci(test): 브라우저 검증 workflow 추가"
```

## 검증 계획

### 로컬 검증

```bash
pnpm install --frozen-lockfile
pnpm audit --json
pnpm peers check
pnpm --filter @browse-sent-event/core build
pnpm --filter @browse-sent-event/plugin-vite build
pnpm --filter @browse-sent-event/devtools-browser-fixture typecheck
pnpm test:e2e
pnpm test
pnpm exec turbo run typecheck --force
pnpm exec turbo run build --force
pnpm lint
pnpm format:check
git diff --check
```

### 브라우저 화면 검증

- Desktop viewport `1280x720`에서 panel이 viewport 안에 들어온다.
- Mobile viewport에서 panel `max-width: calc(100vw - 32px)`가 지켜진다.
- seeded 상태의 panel screenshot이 비어 있지 않고 snapshot과 일치한다.
- panel host의 `open` attribute가 public method와 함께 토글된다.
- closed Shadow DOM 내부를 테스트 편의로 open mode로 바꾸지 않는다.

### 공급망 검증

- 새 third-party runtime dependency를 추가하지 않는다.
- WebSocket fixture는 Node 표준 모듈만 사용한다.
- `pnpm audit --json` vulnerability count가 모두 0이어야 한다.
- `pnpm install --frozen-lockfile`이 pnpm 11 supply-chain policy 검사를 통과해야 한다.

## 비범위

- 디자인 polish, resize, 위치 기억 구현.
- export 검색어 필터 부채 회수.
- binary WebSocket frame 검증.
- cross-browser matrix 전체 확장. 첫 배치는 Chromium desktop/mobile로 제한한다.
