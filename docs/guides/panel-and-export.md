---
outline: deep
---

# 패널과 내보내기

DevTools panel은 브라우저에서 관찰한 실시간 연결과 메시지를 한 화면에서 탐색하는
도구다.

## 패널 열기

화면의 **BSE** 버튼을 누르거나 기본 단축키를 사용한다.

- macOS: `Cmd+Shift+R`
- Windows와 Linux: `Ctrl+Shift+R`

패널을 닫아도 interceptor와 기록 저장소는 유지된다. 다시 열면 현재 저장된
connection과 message를 이어서 볼 수 있다.

## 연결과 타임라인 탐색

왼쪽 connection 목록에서 항목을 선택하면 해당 연결의 메시지만 timeline에
표시된다. 전체 항목을 선택하면 모든 연결을 시간순으로 볼 수 있다.

timeline에서는 다음 정보를 확인할 수 있다.

- transport 종류와 연결 상태
- 메시지의 incoming 또는 outgoing 방향
- 메시지가 기록된 시각과 크기
- 텍스트, JSON, binary metadata 등 정규화된 payload

메시지를 선택하면 상세 영역에서 전체 payload와 metadata를 확인할 수 있다.

## 검색과 방향 필터

검색어는 현재 timeline의 메시지 내용과 metadata에 적용된다. 방향 필터로 전체,
incoming, outgoing 중 하나를 선택할 수 있다.

connection 선택, 검색어, 방향 필터는 함께 적용된다. 내보내기도 화면에 표시된
결과와 같은 조건을 사용한다.

## JSONL과 log 내보내기

패널의 export 메뉴에서 형식을 선택하면 `bse-export` CustomEvent가 패널 host에
발생한다.

| 형식  | 용도                                                  |
| ----- | ----------------------------------------------------- |
| JSONL | 메시지 한 건을 JSON 한 줄로 표현하는 후속 처리용 형식 |
| log   | 사람이 읽기 쉬운 텍스트 기록                          |

현재 패널은 파일을 자동으로 다운로드하지 않는다. 애플리케이션이 이벤트를
수신해 저장, 업로드, 복사 같은 동작을 결정한다.

```ts
const panel = document.querySelector("bse-devtools-panel");

panel?.addEventListener("bse-export", (event) => {
  if (!(event instanceof CustomEvent)) {
    return;
  }

  const { content, format } = event.detail;
  console.log(format, content);
});
```

이 이벤트는 bubble되지 않고 Shadow DOM 경계를 통과하지 않는다. 따라서
`document`가 아니라 `bse-devtools-panel` host에 listener를 등록해야 한다.
패널이 mount되기 전에 listener를 연결해야 한다면 `MutationObserver` 등으로 host
생성을 기다린다.

## 정적 예제 확인

[DevTools panel 예제](../examples/devtools-panel.md)에서 패널 조작과 export 결과를
바로 확인할 수 있다. 이 예제는 GitHub Pages에서도 동작하도록 데이터를 미리
주입한다. 실제 transport 연결, native API 보존, interceptor 동작은 브라우저
fixture와 E2E test에서 별도로 검증한다.
