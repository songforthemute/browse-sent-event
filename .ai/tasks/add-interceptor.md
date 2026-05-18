# 인터셉터 추가 태스크

1. 해당 프로토콜이 현재 phase 범위에 포함되는지 확인한다.
2. `packages/core/src/interceptors/` 아래에 구현을 추가한다.
3. engine boundary를 통해 메시지를 기록한다.
4. 프로토콜 동작에 대한 Vitest coverage를 추가한다.
5. 실제 브라우저 동작이 필요하면 Playwright coverage를 추가한다.
6. README와 guide docs를 업데이트한다.
