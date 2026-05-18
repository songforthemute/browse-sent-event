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
    snapshot: { attribute: false },
  };

  declare engine?: BrowseSentEventEngine;
  declare open: boolean;
  declare snapshot?: BrowseSentEventEngineSnapshot;

  #unsubscribe?: BrowseSentEventUnsubscribe;

  constructor() {
    super();
    this.open = false;
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

    return html`
      <section class="panel" aria-label="browse-sent-event DevTools">
        <header>
          <strong>browse-sent-event</strong>
          <button type="button" @click=${() => this.#close()}>Close</button>
        </header>
        <main>Waiting for realtime messages...</main>
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
