<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import {
  createBrowseSentEventRuntime,
  mountDevtoolsPanel,
  resolveOptions,
  type BrowseSentEventConnection,
  type BrowseSentEventEngineSnapshot,
  type BrowseSentEventProtocol,
  type BrowseSentEventRuntime,
  type BrowseSentEventUnsubscribe,
  type MountedDevtoolsPanel,
} from "@browse-sent-event/core";

interface DemoSample {
  readonly label: string;
  readonly protocol: BrowseSentEventProtocol;
  readonly url: string;
  readonly messages: readonly {
    readonly direction: "in" | "out";
    readonly type: string;
    readonly payload: string;
  }[];
  readonly closeCode?: number;
}

const samples: readonly DemoSample[] = [
  {
    label: "WebSocket",
    protocol: "websocket",
    url: "wss://demo.browse-sent-event.dev/realtime",
    messages: [
      {
        direction: "out",
        type: "subscribe",
        payload: JSON.stringify({ channel: "orders", since: "now" }),
      },
      {
        direction: "in",
        type: "message",
        payload: JSON.stringify({ id: "ord_1024", status: "paid", total: 42_000 }),
      },
    ],
  },
  {
    label: "Fetch stream",
    protocol: "fetch-stream",
    url: "https://demo.browse-sent-event.dev/api/chat-stream",
    messages: [
      {
        direction: "out",
        type: "request",
        payload: JSON.stringify({ prompt: "Summarize today's incident timeline." }),
      },
      {
        direction: "in",
        type: "chunk",
        payload: "data: The first reconnect happened after 1.2 seconds.\n\n",
      },
      {
        direction: "in",
        type: "chunk",
        payload: "data: The stream recovered without dropping client state.\n\n",
      },
    ],
    closeCode: 200,
  },
  {
    label: "EventSource",
    protocol: "eventsource",
    url: "https://demo.browse-sent-event.dev/events/notifications",
    messages: [
      {
        direction: "in",
        type: "notification",
        payload: JSON.stringify({ severity: "info", message: "Deploy started" }),
      },
      {
        direction: "in",
        type: "notification",
        payload: JSON.stringify({ severity: "success", message: "Deploy finished" }),
      },
    ],
  },
] as const;

const runtime = ref<BrowseSentEventRuntime>();
const mountedPanel = ref<MountedDevtoolsPanel>();
const snapshot = ref<BrowseSentEventEngineSnapshot>();
const exportText = ref("");
const errorMessage = ref("");
let unsubscribe: BrowseSentEventUnsubscribe | undefined;

const metrics = computed(() => snapshot.value?.metrics);
const latestConnection = computed(() => {
  const connections = snapshot.value?.connections ?? [];

  return connections.at(-1);
});

function getNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function getRuntime(): BrowseSentEventRuntime | undefined {
  if (runtime.value) {
    return runtime.value;
  }

  errorMessage.value = "브라우저 런타임이 아직 준비되지 않았습니다.";

  return undefined;
}

function openPanel(): void {
  const panelElement = mountedPanel.value?.element;
  const setOpen = panelElement ? Reflect.get(panelElement, "setOpen") : undefined;

  if (typeof setOpen === "function") {
    setOpen.call(panelElement, true);
  }
}

function seedSample(sample: DemoSample): void {
  const currentRuntime = getRuntime();

  if (!currentRuntime) {
    return;
  }

  const startedAt = getNow();
  const connection: BrowseSentEventConnection = currentRuntime.engine.recordConnection({
    protocol: sample.protocol,
    url: sample.url,
    state: "open",
    openedAt: startedAt,
    metadata: {
      source: "docs-demo",
      label: sample.label,
    },
  });

  sample.messages.forEach((message, index) => {
    currentRuntime.engine.recordMessage({
      connectionId: connection.id,
      direction: message.direction,
      protocol: sample.protocol,
      type: message.type,
      payload: message.payload,
      timestamp: startedAt + index + 1,
      metadata: {
        source: "docs-demo",
        sample: sample.label,
      },
    });
  });

  if (sample.closeCode !== undefined) {
    currentRuntime.engine.updateConnection(connection.id, {
      state: "closed",
      closedAt: startedAt + sample.messages.length + 1,
      closeCode: sample.closeCode,
    });
  }

  exportText.value = "";
  errorMessage.value = "";
  openPanel();
}

function clearTimeline(): void {
  const currentRuntime = getRuntime();

  if (!currentRuntime) {
    return;
  }

  currentRuntime.engine.clear();
  exportText.value = "";
  errorMessage.value = "";
}

function exportJsonl(): void {
  const currentRuntime = getRuntime();

  if (!currentRuntime) {
    return;
  }

  exportText.value = currentRuntime.engine.exportJsonl();
  errorMessage.value = exportText.value ? "" : "내보낼 메시지가 없습니다.";
  openPanel();
}

onMounted(() => {
  const target = globalThis.window;

  if (!target) {
    return;
  }

  const resolvedOptions = resolveOptions({
    capacity: 200,
    panel: {
      autoOpen: true,
      position: "bottom-right",
    },
  });
  const currentRuntime = createBrowseSentEventRuntime({ capacity: 200 });

  runtime.value = currentRuntime;
  snapshot.value = currentRuntime.engine.getSnapshot();
  unsubscribe = currentRuntime.engine.subscribe((nextSnapshot) => {
    snapshot.value = nextSnapshot;
  });
  mountedPanel.value = mountDevtoolsPanel({
    engine: currentRuntime.engine,
    options: resolvedOptions.panel,
    target,
  });
});

onUnmounted(() => {
  unsubscribe?.();
  mountedPanel.value?.unmount();
  runtime.value?.uninstall();
});
</script>

<template>
  <section class="demo-shell" aria-labelledby="bse-demo-title">
    <div class="demo-heading">
      <p class="demo-kicker">Static docs demo</p>
      <h2 id="bse-demo-title">샘플 이벤트로 DevTools 패널 열기</h2>
      <p>
        버튼을 누르면 WebSocket, fetch stream, EventSource 흐름이 문서 안의 런타임에 기록된다.
        오른쪽 아래 패널에서 연결, 메시지, 메트릭, export 동작을 바로 확인할 수 있다.
      </p>
    </div>

    <div class="demo-actions" aria-label="샘플 이벤트 생성">
      <button
        v-for="sample in samples"
        :key="sample.protocol"
        class="sample-button"
        type="button"
        @click="seedSample(sample)"
      >
        {{ sample.label }}
      </button>
      <button class="secondary-button" type="button" @click="openPanel">패널 열기</button>
      <button class="secondary-button" type="button" @click="exportJsonl">JSONL 보기</button>
      <button class="ghost-button" type="button" @click="clearTimeline">비우기</button>
    </div>

    <dl class="demo-metrics" aria-label="현재 샘플 메트릭">
      <div>
        <dt>Connections</dt>
        <dd>{{ metrics?.connectionCount ?? 0 }}</dd>
      </div>
      <div>
        <dt>Messages</dt>
        <dd>{{ metrics?.messageCount ?? 0 }}</dd>
      </div>
      <div>
        <dt>Incoming</dt>
        <dd>{{ metrics?.incomingCount ?? 0 }}</dd>
      </div>
      <div>
        <dt>Outgoing</dt>
        <dd>{{ metrics?.outgoingCount ?? 0 }}</dd>
      </div>
    </dl>

    <p v-if="latestConnection" class="latest-line">
      최근 연결:
      <strong>{{ latestConnection.protocol }}</strong>
      <span>{{ latestConnection.url }}</span>
    </p>

    <p v-if="errorMessage" class="demo-status" role="status">{{ errorMessage }}</p>

    <div v-if="exportText" class="export-box">
      <label for="bse-demo-export">JSONL export</label>
      <textarea id="bse-demo-export" readonly :value="exportText" rows="8" />
    </div>
  </section>
</template>

<style scoped>
.demo-shell {
  --demo-border: rgba(62, 83, 103, 0.22);
  --demo-ink: #18212c;
  --demo-muted: #526173;
  --demo-panel: #f7fafc;
  --demo-action: #0f766e;
  --demo-action-strong: #115e59;
  --demo-accent: #b45309;

  margin: 28px 0;
  padding: 24px;
  border: 1px solid var(--demo-border);
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(15, 118, 110, 0.08), transparent 34%),
    linear-gradient(180deg, #ffffff, var(--demo-panel));
  color: var(--demo-ink);
}

.demo-heading {
  max-width: 760px;
}

.demo-kicker {
  margin: 0 0 8px;
  color: var(--demo-accent);
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}

.demo-heading h2 {
  margin: 0;
  color: var(--demo-ink);
  font-size: 1.55rem;
  line-height: 1.25;
}

.demo-heading p:not(.demo-kicker) {
  margin: 12px 0 0;
  color: var(--demo-muted);
  line-height: 1.7;
}

.demo-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 22px 0;
}

.demo-actions button {
  min-height: 40px;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 0 14px;
  font: inherit;
  font-size: 0.9rem;
  font-weight: 700;
  letter-spacing: 0;
  cursor: pointer;
  transition:
    background-color 120ms ease,
    border-color 120ms ease,
    color 120ms ease,
    transform 120ms ease;
}

.demo-actions button:hover {
  transform: translateY(-1px);
}

.sample-button {
  background: var(--demo-action);
  color: #ffffff;
}

.sample-button:hover {
  background: var(--demo-action-strong);
}

.secondary-button {
  border-color: rgba(15, 118, 110, 0.28) !important;
  background: #ffffff;
  color: var(--demo-action-strong);
}

.secondary-button:hover {
  border-color: rgba(15, 118, 110, 0.48) !important;
  background: rgba(15, 118, 110, 0.08);
}

.ghost-button {
  border-color: rgba(82, 97, 115, 0.25) !important;
  background: transparent;
  color: var(--demo-muted);
}

.ghost-button:hover {
  background: rgba(82, 97, 115, 0.08);
  color: var(--demo-ink);
}

.demo-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
}

.demo-metrics div {
  min-width: 0;
  border: 1px solid var(--demo-border);
  border-radius: 8px;
  padding: 14px;
  background: rgba(255, 255, 255, 0.72);
}

.demo-metrics dt {
  color: var(--demo-muted);
  font-size: 0.76rem;
  font-weight: 700;
}

.demo-metrics dd {
  margin: 4px 0 0;
  color: var(--demo-ink);
  font-size: 1.35rem;
  font-weight: 800;
  line-height: 1.1;
}

.latest-line {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 18px 0 0;
  color: var(--demo-muted);
  font-size: 0.9rem;
}

.latest-line strong {
  color: var(--demo-action-strong);
}

.latest-line span {
  overflow-wrap: anywhere;
}

.demo-status {
  margin: 18px 0 0;
  color: var(--demo-accent);
  font-weight: 700;
}

.export-box {
  margin-top: 20px;
}

.export-box label {
  display: block;
  margin-bottom: 8px;
  color: var(--demo-muted);
  font-size: 0.82rem;
  font-weight: 700;
}

.export-box textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 168px;
  border: 1px solid var(--demo-border);
  border-radius: 8px;
  padding: 12px;
  background: #0e1621;
  color: #d7f7ef;
  font:
    0.82rem/1.6 ui-monospace,
    SFMono-Regular,
    Menlo,
    Monaco,
    Consolas,
    "Liberation Mono",
    monospace;
  resize: vertical;
}

@media (max-width: 720px) {
  .demo-shell {
    padding: 18px;
  }

  .demo-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .demo-actions button {
    flex: 1 1 150px;
  }
}
</style>
