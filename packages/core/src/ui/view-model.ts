import type { BrowseSentEventDirection, BrowseSentEventMessage } from "../runtime/events.js";
import type { BrowseSentEventEngineSnapshot } from "../runtime/engine.js";
import { formatByteSize, formatTimestamp } from "./format.js";

export interface BrowseSentEventPanelState {
  readonly selectedConnectionId?: string;
  readonly query?: string;
  readonly direction?: BrowseSentEventDirection;
}

export interface BrowseSentEventConnectionViewModel {
  readonly id: string;
  readonly label: string;
  readonly protocol: string;
  readonly state: string;
  readonly messageCount: number;
}

export interface BrowseSentEventMessageViewModel {
  readonly id: string;
  readonly direction: BrowseSentEventDirection;
  readonly directionLabel: "IN" | "OUT";
  readonly timestampLabel: string;
  readonly protocol: string;
  readonly typeLabel: string;
  readonly sizeLabel: string;
  readonly payloadPreview: string;
}

export interface BrowseSentEventPanelViewModel {
  readonly connections: readonly BrowseSentEventConnectionViewModel[];
  readonly messages: readonly BrowseSentEventMessageViewModel[];
  readonly activeConnectionCount: number;
  readonly totalMessageCount: number;
  readonly totalBytesLabel: string;
}

function matchesState(message: BrowseSentEventMessage, state: BrowseSentEventPanelState): boolean {
  if (state.selectedConnectionId && message.connectionId !== state.selectedConnectionId) {
    return false;
  }

  if (state.direction && message.direction !== state.direction) {
    return false;
  }

  if (state.query && !message.payloadPreview.toLowerCase().includes(state.query.toLowerCase())) {
    return false;
  }

  return true;
}

export function getPanelViewModel(
  snapshot: BrowseSentEventEngineSnapshot,
  state: BrowseSentEventPanelState = {},
): BrowseSentEventPanelViewModel {
  return {
    activeConnectionCount: snapshot.metrics.activeConnectionCount,
    totalMessageCount: snapshot.metrics.messageCount,
    totalBytesLabel: formatByteSize(snapshot.metrics.totalBytes),
    connections: snapshot.connections.map((connection) => ({
      id: connection.id,
      label: connection.url,
      protocol: connection.protocol,
      state: connection.state,
      messageCount: snapshot.messages.filter((message) => message.connectionId === connection.id)
        .length,
    })),
    messages: snapshot.messages
      .filter((message) => matchesState(message, state))
      .toSorted((left, right) => right.timestamp - left.timestamp)
      .map((message) => ({
        id: message.id,
        direction: message.direction,
        directionLabel: message.direction === "in" ? "IN" : "OUT",
        timestampLabel: formatTimestamp(message.timestamp),
        protocol: message.protocol,
        typeLabel: message.type ?? "message",
        sizeLabel: formatByteSize(message.size),
        payloadPreview: message.payloadPreview,
      })),
  };
}
