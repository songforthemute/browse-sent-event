# Phase 1 범위

범위에 포함:

- WebSocket 인터셉트
- fetch ReadableStream 인터셉트
- EventSource 인터셉트
- Shadow DOM 플로팅 패널
- 연결 목록, 메시지 타임라인, 메트릭
- 링 버퍼 스토리지
- 단순 텍스트 검색과 구조적 필터
- JSONL 및 log export
- Vite plugin injection
- 프로덕션 no-op 검증

범위에서 제외:

- React/Vue causality
- Zustand/Pinia middleware
- DOM overlay
- Message lifecycle detection
- postMessage 인터셉트
- Dev server JSON API
- webpack/Rspack/Next/Nuxt
- IndexedDB cold storage
- Schema inference
