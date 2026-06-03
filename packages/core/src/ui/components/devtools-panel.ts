import {
  css,
  html,
  LitElement,
  type CSSResult,
  type PropertyDeclarations,
  type TemplateResult,
} from "lit";
import type {
  BrowseSentEventDirection,
  BrowseSentEventSearchQuery,
} from "../../runtime/events.js";
import type {
  BrowseSentEventEngine,
  BrowseSentEventEngineSnapshot,
  BrowseSentEventUnsubscribe,
} from "../../runtime/engine.js";
import { getPanelViewModel } from "../view-model.js";

type BrowseSentEventExportFormat = "jsonl" | "log";

export class BrowseSentEventDevtoolsPanelElement extends LitElement {
  static override shadowRootOptions: ShadowRootInit = {
    ...LitElement.shadowRootOptions,
    mode: "closed",
  };

  static override styles: CSSResult = css`
    :host {
      all: initial;
      position: fixed;
      z-index: 2147483647;
      font-family:
        ui-sans-serif,
        system-ui,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;
      color: #f8fafc;
    }

    :host([data-position="bottom-right"]) {
      right: 16px;
      bottom: 16px;
    }

    :host([data-position="bottom-left"]) {
      left: 16px;
      bottom: 16px;
    }

    :host([data-position="top-right"]) {
      top: 16px;
      right: 16px;
    }

    :host([data-position="top-left"]) {
      top: 16px;
      left: 16px;
    }

    .panel {
      width: 520px;
      max-width: calc(100vw - 32px);
      height: 420px;
      max-height: calc(100vh - 32px);
      border: 1px solid #334155;
      border-radius: 8px;
      background: #0f172a;
      box-shadow: 0 18px 56px rgb(15 23 42 / 35%);
      overflow: hidden;
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 40px;
      padding: 0 12px;
      border-bottom: 1px solid #1e293b;
      font-size: 12px;
    }

    .header button {
      border: 1px solid #334155;
      border-radius: 6px;
      background: #111827;
      color: #cbd5e1;
      cursor: pointer;
      font: inherit;
    }

    .layout {
      display: grid;
      grid-template-rows: auto auto 1fr;
      height: calc(100% - 40px);
      min-height: 0;
    }

    .metrics {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 1px;
      border-bottom: 1px solid #1e293b;
      background: #1e293b;
    }

    .metric {
      padding: 10px 12px;
      background: #111827;
    }

    .toolbar {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      gap: 8px;
      align-items: center;
      padding: 8px;
      border-bottom: 1px solid #1e293b;
      background: #020617;
    }

    .search {
      min-width: 0;
      height: 28px;
      box-sizing: border-box;
      border: 1px solid #334155;
      border-radius: 6px;
      background: #0f172a;
      color: #e2e8f0;
      font: inherit;
      font-size: 12px;
      outline: none;
      padding: 0 8px;
    }

    .control-group {
      display: inline-flex;
      gap: 1px;
      overflow: hidden;
      border: 1px solid #334155;
      border-radius: 6px;
      background: #334155;
    }

    .control-group button {
      height: 26px;
      border: 0;
      background: #111827;
      color: #cbd5e1;
      cursor: pointer;
      font: inherit;
      font-size: 11px;
      padding: 0 8px;
    }

    .control-group button[aria-pressed="true"] {
      background: #1d4ed8;
      color: #f8fafc;
    }

    .content {
      display: grid;
      grid-template-columns: 168px minmax(0, 1fr) 152px;
      min-height: 0;
    }

    .metric strong {
      display: block;
      font-size: 16px;
      line-height: 1.2;
    }

    .metric span {
      display: block;
      margin-top: 2px;
      color: #94a3b8;
      font-size: 11px;
    }

    .connections {
      min-height: 0;
      border-right: 1px solid #1e293b;
      overflow: auto;
    }

    .connection {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 32px;
      width: 100%;
      gap: 6px;
      align-items: center;
      padding: 10px 12px;
      border: 0;
      border-bottom: 1px solid #1e293b;
      background: #0f172a;
      color: #e2e8f0;
      cursor: pointer;
      font: inherit;
      text-align: left;
    }

    .connection small {
      grid-column: 1 / -1;
      color: #94a3b8;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .connection[aria-pressed="true"] {
      background: #172554;
    }

    .connection span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .timeline {
      min-height: 0;
      border-right: 1px solid #1e293b;
      overflow: auto;
    }

    .message {
      display: grid;
      grid-template-columns: 34px 76px minmax(0, 1fr) 52px;
      width: 100%;
      gap: 6px;
      align-items: center;
      padding: 9px 10px;
      border: 0;
      border-bottom: 1px solid #1e293b;
      background: #0f172a;
      color: #e2e8f0;
      cursor: pointer;
      font: inherit;
      font-size: 11px;
      text-align: left;
    }

    .message[aria-pressed="true"] {
      background: #1e293b;
    }

    .message[data-direction="out"] {
      color: #bfdbfe;
    }

    .message span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .message-preview {
      grid-column: 1 / -1;
      color: #94a3b8;
    }

    .detail {
      min-width: 0;
      padding: 12px;
      overflow: auto;
      background: #111827;
    }

    .detail dl {
      display: grid;
      grid-template-columns: 56px minmax(0, 1fr);
      gap: 8px;
      margin: 0;
      font-size: 11px;
    }

    .detail dt {
      color: #94a3b8;
    }

    .detail dd {
      min-width: 0;
      margin: 0;
      overflow-wrap: anywhere;
    }

    .payload {
      grid-column: 1 / -1;
      margin: 4px 0 0;
      padding: 8px;
      border: 1px solid #334155;
      border-radius: 6px;
      background: #020617;
      color: #e2e8f0;
      font-family:
        ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      white-space: pre-wrap;
    }

    .empty {
      padding: 16px 12px;
      color: #94a3b8;
      font-size: 12px;
    }

    .toggle {
      width: 44px;
      height: 44px;
      border: 1px solid #334155;
      border-radius: 999px;
      background: #0f172a;
      color: #f8fafc;
      cursor: pointer;
    }
  `;

  static override properties: PropertyDeclarations = {
    direction: { attribute: false },
    engine: { attribute: false },
    open: { type: Boolean, reflect: true },
    query: { attribute: false },
    selectedConnectionId: { attribute: false },
    selectedMessageId: { attribute: false },
    snapshot: { attribute: false },
  };

  declare direction?: BrowseSentEventDirection;
  declare engine?: BrowseSentEventEngine;
  declare open: boolean;
  declare query: string;
  declare selectedConnectionId?: string;
  declare selectedMessageId?: string;
  declare snapshot?: BrowseSentEventEngineSnapshot;

  #unsubscribe?: BrowseSentEventUnsubscribe;

  constructor() {
    super();
    this.direction = undefined;
    this.open = false;
    this.query = "";
    this.selectedConnectionId = undefined;
    this.selectedMessageId = undefined;
    this.snapshot = undefined;
  }

  override connectedCallback(): void {
    super.connectedCallback();

    if (!this.engine || this.#unsubscribe) {
      return;
    }

    this.snapshot = this.engine.getSnapshot();
    this.#unsubscribe = this.engine.subscribe((snapshot) => {
      this.snapshot = snapshot;
    });
  }

  override disconnectedCallback(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    super.disconnectedCallback();
  }

  override render(): TemplateResult {
    if (!this.open) {
      return html`<button class="toggle" type="button" @click=${() => this.#open()}>BSE</button>`;
    }

    const model = this.snapshot
      ? getPanelViewModel(this.snapshot, {
          direction: this.direction,
          query: this.query,
          selectedConnectionId: this.selectedConnectionId,
          selectedMessageId: this.selectedMessageId,
        })
      : undefined;

    return html`
      <section class="panel" aria-label="browse-sent-event DevTools">
        <header class="header">
          <strong>browse-sent-event</strong>
          <button type="button" @click=${() => this.#close()}>Close</button>
        </header>
        <main class="layout">
          <section class="metrics" aria-label="Metrics">
            <div class="metric">
              <strong>${model?.activeConnectionCount ?? 0}</strong>
              <span>active</span>
            </div>
            <div class="metric">
              <strong>${model?.totalMessageCount ?? 0}</strong>
              <span>messages</span>
            </div>
            <div class="metric">
              <strong>${model?.totalBytesLabel ?? "0 B"}</strong>
              <span>payload</span>
            </div>
          </section>
          <section class="toolbar" aria-label="Timeline controls">
            <input
              class="search"
              type="search"
              .value=${this.query}
              aria-label="Search payload"
              placeholder="Search payload"
              @input=${(event: Event) => {
                if (event.target instanceof globalThis.HTMLInputElement) {
                  this.setQuery(event.target.value);
                }
              }}
            />
            <div class="control-group" aria-label="Direction filter">
              <button
                type="button"
                ?aria-pressed=${this.direction === undefined}
                @click=${() => this.setDirection(undefined)}
              >
                All
              </button>
              <button
                type="button"
                ?aria-pressed=${this.direction === "in"}
                @click=${() => this.setDirection("in")}
              >
                In
              </button>
              <button
                type="button"
                ?aria-pressed=${this.direction === "out"}
                @click=${() => this.setDirection("out")}
              >
                Out
              </button>
            </div>
            <div class="control-group" aria-label="Export controls">
              <button type="button" @click=${() => this.requestExport("jsonl")}>JSONL</button>
              <button type="button" @click=${() => this.requestExport("log")}>Log</button>
            </div>
          </section>
          <div class="content">
            <section class="connections" aria-label="Connections">
              ${model && model.connections.length > 0
                ? model.connections.map(
                    (connection) => html`
                      <button
                        class="connection"
                        type="button"
                        ?aria-pressed=${connection.selected}
                        @click=${() => {
                          this.selectedConnectionId = connection.id;
                          this.selectedMessageId = undefined;
                        }}
                      >
                        <span>${connection.protocol}</span>
                        <span>${connection.messageCount}</span>
                        <small>${connection.label}</small>
                        <small>${connection.state}</small>
                      </button>
                    `,
                  )
                : html`<p class="empty">No connections yet.</p>`}
            </section>
            <section class="timeline" aria-label="Messages">
              ${model && model.messages.length > 0
                ? model.messages.map(
                    (message) => html`
                      <button
                        class="message"
                        type="button"
                        data-direction=${message.direction}
                        ?aria-pressed=${message.id === this.selectedMessageId}
                        @click=${() => {
                          this.selectedMessageId = message.id;
                        }}
                      >
                        <span>${message.directionLabel}</span>
                        <span>${message.timestampLabel}</span>
                        <span>${message.typeLabel}</span>
                        <span>${message.sizeLabel}</span>
                        <span class="message-preview">${message.payloadPreview}</span>
                      </button>
                    `,
                  )
                : html`<p class="empty">No messages yet.</p>`}
            </section>
            <aside class="detail" aria-label="Message detail">
              ${model?.selectedMessage
                ? html`
                    <dl>
                      <dt>dir</dt>
                      <dd>${model.selectedMessage.directionLabel}</dd>
                      <dt>proto</dt>
                      <dd>${model.selectedMessage.protocol}</dd>
                      <dt>type</dt>
                      <dd>${model.selectedMessage.typeLabel}</dd>
                      <dt>size</dt>
                      <dd>${model.selectedMessage.sizeLabel}</dd>
                      <dt>payload</dt>
                      <dd class="payload">${model.selectedMessage.payloadPreview}</dd>
                    </dl>
                  `
                : html`<p class="empty">No selection.</p>`}
            </aside>
          </div>
        </main>
      </section>
    `;
  }

  setOpen(open: boolean): void {
    this.open = open;

    if (open) {
      this.setAttribute("open", "");
    } else {
      this.removeAttribute("open");
    }
  }

  setQuery(query: string): void {
    this.query = query;
    this.selectedMessageId = undefined;
  }

  setDirection(direction: BrowseSentEventDirection | undefined): void {
    this.direction = direction;
    this.selectedMessageId = undefined;
  }

  requestExport(format: BrowseSentEventExportFormat): void {
    if (!this.engine) {
      return;
    }

    const query: BrowseSentEventSearchQuery = {
      connectionId: this.selectedConnectionId,
      direction: this.direction,
      text: this.query || undefined,
    };
    const content =
      format === "jsonl" ? this.engine.exportJsonl(query) : this.engine.exportLog(query);

    this.dispatchEvent(
      new globalThis.CustomEvent("bse-export", {
        bubbles: false,
        composed: false,
        detail: {
          content,
          format,
        },
      }),
    );
  }

  #open(): void {
    this.setOpen(true);
  }

  #close(): void {
    this.setOpen(false);
  }
}
