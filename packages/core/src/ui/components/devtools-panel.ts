import {
  css,
  html,
  LitElement,
  type CSSResult,
  type PropertyDeclarations,
  type TemplateResult,
} from "lit";
import type {
  BrowseSentEventEngine,
  BrowseSentEventEngineSnapshot,
  BrowseSentEventUnsubscribe,
} from "../../runtime/engine.js";
import { getPanelViewModel } from "../view-model.js";

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
      grid-template-rows: auto 1fr;
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
      overflow: auto;
    }

    .connection {
      display: grid;
      grid-template-columns: 88px minmax(0, 1fr) 72px 44px;
      width: 100%;
      gap: 8px;
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

    .connection[aria-pressed="true"] {
      background: #172554;
    }

    .connection span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
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
    engine: { attribute: false },
    open: { type: Boolean, reflect: true },
    selectedConnectionId: { attribute: false },
    snapshot: { attribute: false },
  };

  declare engine?: BrowseSentEventEngine;
  declare open: boolean;
  declare selectedConnectionId?: string;
  declare snapshot?: BrowseSentEventEngineSnapshot;

  #unsubscribe?: BrowseSentEventUnsubscribe;

  constructor() {
    super();
    this.open = false;
    this.selectedConnectionId = undefined;
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
          selectedConnectionId: this.selectedConnectionId,
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
                      }}
                    >
                      <span>${connection.protocol}</span>
                      <span>${connection.label}</span>
                      <span>${connection.state}</span>
                      <span>${connection.messageCount}</span>
                    </button>
                  `,
                )
              : html`<p class="empty">Waiting for realtime connections...</p>`}
          </section>
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

  #open(): void {
    this.setOpen(true);
  }

  #close(): void {
    this.setOpen(false);
  }
}
