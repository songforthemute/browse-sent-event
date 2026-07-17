import { css, type CSSResult } from "lit";

export const devtoolsPanelStyles: CSSResult = css`
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
