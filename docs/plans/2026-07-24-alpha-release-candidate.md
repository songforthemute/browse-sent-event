---
search: false
---

# 첫 alpha 배포 후보 구현 계획

> **Claude용:** 구현 단계에서는 `superpowers:executing-plans`, `superpowers:test-driven-development`, `superpowers:verification-before-completion`을 사용해 작업 단위로 진행한다.

**목표:** `@browse-sent-event/core`와 `@browse-sent-event/plugin-vite`의 `0.1.0-alpha.0` 배포 후보를 만들고, 실제 npm publish를 제외한 버전·보안·tarball·소비자 설치 검증을 완료한다.

**아키텍처:** 이미 병합된 XHR changeset을 공개 패키지 버전의 단일 입력으로 사용한다. Changesets가 비공개 브라우저 fixture를 불필요하게 versioning하지 않도록 정책을 먼저 검증하고, 생성된 package manifest와 tarball을 별도의 소비자 환경에서 확인한 뒤 maintainer 수동 publish 직전에 멈춘다.

**기술 스택:** pnpm 11, npm 11, Changesets 2, Turborepo 2, TypeScript 6, Vite 8, Vitest 4, Playwright, Node.js test runner.

**관련 문서:**

- `docs/release/npm-publish.md`
- `docs/plans/2026-06-03-npm-publish-readiness.md`
- `.changeset/README.md`
- `.changeset/calm-xhrs-observe.md`

---

## 범위

### 포함

1. Changesets의 비공개 package version/tag 정책 명시
2. `@browse-sent-event/devtools-browser-fixture` release plan 제외 검증
3. 기존 XHR changeset을 이용한 `0.1.0-alpha.0` 생성
4. package changelog와 lockfile 갱신
5. registry/scope, audit, peer dependency 점검
6. 전체 정적 검사, 단위 테스트, 브라우저 E2E, 빌드
7. tarball manifest와 격리된 소비자 설치 검증
8. `npm publish --dry-run` 결과 기록
9. maintainer가 실행할 수동 publish 직전 체크리스트 정리

### 제외

1. 실제 `npm publish`
2. `NPM_TOKEN`, trusted publishing, `changesets/action` 설정
3. GitHub Actions의 자동 publish 단계
4. 이번 후보와 무관한 dependency 업데이트
5. Phase 2 인과관계 추적 기능
6. alpha publish 이후 README 설치 문구 전환

---

## 현재 상태

| 항목 | 현재 값 | 기대 값 |
| --- | --- | --- |
| core version | `0.0.0` | `0.1.0-alpha.0` |
| plugin-vite version | `0.0.0` | `0.1.0-alpha.0` |
| browser fixture version | `0.0.0` | `0.0.0` 유지 |
| 공개 changeset | `calm-xhrs-observe` | version 생성에 소비 |
| npm publish | 실행하지 않음 | maintainer 수동 승인까지 보류 |

현재 `pnpm changeset status`는 다음 세 package를 release plan에 넣는다.

```text
minor  @browse-sent-event/core
minor  @browse-sent-event/plugin-vite
patch  @browse-sent-event/devtools-browser-fixture
```

fixture의 patch는 직접 changeset이 아니라 공개 package의 `workspace:*` 의존성에서 파생된 bump다. fixture는 비공개 브라우저 검증 앱이고 npm 산출물이 아니므로 version과 tag 대상에서 제외하는 편이 release contract를 더 정확하게 표현한다.

---

## 설계 결정

### 1. 기존 XHR changeset을 단일 입력으로 사용

`.changeset/calm-xhrs-observe.md`가 이미 두 공개 package의 minor bump와 사용자 관점의 변경 내용을 기록한다. 첫 alpha 준비만을 설명하는 별도 changeset은 추가하지 않는다.

새 changeset을 추가하면 같은 기능이 changelog에 중복 기록되고, release type의 근거가 기능 변경과 배포 준비 문서로 나뉜다.

### 2. 비공개 package 정책과 fixture 제외를 분리

`.changeset/config.json`에 다음 두 의도를 각각 명시한다.

- `privatePackages.version: false`, `privatePackages.tag: false`: 비공개 package를 일반 version/tag 대상으로 취급하지 않는다.
- `ignore`: 공개 package의 dependency graph에서 파생된 fixture patch를 `none`으로 낮춰 버전 변경 대상에서 제외한다.

`privatePackages` 기본값에만 의존하지 않는다. 현재 CLI가 기본값 아래에서도 fixture patch를 출력하므로 `status --output` 결과를 실제 승인 기준으로 삼는다.

### 3. package dependency 의미를 release 도구 때문에 바꾸지 않음

fixture의 core와 plugin 의존성을 `dependencies`에서 `devDependencies`로 옮기지 않는다. 브라우저 fixture가 실행 시 소비하는 package라는 의미가 현재 선언과 맞으며, Changesets 결과만 피하려고 package model을 왜곡하지 않는다.

### 4. version 생성과 frozen install 사이에 lockfile 갱신

`pnpm changeset version`은 package version과 changelog를 바꾼다. 이 상태에서 기존 lockfile을 전제로 `pnpm install --frozen-lockfile`부터 실행하지 않는다.

```text
changeset version
      ↓
pnpm install
      ↓
lockfile diff 검토
      ↓
pnpm install --frozen-lockfile
```

첫 install은 의도된 lockfile 갱신 단계이고, 두 번째 install은 생성된 후보가 clean checkout에서도 재현되는지 확인하는 단계다.

### 5. 실제 publish는 release candidate 바깥의 승인 단계

이 계획은 dry-run 결과와 수동 명령을 제공하는 데서 끝난다. npm 로그인 상태, OTP, 실제 publish 여부는 maintainer만 결정한다.

---

## 기술 부채 기록

| 선택 | 포기하는 것 | 지금 감당 가능한 이유 | 회수 시점 |
| --- | --- | --- | --- |
| 수동 npm publish 유지 | 자동 배포와 provenance 자동화 | 첫 공개 alpha이며 publish 권한 노출 범위를 최소화하는 것이 우선이다 | maintainer가 자동화를 승인하고 권한·복구·감사 정책이 문서화될 때 |
| fixture를 Changesets ignore에 명시 | 공개 package 변경에 따른 fixture version 자동 증가 | fixture는 `private: true`, `workspace:*` 기반의 비배포 검증 앱이고 독립 version contract가 없다 | fixture를 외부 배포하거나 고정 package version을 소비하게 될 때 |
| 검증 결과를 문서에 수동 기록 | 자동 release evidence 수집 | 첫 후보에서 필요한 필드와 실패 기준을 먼저 확정할 수 있다 | alpha 후보 절차가 두 번 이상 반복되어 자동화 가치가 확인될 때 |

---

## 커밋 구성

| 순서 | 책임 | 커밋 메시지 |
| --- | --- | --- |
| 1 | 비공개 package release plan 정책 | `chore(release): 비공개 패키지 버전 정책 확정` |
| 2 | alpha version, changelog, lockfile | `chore(release): 0.1.0-alpha.0 배포 후보 생성` |
| 3 | registry, 보안, tarball, dry-run 결과 | `docs(release): 알파 후보 검증 결과 기록` |

dependency 취약점이나 기능 오류가 발견되면 위 커밋에 섞지 않는다. 해당 문제를 별도 브랜치와 PR로 해결한 뒤 alpha 후보 브랜치를 `main` 위로 갱신한다.

---

## 구현 계획

### 작업 1: baseline과 release plan 재현

**파일:**

- 읽기: `.changeset/config.json`
- 읽기: `.changeset/calm-xhrs-observe.md`
- 읽기: `examples/devtools-browser-fixture/package.json`
- 임시 생성: `/tmp/browse-sent-event-release-plan-before.json`

#### 단계 1: clean baseline 확인

```bash
git status --short --branch
git diff --check
pnpm changeset status
```

기대 결과:

- 계획 문서 커밋 외에 작업 트리 변경이 없다.
- core와 plugin-vite는 minor, fixture는 patch로 출력되어 문제를 재현한다.

#### 단계 2: JSON release plan 저장

```bash
pnpm changeset status --output /tmp/browse-sent-event-release-plan-before.json
cat /tmp/browse-sent-event-release-plan-before.json
```

기대 결과:

- `changesets`에는 `calm-xhrs-observe` 하나만 있다.
- `releases`에는 공개 package 두 개와 fixture가 있다.
- fixture의 `changesets` 배열은 비어 있고 type은 `patch`다.

#### 단계 3: 직접 changeset 대상 검증

```bash
node --input-type=module -e '
  import fs from "node:fs";
  const plan = JSON.parse(fs.readFileSync("/tmp/browse-sent-event-release-plan-before.json", "utf8"));
  const direct = plan.changesets.flatMap((changeset) => changeset.releases.map(({ name, type }) => ({ name, type })));
  const expected = [
    { name: "@browse-sent-event/core", type: "minor" },
    { name: "@browse-sent-event/plugin-vite", type: "minor" },
  ];
  if (JSON.stringify(direct) !== JSON.stringify(expected)) {
    throw new Error(`unexpected direct releases: ${JSON.stringify(direct)}`);
  }
'
```

기대 결과: exit code `0`.

---

### 작업 2: 비공개 package version 정책 확정

**파일:**

- 수정: `.changeset/config.json`
- 수정: `.changeset/README.md`
- 수정: `docs/release/npm-publish.md`
- 임시 생성: `/tmp/browse-sent-event-release-plan-after.json`

#### 단계 1: 실패 기준 고정

설정 변경 전에 fixture가 버전 변경 대상이 아니라고 가정하는 검증을 실행한다.

```bash
node --input-type=module -e '
  import fs from "node:fs";
  const plan = JSON.parse(fs.readFileSync("/tmp/browse-sent-event-release-plan-before.json", "utf8"));
  const names = plan.releases.map(({ name }) => name);
  if (names.includes("@browse-sent-event/devtools-browser-fixture")) {
    throw new Error("private browser fixture is still included");
  }
'
```

기대 결과: `private browser fixture is still included`로 실패.

#### 단계 2: Changesets 설정 변경

`.changeset/config.json` 전체를 다음과 같이 갱신한다.

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.1.1/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "privatePackages": {
    "version": false,
    "tag": false
  },
  "ignore": ["@browse-sent-event/devtools-browser-fixture"]
}
```

#### 단계 3: release plan 재생성

```bash
pnpm changeset status --output /tmp/browse-sent-event-release-plan-after.json
cat /tmp/browse-sent-event-release-plan-after.json
```

기대 결과:

- core minor와 plugin-vite minor만 실제 버전 변경 대상으로 남는다.
- JSON `releases`의 fixture는 `type: "none"`, `newVersion: "0.0.0"`으로 남을 수 있다.
- Changesets가 ignored package dependency 오류를 내지 않는다.

오류가 발생하면 설정을 커밋하지 않는다. fixture version 변경을 허용하는 대안을 검토하고, 허용 이유와 비배포 보장을 이 계획 문서에 먼저 갱신한 뒤 사용자 승인을 받는다.

#### 단계 4: 통과 기준 검증

```bash
node --input-type=module -e '
  import fs from "node:fs";
  const plan = JSON.parse(fs.readFileSync("/tmp/browse-sent-event-release-plan-after.json", "utf8"));
  const actual = plan.releases.map(({ name, type, newVersion }) => ({ name, type, newVersion }));
  const expected = [
    { name: "@browse-sent-event/core", type: "minor", newVersion: "0.1.0" },
    { name: "@browse-sent-event/plugin-vite", type: "minor", newVersion: "0.1.0" },
    { name: "@browse-sent-event/devtools-browser-fixture", type: "none", newVersion: "0.0.0" },
  ];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`unexpected release plan: ${JSON.stringify(actual)}`);
  }
'
```

기대 결과: exit code `0`.

#### 단계 5: 정책 문서 갱신

`.changeset/README.md`와 `docs/release/npm-publish.md`에 다음 내용을 반영한다.

1. public package만 version과 publish 대상이다.
2. private fixture는 `0.0.0`을 유지하고 Changesets 버전 변경 대상에서 제외한다.
3. fixture가 공개되거나 독립 version contract를 갖게 되면 ignore 정책을 제거한다.
4. 기존 XHR changeset이 있으므로 첫 alpha용 changeset을 새로 만들지 않는다.
5. npm 11의 scope 확인 명령은 `npm access list packages @browse-sent-event --json`이다.
6. version 뒤에는 일반 install로 lockfile을 갱신하고 frozen install을 다시 확인한다.

#### 단계 6: 설정 검증

```bash
pnpm changeset status
pnpm format:check
git diff --check
```

기대 결과:

- 공개 package 두 개만 minor로 출력된다.
- format과 whitespace 검사가 통과한다.

#### 단계 7: 첫 번째 커밋

```bash
git add .changeset/config.json .changeset/README.md docs/release/npm-publish.md
git commit -m "chore(release): 비공개 패키지 버전 정책 확정"
```

---

### 작업 3: registry와 공급망 preflight

**파일:**

- 수정 없음

이 단계는 네트워크와 maintainer의 npm 로그인 상태를 읽기만 한다. package version을 생성하기 전에 publish 자체가 가능한지 확인한다.

#### 단계 1: npm registry 확인

```bash
npm config get registry
npm view @browse-sent-event/core name version description --json
npm view @browse-sent-event/plugin-vite name version description --json
npm access list packages @browse-sent-event --json
```

기대 결과:

- registry는 `https://registry.npmjs.org/`다.
- package가 아직 없다면 두 `npm view`는 `E404`를 반환할 수 있다.
- `npm access list packages`는 로그인한 maintainer의 scope 접근 결과를 반환한다.

`E404`만으로 package가 비어 있거나 권한이 있다고 단정하지 않는다. scope 접근 결과가 불명확하면 version 생성 전에 중단한다.

#### 단계 2: dependency와 peer 상태 확인

```bash
pnpm install --frozen-lockfile
pnpm audit --audit-level moderate
pnpm peers check
```

기대 결과:

- lockfile 변경 없이 설치된다.
- moderate 이상 advisory가 없다.
- peer dependency 오류가 없다.

새 advisory가 발견되면 alpha PR에서 dependency를 함께 업데이트하지 않는다. advisory 식별자, 영향 버전, 실제 사용 경로를 기록하고 별도 보안 작업으로 전환한다.

#### 단계 3: baseline package 검증

```bash
pnpm test:release
pnpm exec turbo run build --force
pnpm pack:check
```

기대 결과:

- tarball 검증 테스트와 실제 pack이 통과한다.
- 현재 `0.0.0` 상태에서도 publish manifest에 `workspace:*`가 남지 않는다.

---

### 작업 4: `0.1.0-alpha.0` version 생성

**파일:**

- 생성: `.changeset/pre.json`
- 생성 또는 수정: `packages/core/CHANGELOG.md`
- 생성 또는 수정: `packages/plugin-vite/CHANGELOG.md`
- 수정: `packages/core/package.json`
- 수정: `packages/plugin-vite/package.json`
- 수정: `pnpm-lock.yaml`
- 삭제 예정: `.changeset/calm-xhrs-observe.md`

Changesets가 실제로 만든 파일만 stage한다. 예상 목록과 다른 파일이 바뀌면 원인을 확인하기 전에는 계속 진행하지 않는다.

#### 단계 1: prerelease mode 진입

```bash
pnpm changeset pre enter alpha
pnpm changeset status --output /tmp/browse-sent-event-alpha-plan.json
cat /tmp/browse-sent-event-alpha-plan.json
```

기대 결과:

- `.changeset/pre.json`이 생성된다.
- 공개 package 두 개의 새 버전이 `0.1.0-alpha.0`으로 계산된다.
- fixture는 release plan에 없다.

`pnpm changeset`은 실행하지 않는다. 기존 `calm-xhrs-observe`가 이미 version 입력을 제공한다.

#### 단계 2: prerelease plan 검증

```bash
node --input-type=module -e '
  import fs from "node:fs";
  const plan = JSON.parse(fs.readFileSync("/tmp/browse-sent-event-alpha-plan.json", "utf8"));
  const actual = plan.releases.map(({ name, newVersion }) => ({ name, newVersion }));
  const expected = [
    { name: "@browse-sent-event/core", newVersion: "0.1.0-alpha.0" },
    { name: "@browse-sent-event/plugin-vite", newVersion: "0.1.0-alpha.0" },
  ];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`unexpected alpha plan: ${JSON.stringify(actual)}`);
  }
'
```

기대 결과: exit code `0`.

#### 단계 3: version 적용

```bash
pnpm changeset version
git status --short
git diff -- packages/core/package.json packages/plugin-vite/package.json
git diff -- packages/core/CHANGELOG.md packages/plugin-vite/CHANGELOG.md
```

기대 결과:

- 공개 package 두 개의 version은 `0.1.0-alpha.0`이다.
- changelog에는 XHR 지원 내용이 한 번만 기록된다.
- fixture package는 `0.0.0`을 유지한다.
- root package는 `0.0.0`을 유지한다.

#### 단계 4: lockfile 갱신

```bash
pnpm install
git diff -- pnpm-lock.yaml
pnpm install --frozen-lockfile
```

기대 결과:

- 첫 install은 version 변경에 필요한 lockfile metadata만 갱신한다.
- dependency resolution이나 integrity가 예상 밖으로 바뀌지 않는다.
- 두 번째 frozen install은 추가 변경 없이 통과한다.

#### 단계 5: version invariant 검증

```bash
node --input-type=module -e '
  import fs from "node:fs";
  const read = (path) => JSON.parse(fs.readFileSync(path, "utf8"));
  const actual = {
    root: read("package.json").version,
    core: read("packages/core/package.json").version,
    plugin: read("packages/plugin-vite/package.json").version,
    fixture: read("examples/devtools-browser-fixture/package.json").version,
  };
  const expected = {
    root: "0.0.0",
    core: "0.1.0-alpha.0",
    plugin: "0.1.0-alpha.0",
    fixture: "0.0.0",
  };
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`unexpected versions: ${JSON.stringify(actual)}`);
  }
'
```

기대 결과: exit code `0`.

#### 단계 6: 두 번째 커밋

```bash
git add .changeset packages/core/package.json packages/core/CHANGELOG.md packages/plugin-vite/package.json packages/plugin-vite/CHANGELOG.md pnpm-lock.yaml
git commit -m "chore(release): 0.1.0-alpha.0 배포 후보 생성"
```

---

## 검증 계획

### 작업 5: 전체 저장소 검증

**파일:**

- 수정 없음

각 명령은 개별적으로 실행해 실패한 gate를 분명히 남긴다.

#### 단계 1: 정적 검사

```bash
pnpm format:check
pnpm lint
pnpm exec turbo run typecheck --force
git diff --check
```

기대 결과: 모든 명령이 exit code `0`.

#### 단계 2: 단위·통합 테스트

```bash
pnpm test
pnpm test:release
```

기대 결과:

- core, plugin-vite test가 통과한다.
- tarball validator의 Node.js test가 통과한다.

#### 단계 3: 실제 Chromium E2E

```bash
pnpm test:e2e
```

기대 결과:

- WebSocket, fetch stream, EventSource, XMLHttpRequest 수집 시나리오가 통과한다.
- runtime install/dispose와 UI 상호작용 시나리오가 통과한다.

#### 단계 4: 배포물과 문서 빌드

```bash
pnpm exec turbo run build --force
pnpm docs:build
```

기대 결과:

- 공개 package의 dist가 새 version source에서 생성된다.
- VitePress 문서가 정상 빌드된다.

---

### 작업 6: tarball과 소비자 설치 검증

**파일:**

- 임시 생성: `.tmp-pack/*.tgz`
- 임시 생성: 운영체제 temp 디렉터리의 소비자 프로젝트

#### 단계 1: tarball 생성과 manifest 검사

```bash
pnpm pack:check
```

기대 결과:

- core와 plugin-vite tarball이 `.tmp-pack`에 생성된다.
- 각 tarball의 version은 `0.1.0-alpha.0`이다.
- source, test, node_modules가 포함되지 않는다.
- plugin-vite의 배포 manifest에 `workspace:*`가 없다.

#### 단계 2: 임시 소비자 디렉터리 생성

```bash
CONSUMER_DIR="$(mktemp -d "${TMPDIR:-/tmp}/browse-sent-event-consumer.XXXXXX")"
printf '%s\n' "$CONSUMER_DIR"
cd "$CONSUMER_DIR"
npm init -y
```

기대 결과:

- 저장소 밖에 빈 npm package가 생성된다.
- workspace dependency resolution의 도움을 받지 않는다.

#### 단계 3: tarball과 peer dependency 설치

저장소 절대 경로를 `<REPOSITORY_ROOT>`에 대입한다.

```bash
npm install vite@^8.0.16 \
  "<REPOSITORY_ROOT>/.tmp-pack/browse-sent-event-core-0.1.0-alpha.0.tgz" \
  "<REPOSITORY_ROOT>/.tmp-pack/browse-sent-event-plugin-vite-0.1.0-alpha.0.tgz"
```

기대 결과:

- registry에 아직 없는 core를 tarball 간 dependency로 정상 해석한다.
- Vite peer dependency 오류가 없다.

#### 단계 4: 공개 export 검증

```bash
node --input-type=module -e '
  const core = await import("@browse-sent-event/core");
  if (typeof core.installBrowseSentEvent !== "function") {
    throw new Error("core installBrowseSentEvent export is missing");
  }
'

node --input-type=module -e '
  const plugin = await import("@browse-sent-event/plugin-vite");
  if (typeof plugin.default !== "function") {
    throw new Error("plugin-vite default export is missing");
  }
'
```

기대 결과: 두 명령 모두 exit code `0`.

#### 단계 5: 저장소로 복귀

```bash
cd <REPOSITORY_ROOT>
```

임시 소비자 디렉터리는 release evidence가 아니므로 커밋하지 않는다. 삭제는 검증 종료 후 경로를 다시 확인한 다음 수행한다.

---

### 작업 7: npm publish dry-run과 결과 기록

**파일:**

- 수정: `docs/release/npm-publish.md`

#### 단계 1: dry-run 실행

```bash
npm publish ./packages/core --dry-run --access public
npm publish ./packages/plugin-vite --dry-run --access public
```

기대 결과:

- 실제 publish가 일어나지 않는다.
- 두 package의 name과 version이 예상과 같다.
- tarball file count, package size, unpacked size가 출력된다.
- `workspace:*` dependency 오류가 없다.

#### 단계 2: 검증 결과 기록

`docs/release/npm-publish.md`에 `0.1.0-alpha.0 후보 검증` 절을 추가하고 다음 표를 실제 결과로 채운다.

```markdown
## 0.1.0-alpha.0 후보 검증

검증 일시: `<YYYY-MM-DD HH:mm KST>`
검증 커밋: `<commit SHA>`

| gate | 결과 | 비고 |
| --- | --- | --- |
| npm scope 접근 | pass/block | `<확인 결과>` |
| frozen install | pass | lockfile 추가 변경 없음 |
| audit moderate | pass | advisory 0건 |
| peer dependency | pass | 오류 없음 |
| format/lint/typecheck | pass | 오류 없음 |
| unit/release test | pass | `<테스트 수>` |
| Chromium E2E | pass | `<테스트 수>` |
| package/docs build | pass | 오류 없음 |
| core tarball | pass | `<file count, size>` |
| plugin-vite tarball | pass | `<file count, size>` |
| 소비자 tarball 설치 | pass | 두 공개 export 확인 |
| npm publish dry-run | pass | 실제 publish 없음 |
```

실제 수치와 결과만 기록한다. 아직 실행하지 않은 gate를 pass로 미리 적지 않는다.

#### 단계 3: 수동 publish 중단점 명시

검증 표 아래에 다음 원칙을 유지한다.

```markdown
이 후보는 실제 npm publish를 실행하지 않았다. maintainer는 PR 병합, 최신 CI,
npm 로그인과 scope 권한을 다시 확인한 뒤에만 두 package를 수동 publish한다.
```

#### 단계 4: 문서 검증

```bash
pnpm format:check
pnpm docs:build
git diff --check
```

기대 결과: 모든 명령이 exit code `0`.

#### 단계 5: 세 번째 커밋

```bash
git add docs/release/npm-publish.md
git commit -m "docs(release): 알파 후보 검증 결과 기록"
```

---

## 최종 검증

### 작업 8: clean checkout 기준 최종 gate

#### 단계 1: 전체 gate 재실행

```bash
pnpm install --frozen-lockfile
pnpm audit --audit-level moderate
pnpm peers check
pnpm format:check
pnpm lint
pnpm exec turbo run typecheck --force
pnpm test
pnpm test:release
pnpm test:e2e
pnpm exec turbo run build --force
pnpm docs:build
pnpm pack:check
git diff --check
```

기대 결과: 모든 명령이 exit code `0`.

#### 단계 2: commit과 변경 범위 확인

```bash
git status --short --branch
git log --oneline main..HEAD
git diff --stat main...HEAD
git diff --name-status main...HEAD
```

기대 결과:

- 작업 트리가 깨끗하다.
- 책임별 커밋 세 개가 있다.
- 자동 publish workflow, token, Phase 2 코드는 변경되지 않았다.

#### 단계 3: PR 생성

```bash
git push -u origin codex/alpha-release-candidate
gh pr create \
  --base main \
  --head codex/alpha-release-candidate \
  --draft \
  --title "chore(release): 0.1.0-alpha.0 배포 후보 준비" \
  --body-file <PR_BODY_FILE>
```

PR 본문에는 다음을 포함한다.

1. 두 공개 package의 후보 version
2. fixture version 제외 정책과 검증 결과
3. security, test, build, tarball, consumer install 결과
4. `npm publish --dry-run` 결과
5. 실제 publish를 실행하지 않았다는 사실
6. maintainer 수동 publish 전 확인할 항목

현재 계획 문서 브랜치와 구현 브랜치는 분리한다. 이 계획이 `main`에 반영된 뒤 구현을 시작할 때 `codex/alpha-release-candidate` 브랜치를 새로 만든다.

---

## publish 차단 조건

다음 중 하나라도 해당하면 release candidate PR을 ready 또는 merge 상태로 전환하지 않는다.

1. fixture가 `type: "none"`이 아니거나 version diff에 포함된다.
2. core와 plugin-vite가 정확히 `0.1.0-alpha.0`이 아니다.
3. changelog에 XHR 변경이 누락되거나 중복된다.
4. lockfile에서 의도하지 않은 dependency resolution 또는 integrity 변경이 발생한다.
5. moderate 이상 audit advisory가 있다.
6. npm scope 권한이나 package owner를 확인하지 못했다.
7. peer dependency 오류가 있다.
8. unit, E2E, build, docs 중 하나라도 실패한다.
9. tarball에 source/test 파일이 들어간다.
10. 배포 manifest에 `workspace:*`가 남는다.
11. 격리된 소비자 설치나 공개 export import가 실패한다.
12. `npm publish --dry-run`이 실패한다.
13. GitHub Actions나 repository 설정에 publish 권한이 추가된다.

---

## 후보 병합 이후

실제 publish는 이 계획의 자동 실행 범위가 아니다. maintainer가 직접 publish를 완료하면 별도 작업에서 다음을 수행한다.

1. npm registry에서 두 package의 version과 dist-tag를 확인한다.
2. 새 소비자 프로젝트에서 registry 설치를 검증한다.
3. README의 "배포 후" 표현을 실제 설치 명령으로 바꾼다.
4. GitHub release와 tag 정책을 확정한다.
5. Phase 2의 수명주기·신뢰도·인과관계 이벤트 모델 설계를 시작한다.
