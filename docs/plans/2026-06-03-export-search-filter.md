# Export 검색어 필터 회수 구현 계획

> **Claude용:** 필수 하위 스킬: `superpowers:executing-plans`, `superpowers:test-driven-development`, `superpowers:verification-before-completion`를 사용해 이 계획을 작업 단위로 실행한다.

**목표:** DevTools 패널의 화면 검색 결과와 JSONL/log export 결과가 같은 필터 기준을 사용하도록 export 검색어 필터 부채를 회수한다.

**아키텍처:** runtime engine의 export API를 `BrowseSentEventSearchQuery` 기준으로 확장하고, export 대상 메시지 선택은 기존 `search()` 경로를 재사용한다. DevTools panel은 현재 선택된 connection, direction, query를 하나의 query 객체로 engine에 전달한다.

**기술 스택:** TypeScript 6, Vitest 4, happy-dom, Lit, pnpm workspace, Turborepo.

---

## 배경

현재 DevTools panel은 화면 렌더링에서 검색어를 반영하지만, export는 `connectionId`와 `direction`만 반영한다. 사용자는 필터링된 타임라인을 보고 export 버튼을 누르지만, 실제 export 파일에는 화면에 보이지 않는 메시지가 포함될 수 있다.

이 부채는 이전 DevTools UI 계획에서 의식적으로 남긴 항목이며, 첫 공개 배포 전에는 해결하거나 제한사항으로 명시해야 한다고 기록되어 있다. 기능을 숨기기보다 코드 경계를 맞춰서 회수한다.

## 진행 기록

- 2026-06-03: engine export API가 `BrowseSentEventSearchQuery`를 받도록 확장했다.
- 2026-06-03: DevTools panel `requestExport()`가 현재 query를 engine export에 전달하도록 연결했다.
- 2026-06-03: README와 기존 계획 문서의 export 검색어 필터 부채 기록을 회수 상태로 갱신했다.

## 현재 코드 기준

| 영역 | 파일 | 현재 상태 |
| --- | --- | --- |
| query 타입 | `packages/core/src/runtime/events.ts` | `BrowseSentEventSearchQuery`가 `BrowseSentEventMessageFilter`를 확장하고 `text`를 가진다. |
| engine 검색 | `packages/core/src/runtime/engine.ts` | `search(query)`는 `getMessages(query)` 뒤 payload text를 필터링한다. |
| engine export | `packages/core/src/runtime/engine.ts` | `exportJsonl(filter?)`, `exportLog(filter?)`는 `BrowseSentEventMessageFilter`만 받는다. |
| panel export | `packages/core/src/ui/components/devtools-panel.ts` | `requestExport()`는 `selectedConnectionId`, `direction`만 전달한다. |
| 화면 필터 | `packages/core/src/ui/view-model.ts` | `query`가 `payloadPreview`에 반영되어 화면 메시지를 필터링한다. |

## 구현 계획

### 작업 1: engine export가 검색어 query를 받도록 확장

**파일:**
- 수정: `packages/core/src/runtime/engine.ts`
- 테스트: `packages/core/src/runtime/__tests__/engine.test.ts`

**단계 1: 실패하는 engine 테스트 작성**

`packages/core/src/runtime/__tests__/engine.test.ts`의 `"filters, searches, and exports messages"` 테스트를 확장한다.

```typescript
engine.recordMessage({
  connectionId: connection.id,
  direction: "in",
  protocol: "fetch-stream",
  payload: "Ignored Chunk",
});

expect(engine.exportJsonl({ text: "token" })).toContain('"payload":"First Token"');
expect(engine.exportJsonl({ text: "token" })).not.toContain('"payload":"Ignored Chunk"');
expect(engine.exportLog({ text: "token" })).toContain("First Token");
expect(engine.exportLog({ text: "token" })).not.toContain("Ignored Chunk");
```

**단계 2: RED 확인**

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/runtime/__tests__/engine.test.ts
```

기대 결과:

- TypeScript 또는 Vitest가 `text`가 `BrowseSentEventMessageFilter`에 없다고 실패한다.
- 아직 export가 검색어를 반영하지 않으므로 `"Ignored Chunk"`가 export에 포함된다.

**단계 3: engine 타입과 구현 변경**

`BrowseSentEventEngine`에서 export API를 `BrowseSentEventSearchQuery` 기준으로 바꾼다.

```typescript
exportJsonl(query?: BrowseSentEventSearchQuery): string;
exportLog(query?: BrowseSentEventSearchQuery): string;
```

export 대상 메시지를 고르는 helper를 추가한다.

```typescript
function getExportMessages(query?: BrowseSentEventSearchQuery): BrowseSentEventMessage[] {
  return query ? search(query) : getMessages();
}
```

`exportJsonl()`과 `exportLog()`는 `getExportMessages(query)`를 사용한다.

**단계 4: GREEN 확인**

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/runtime/__tests__/engine.test.ts
pnpm --filter @browse-sent-event/core typecheck
```

기대 결과:

- engine 테스트가 통과한다.
- export API 변경 후 타입 검사가 통과한다.

**커밋:**

```bash
git add packages/core/src/runtime/engine.ts packages/core/src/runtime/__tests__/engine.test.ts
git commit -m "fix(export): engine 내보내기에 검색어 필터 적용"
```

### 작업 2: DevTools panel export에 query 연결

**파일:**
- 수정: `packages/core/src/ui/components/devtools-panel.ts`
- 테스트: `packages/core/src/ui/__tests__/mount.test.ts`

**단계 1: 실패하는 panel export 테스트 작성**

`packages/core/src/ui/__tests__/mount.test.ts`에 검색어가 export content에 반영되는 테스트를 추가한다.

```typescript
it("dispatches export content filtered by query", () => {
  const engine = createDevtoolsEngine({ capacity: 10 });
  const mounted = mountDevtoolsPanel({
    engine,
    options: {
      autoOpen: true,
      hotkey: "cmd+shift+r",
      position: "bottom-right",
    },
    target: globalThis.window,
  });
  const connection = engine.recordConnection({
    protocol: "websocket",
    url: "wss://example.test/socket",
  });

  engine.recordMessage({
    connectionId: connection.id,
    direction: "in",
    protocol: "websocket",
    payload: "keep this message",
  });
  engine.recordMessage({
    connectionId: connection.id,
    direction: "in",
    protocol: "websocket",
    payload: "skip this message",
  });

  const exports: unknown[] = [];

  mounted.element.addEventListener("bse-export", (event) => {
    if (event instanceof globalThis.CustomEvent) {
      exports.push(event.detail);
    }
  });

  Reflect.get(mounted.element, "setQuery")?.call(mounted.element, "keep");
  Reflect.get(mounted.element, "requestExport")?.call(mounted.element, "jsonl");

  expect(exports).toEqual([
    expect.objectContaining({
      content: expect.stringContaining("keep this message"),
      format: "jsonl",
    }),
  ]);
  expect((exports[0] as { content: string }).content).not.toContain("skip this message");

  mounted.unmount();
});
```

**단계 2: RED 확인**

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/ui/__tests__/mount.test.ts
```

기대 결과:

- 현재 `requestExport()`가 `query`를 전달하지 않으므로 `"skip this message"`가 export content에 포함되어 실패한다.

**단계 3: panel export query 연결**

`devtools-panel.ts`에서 export filter 타입을 `BrowseSentEventSearchQuery`로 바꾼다.

```typescript
const query: BrowseSentEventSearchQuery = {
  connectionId: this.selectedConnectionId,
  direction: this.direction,
  text: this.query || undefined,
};
```

`exportJsonl(query)`와 `exportLog(query)`를 호출한다.

**단계 4: GREEN 확인**

실행:

```bash
pnpm --filter @browse-sent-event/core test -- src/ui/__tests__/mount.test.ts
pnpm --filter @browse-sent-event/core typecheck
```

기대 결과:

- panel export 테스트가 통과한다.
- `BrowseSentEventSearchQuery` import와 타입 검사가 통과한다.

**커밋:**

```bash
git add packages/core/src/ui/components/devtools-panel.ts packages/core/src/ui/__tests__/mount.test.ts
git commit -m "fix(export): 패널 내보내기에 검색어 전달"
```

### 작업 3: 부채 기록과 문서 갱신

**파일:**
- 수정: `README.md`
- 수정: `docs/index.md`
- 수정: `docs/.vitepress/config.mts`
- 수정: `docs/plans/2026-05-19-devtools-ui.md`
- 수정: `docs/plans/2026-05-27-docs-release-readiness.md`
- 생성 또는 수정: `docs/plans/2026-06-03-export-search-filter.md`

**단계 1: README 부채 목록 정리**

`README.md`의 릴리즈 전 필수 후보에서 `export 검색어 필터 반영 부채 회수`를 제거한다.

**단계 2: 기존 계획 문서에 회수 기록 추가**

`docs/plans/2026-05-19-devtools-ui.md`의 의식적 기술 부채 표 아래에 회수 기록을 추가한다.

```markdown
### 부채 회수 기록

- 2026-06-03: export가 검색어 query를 반영하지 않던 부채를 engine export API와 panel export 연결을 통해 회수했다.
```

`docs/plans/2026-05-27-docs-release-readiness.md`에도 릴리즈 전 필수 후보 중 export 부채 회수 완료를 기록한다.

**단계 3: VitePress navigation 갱신**

`docs/index.md`와 `docs/.vitepress/config.mts`에 이번 계획 문서 링크를 추가한다.

**커밋:**

```bash
git add README.md docs/index.md docs/.vitepress/config.mts docs/plans/2026-05-19-devtools-ui.md docs/plans/2026-05-27-docs-release-readiness.md docs/plans/2026-06-03-export-search-filter.md
git commit -m "docs(export): 검색어 필터 부채 회수 기록"
```

## 검증 계획

### 표적 검증

```bash
pnpm --filter @browse-sent-event/core test -- src/runtime/__tests__/engine.test.ts
pnpm --filter @browse-sent-event/core test -- src/ui/__tests__/mount.test.ts
pnpm --filter @browse-sent-event/core typecheck
```

### 전체 검증

```bash
pnpm install --frozen-lockfile
pnpm docs:build
pnpm test
pnpm exec turbo run typecheck --force
pnpm exec turbo run build --force
pnpm lint
pnpm format:check
git diff --check
```

### GitHub 검증

PR 생성 후 GitHub Actions `CI`가 다음 항목을 통과해야 한다.

- dependency install
- audit
- peer check
- package test
- typecheck
- build
- browser E2E
- lint
- format check

## 의식적 부채

| 부채 | 지금 포기하는 것 | 지금 감당 가능한 이유 | 회수 시점 |
| --- | --- | --- | --- |
| browser E2E에서 export content 직접 검증 | 실제 브라우저 fixture에서 export event content까지 검증하는 시나리오 | 이번 변경의 핵심 경계는 engine export API와 panel export event이며, happy-dom unit test로 검색어 전달과 content 필터링을 직접 검증할 수 있다. 기존 browser E2E는 runtime injection과 transport 수집을 계속 검증한다. | export 다운로드 UX를 추가하거나, fixture probe에 export capture API를 추가할 때 |

## 완료 기준

- `engine.exportJsonl({ text })`와 `engine.exportLog({ text })`가 검색어에 맞는 메시지만 내보낸다.
- connection, direction, text query를 함께 전달해도 export 결과가 같은 기준으로 필터링된다.
- DevTools panel `requestExport()`가 현재 검색어를 engine export에 전달한다.
- README의 릴리즈 전 필수 후보에서 export 검색어 필터 부채가 제거된다.
- 관련 계획 문서에 부채 회수 기록이 남는다.
- 전체 로컬 검증과 GitHub Actions CI가 통과한다.
