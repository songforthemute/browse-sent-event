import {
  html,
  LitElement,
  type CSSResult,
  type PropertyDeclarations,
  type TemplateResult,
} from "lit";
import type { BrowseSentEventDirection, BrowseSentEventSearchQuery } from "../../runtime/events.js";
import type {
  BrowseSentEventEngine,
  BrowseSentEventEngineSnapshot,
  BrowseSentEventUnsubscribe,
} from "../../runtime/engine.js";
import {
  getPanelViewModel,
  type BrowseSentEventConnectionViewModel,
  type BrowseSentEventMessageViewModel,
  type BrowseSentEventPanelViewModel,
} from "../view-model.js";
import { devtoolsPanelStyles } from "./devtools-panel.styles.js";

type BrowseSentEventExportFormat = "jsonl" | "log";

export class BrowseSentEventDevtoolsPanelElement extends LitElement {
  static override shadowRootOptions: ShadowRootInit = {
    ...LitElement.shadowRootOptions,
    mode: "closed",
  };

  static override styles: CSSResult = devtoolsPanelStyles;

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
      return this.#renderToggle();
    }

    const model = this.snapshot
      ? getPanelViewModel(this.snapshot, {
          direction: this.direction,
          query: this.query,
          selectedConnectionId: this.selectedConnectionId,
          selectedMessageId: this.selectedMessageId,
        })
      : undefined;

    return this.#renderPanel(model);
  }

  #renderToggle(): TemplateResult {
    return html`<button class="toggle" type="button" @click=${() => this.#open()}>BSE</button>`;
  }

  #renderPanel(model?: BrowseSentEventPanelViewModel): TemplateResult {
    return html`
      <section class="panel" aria-label="browse-sent-event DevTools">
        <header class="header">
          <strong>browse-sent-event</strong>
          <button type="button" @click=${() => this.#close()}>Close</button>
        </header>
        <main class="layout">
          ${this.#renderMetrics(model)} ${this.#renderToolbar()}
          <div class="content">
            ${this.#renderConnections(model)} ${this.#renderTimeline(model)}
            ${this.#renderDetail(model)}
          </div>
        </main>
      </section>
    `;
  }

  #renderMetrics(model?: BrowseSentEventPanelViewModel): TemplateResult {
    return html`
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
    `;
  }

  #renderToolbar(): TemplateResult {
    return html`
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
    `;
  }

  #renderConnections(model?: BrowseSentEventPanelViewModel): TemplateResult {
    return html`
      <section class="connections" aria-label="Connections">
        ${model && model.connections.length > 0
          ? model.connections.map((connection) => this.#renderConnection(connection))
          : html`<p class="empty">No connections yet.</p>`}
      </section>
    `;
  }

  #renderConnection(connection: BrowseSentEventConnectionViewModel): TemplateResult {
    return html`
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
    `;
  }

  #renderTimeline(model?: BrowseSentEventPanelViewModel): TemplateResult {
    return html`
      <section class="timeline" aria-label="Messages">
        ${model && model.messages.length > 0
          ? model.messages.map((message) => this.#renderMessage(message))
          : html`<p class="empty">No messages yet.</p>`}
      </section>
    `;
  }

  #renderMessage(message: BrowseSentEventMessageViewModel): TemplateResult {
    return html`
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
    `;
  }

  #renderDetail(model?: BrowseSentEventPanelViewModel): TemplateResult {
    return html`
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
