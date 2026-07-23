export type BrowseSentEventProtocol = "websocket" | "fetch-stream" | "eventsource" | "xhr";
export type BrowseSentEventDirection = "in" | "out";
export type BrowseSentEventConnectionState = "connecting" | "open" | "closing" | "closed";
export type BrowseSentEventPayload = string | ArrayBuffer;

export interface BrowseSentEventMessage {
  readonly id: string;
  readonly connectionId: string;
  readonly timestamp: number;
  readonly direction: BrowseSentEventDirection;
  readonly protocol: BrowseSentEventProtocol;
  readonly type?: string;
  readonly size: number;
  readonly payload: BrowseSentEventPayload;
  readonly payloadPreview: string;
  readonly metadata: Record<string, unknown>;
}

export interface BrowseSentEventConnection {
  readonly id: string;
  readonly protocol: BrowseSentEventProtocol;
  readonly url: string;
  readonly state: BrowseSentEventConnectionState;
  readonly openedAt: number;
  readonly closedAt?: number;
  readonly closeCode?: number;
  readonly reconnectCount: number;
  readonly metadata: Record<string, unknown>;
}

export interface BrowseSentEventMessageFilter {
  readonly connectionId?: string;
  readonly protocol?: BrowseSentEventProtocol;
  readonly direction?: BrowseSentEventDirection;
  readonly urlIncludes?: string;
  readonly fromTimestamp?: number;
  readonly toTimestamp?: number;
}

export interface BrowseSentEventSearchQuery extends BrowseSentEventMessageFilter {
  readonly text?: string;
}

export interface BrowseSentEventMetrics {
  readonly activeConnectionCount: number;
  readonly connectionCount: number;
  readonly messageCount: number;
  readonly incomingCount: number;
  readonly outgoingCount: number;
  readonly droppedMessageCount: number;
  readonly totalBytes: number;
}
