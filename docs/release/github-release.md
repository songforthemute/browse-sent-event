---
outline: deep
---

# GitHub Release 가이드

Git tag와 GitHub Release는 npm에 공개한 package의 source identity와 사용자용
변경 기록을 남긴다. npm publish를 대신하지 않으며, registry 검증이 끝난 뒤 별도
단계로 수행한다.

## 현재 baseline

`2026-07-26 KST` 기준 npm package는 공개됐지만 Git tag와 GitHub Release는 아직
없다.

| package                          | npm version     | source commit | tag와 release |
| -------------------------------- | --------------- | ------------- | ------------- |
| `@browse-sent-event/core`        | `0.1.0-alpha.0` | `65bc938`     | 생성 필요     |
| `@browse-sent-event/plugin-vite` | `0.1.0-alpha.1` | `7efb1b3`     | 생성 필요     |

`@browse-sent-event/plugin-vite@0.1.0-alpha.0`은 잘못 배포된 deprecated
version이므로 정상 tag와 release를 만들지 않는다.

## 원칙

1. tag 형식은 `<package-name>@<exact-version>`이다.
2. tag는 npm tarball을 만든 source commit을 가리키며 이동시키지 않는다.
3. alpha GitHub Release는 prerelease로 표시하고 Latest release로 지정하지 않는다.
4. tag와 release 생성은 maintainer가 직접 승인하고 실행한다.
5. release note에는 설치 명령, package 역할, 알려진 제한과 검증 결과를 포함한다.

## 1. npm identity 재확인

```bash
npm view @browse-sent-event/core@0.1.0-alpha.0 version dist.integrity --json
npm view @browse-sent-event/plugin-vite@0.1.0-alpha.1 version dependencies dist.integrity --json
```

plugin-vite의 공개 dependency가
`"@browse-sent-event/core": "0.1.0-alpha.0"`인지 확인한다. `workspace:*`가
보이면 tag와 release 생성을 중단한다.

## 2. source commit 확인

tag를 만들기 전에 해당 commit의 package manifest가 npm version과 일치하는지
확인한다.

```bash
git show 65bc938:packages/core/package.json
git show 7efb1b3:packages/plugin-vite/package.json
```

후속 version에서는 release PR과 registry 기록으로 source commit을 새로
확정한다. 현재 baseline commit을 관성적으로 재사용하지 않는다.

## 3. annotated tag 생성과 push

```bash
git tag -a "@browse-sent-event/core@0.1.0-alpha.0" 65bc938 \
  -m "@browse-sent-event/core 0.1.0-alpha.0"
git tag -a "@browse-sent-event/plugin-vite@0.1.0-alpha.1" 7efb1b3 \
  -m "@browse-sent-event/plugin-vite 0.1.0-alpha.1"

git push origin "@browse-sent-event/core@0.1.0-alpha.0"
git push origin "@browse-sent-event/plugin-vite@0.1.0-alpha.1"
```

remote tag가 이미 있으면 새로 만들거나 강제로 덮어쓰지 않는다. commit과 version을
비교하고 불일치 원인을 먼저 조사한다.

## 4. draft prerelease 작성

release note를 검토할 수 있도록 먼저 draft로 만든다.

```bash
gh release create "@browse-sent-event/core@0.1.0-alpha.0" \
  --verify-tag \
  --draft \
  --prerelease \
  --latest=false \
  --title "@browse-sent-event/core 0.1.0-alpha.0"

gh release create "@browse-sent-event/plugin-vite@0.1.0-alpha.1" \
  --verify-tag \
  --draft \
  --prerelease \
  --latest=false \
  --title "@browse-sent-event/plugin-vite 0.1.0-alpha.1"
```

각 release note에는 최소 다음 내용을 적는다.

- `pnpm add -D <package>@alpha` 설치 명령
- package가 제공하는 기능
- Vite 개발 서버와 main thread라는 현재 범위
- custom hotkey, `excludeUrls`, plugin option 전달 등 알려진 alpha 제한
- build, test, tarball, registry smoke와 audit 결과
- plugin-vite alpha.0을 사용하지 말아야 한다는 경고

## 5. 검토 후 publish

GitHub UI 또는 다음 명령으로 draft를 확인한다.

```bash
gh release view "@browse-sent-event/core@0.1.0-alpha.0"
gh release view "@browse-sent-event/plugin-vite@0.1.0-alpha.1"
```

내용과 tag target이 맞으면 maintainer가 publish한다.

```bash
gh release edit "@browse-sent-event/core@0.1.0-alpha.0" --draft=false
gh release edit "@browse-sent-event/plugin-vite@0.1.0-alpha.1" --draft=false
```

publish 후 두 release가 prerelease이고 Latest가 아닌지 확인한다.

## 차단 조건

다음 중 하나라도 해당하면 tag 또는 release를 만들지 않는다.

- npm registry의 exact version과 source manifest가 다르다.
- plugin-vite dependency에 `workspace:*`가 남아 있다.
- tag가 이미 다른 commit을 가리킨다.
- npm publish 후 소비자 설치와 ESM import 검증을 통과하지 못했다.
- maintainer가 tag와 release 생성을 승인하지 않았다.
- deprecated된 문제 version에 정상 release identity를 부여하려 한다.

## 관련 문서

- [npm 배포 가이드](./npm-publish.md)
- [아키텍처 결정 기록 ADR-023](../browse-sent-event-adr.md#adr-023-공개-alpha-릴리스-identity와-수동-publish)
