import type { BrowseSentEventConnection, BrowseSentEventPayload } from "../runtime/events.js";
import type {
  BrowseSentEventInterceptorContext,
  InstalledBrowseSentEventInterceptor,
} from "./types.js";
import { isUrlExcluded } from "./types.js";
import { installGlobalPatch } from "./global-patch.js";

interface XmlHttpRequestDescriptor {
  readonly method: string;
  readonly url: string;
  readonly async: boolean;
  sent: boolean;
}

interface PendingXmlHttpRequestOpen {
  activated: boolean;
  readonly descriptor: XmlHttpRequestDescriptor | undefined;
}

interface ActiveXmlHttpRequest {
  readonly connection: BrowseSentEventConnection;
  doneCompletion?: XmlHttpRequestCompletion;
  finalized: boolean;
}

interface XmlHttpRequestCompletion {
  readonly contentType: string | null;
  readonly outcome: "abort" | "error" | "load" | "reopened" | "timeout" | "unknown";
  readonly payload?: BrowseSentEventPayload;
  readonly responseType: XMLHttpRequestResponseType;
  readonly responseURL: string;
  readonly status: number;
  readonly statusText: string;
}

interface BlobIntrinsics {
  readonly sizeGetter: unknown;
  readonly typeGetter: unknown;
}

interface ArrayBufferViewIntrinsics {
  readonly bufferGetter: unknown;
  readonly byteLengthGetter: unknown;
  readonly byteOffsetGetter: unknown;
}

interface XmlHttpRequestPayloadRuntime {
  readonly arrayBufferByteLengthGetters: readonly unknown[];
  readonly arrayBufferViewIntrinsics: readonly ArrayBufferViewIntrinsics[];
  readonly blobIntrinsics: readonly BlobIntrinsics[];
  readonly documentContentTypeGetters: readonly unknown[];
  readonly formDataEntriesMethods: readonly unknown[];
  readonly urlSearchParamsStringifiers: readonly unknown[];
}

function isInstrumentableXmlHttpRequest(value: unknown): value is XMLHttpRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "addEventListener" in value &&
    "open" in value &&
    "send" in value
  );
}

function now(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function observeSafely(callback: () => void): void {
  try {
    callback();
  } catch {
    // 관찰 실패가 애플리케이션의 XHR 이벤트 흐름을 중단하면 안 된다.
  }
}

function observeValue<T>(callback: () => T, fallback: T): T {
  try {
    return callback();
  } catch {
    return fallback;
  }
}

function getConstructorCandidates(target: Window, name: string): readonly unknown[] {
  return [Reflect.get(target, name), Reflect.get(globalThis, name)];
}

function getPrototype(Constructor: unknown): object | undefined {
  if (typeof Constructor !== "function") {
    return undefined;
  }

  const prototype: unknown = Reflect.get(Constructor, "prototype");

  return typeof prototype === "object" && prototype !== null ? prototype : undefined;
}

function getPrototypeMethod(Constructor: unknown, name: string): unknown {
  const prototype = getPrototype(Constructor);

  return prototype ? Reflect.get(prototype, name) : undefined;
}

function getPrototypeGetter(Constructor: unknown, name: string): unknown {
  let prototype = getPrototype(Constructor);

  while (prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);

    if (descriptor) {
      return Reflect.get(descriptor, "get");
    }

    prototype = Object.getPrototypeOf(prototype);
  }

  return undefined;
}

function getPropertyDescriptor(value: object, name: PropertyKey): PropertyDescriptor | undefined {
  let current: object | null = value;

  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, name);

    if (descriptor) {
      return descriptor;
    }

    current = Object.getPrototypeOf(current);
  }

  return undefined;
}

function isArrayBuffer(
  value: unknown,
  runtime: XmlHttpRequestPayloadRuntime,
): value is ArrayBuffer {
  return getArrayBufferByteLength(value, runtime) !== undefined;
}

function getArrayBufferByteLength(
  value: unknown,
  runtime: XmlHttpRequestPayloadRuntime,
): number | undefined {
  const result = callIntrinsic(runtime.arrayBufferByteLengthGetters, value);

  return result.ok && typeof result.value === "number" ? result.value : undefined;
}

interface IntrinsicResult {
  readonly ok: boolean;
  readonly value?: unknown;
}

function callIntrinsic(
  candidates: readonly unknown[],
  receiver: unknown,
  args: readonly unknown[] = [],
): IntrinsicResult {
  for (const candidate of candidates) {
    if (typeof candidate !== "function") {
      continue;
    }

    try {
      return {
        ok: true,
        value: Reflect.apply(candidate, receiver, args),
      };
    } catch {
      continue;
    }
  }

  return { ok: false };
}

function createPayloadRuntime(target: Window): XmlHttpRequestPayloadRuntime {
  const arrayBufferConstructors = getConstructorCandidates(target, "ArrayBuffer");
  const arrayBufferViewConstructors = [
    ...getConstructorCandidates(target, "Uint8Array"),
    ...getConstructorCandidates(target, "DataView"),
  ];
  const blobConstructors = getConstructorCandidates(target, "Blob");
  const documentConstructors = getConstructorCandidates(target, "Document");
  const formDataConstructors = getConstructorCandidates(target, "FormData");
  const urlSearchParamsConstructors = getConstructorCandidates(target, "URLSearchParams");

  return {
    arrayBufferByteLengthGetters: arrayBufferConstructors.map((Constructor) =>
      getPrototypeGetter(Constructor, "byteLength"),
    ),
    arrayBufferViewIntrinsics: arrayBufferViewConstructors.map((Constructor) => ({
      bufferGetter: getPrototypeGetter(Constructor, "buffer"),
      byteLengthGetter: getPrototypeGetter(Constructor, "byteLength"),
      byteOffsetGetter: getPrototypeGetter(Constructor, "byteOffset"),
    })),
    blobIntrinsics: blobConstructors.map((Constructor) => ({
      sizeGetter: getPrototypeGetter(Constructor, "size"),
      typeGetter: getPrototypeGetter(Constructor, "type"),
    })),
    documentContentTypeGetters: documentConstructors.map((Constructor) =>
      getPrototypeGetter(Constructor, "contentType"),
    ),
    formDataEntriesMethods: formDataConstructors.map((Constructor) =>
      getPrototypeMethod(Constructor, "entries"),
    ),
    urlSearchParamsStringifiers: urlSearchParamsConstructors.map((Constructor) =>
      getPrototypeMethod(Constructor, "toString"),
    ),
  };
}

function copyArrayBuffer(
  buffer: ArrayBufferLike,
  byteOffset: number,
  byteLength: number,
): ArrayBuffer {
  return Uint8Array.from(new Uint8Array(buffer, byteOffset, byteLength)).buffer;
}

function copyArrayBufferView(
  value: unknown,
  runtime: XmlHttpRequestPayloadRuntime,
): ArrayBuffer | undefined {
  for (const intrinsics of runtime.arrayBufferViewIntrinsics) {
    if (
      typeof intrinsics.bufferGetter !== "function" ||
      typeof intrinsics.byteLengthGetter !== "function" ||
      typeof intrinsics.byteOffsetGetter !== "function"
    ) {
      continue;
    }

    try {
      const buffer: unknown = Reflect.apply(intrinsics.bufferGetter, value, []);
      const byteLength: unknown = Reflect.apply(intrinsics.byteLengthGetter, value, []);
      const byteOffset: unknown = Reflect.apply(intrinsics.byteOffsetGetter, value, []);

      if (
        isArrayBuffer(buffer, runtime) &&
        typeof byteLength === "number" &&
        typeof byteOffset === "number"
      ) {
        return copyArrayBuffer(buffer, byteOffset, byteLength);
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

function getOwnDataProperty(value: unknown, name: PropertyKey): unknown {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return undefined;
  }

  const descriptor = Object.getOwnPropertyDescriptor(value, name);

  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function summarizeBlob(value: unknown, runtime: XmlHttpRequestPayloadRuntime): string | undefined {
  for (const intrinsics of runtime.blobIntrinsics) {
    try {
      const sizeResult = callIntrinsic([intrinsics.sizeGetter], value);
      const typeResult = callIntrinsic([intrinsics.typeGetter], value);

      if (!sizeResult.ok && !typeResult.ok) {
        continue;
      }

      const size = sizeResult.ok ? sizeResult.value : getOwnDataProperty(value, "size");
      const type = typeResult.ok ? typeResult.value : getOwnDataProperty(value, "type");

      if (typeof size === "number" && typeof type === "string") {
        const typeSummary = type ? ` type=${type}` : "";

        return `[Blob size=${size}${typeSummary}]`;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

function isIterable(value: unknown): value is Iterable<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    Symbol.iterator in value
  );
}

function summarizeFormData(
  value: unknown,
  runtime: XmlHttpRequestPayloadRuntime,
): string | undefined {
  const result = callIntrinsic(runtime.formDataEntriesMethods, value);

  if (!result.ok || !isIterable(result.value)) {
    return undefined;
  }

  const fields: string[] = [];

  try {
    for (const entry of result.value) {
      if (Array.isArray(entry) && typeof entry[0] === "string") {
        fields.push(entry[0].slice(0, 64));
      }

      if (fields.length === 20) {
        break;
      }
    }
  } catch {
    return undefined;
  }

  const sampled = fields.length === 20 ? "20+" : String(fields.length);

  return `[FormData sampled=${sampled} fields=${fields.join(",")}]`;
}

function summarizeDocument(
  value: unknown,
  runtime: XmlHttpRequestPayloadRuntime,
): string | undefined {
  const result = callIntrinsic(runtime.documentContentTypeGetters, value);

  return result.ok && typeof result.value === "string"
    ? `[Document type=${result.value}]`
    : undefined;
}

function toRequestPayload(
  body: Document | XMLHttpRequestBodyInit | null,
  runtime: XmlHttpRequestPayloadRuntime,
): BrowseSentEventPayload {
  try {
    if (body === null) {
      return "";
    }

    if (typeof body === "string") {
      return body;
    }

    const searchParams = callIntrinsic(runtime.urlSearchParamsStringifiers, body);

    if (searchParams.ok && typeof searchParams.value === "string") {
      return searchParams.value;
    }

    if (isArrayBuffer(body, runtime)) {
      const byteLength = getArrayBufferByteLength(body, runtime);

      return byteLength === undefined
        ? "[unavailable ArrayBuffer request]"
        : copyArrayBuffer(body, 0, byteLength);
    }

    const viewCopy = copyArrayBufferView(body, runtime);

    if (viewCopy) {
      return viewCopy;
    }

    const blobSummary = summarizeBlob(body, runtime);

    if (blobSummary) {
      return blobSummary;
    }

    const formDataSummary = summarizeFormData(body, runtime);

    if (formDataSummary) {
      return formDataSummary;
    }

    const documentSummary = summarizeDocument(body, runtime);

    if (documentSummary) {
      return documentSummary;
    }

    return "[unsupported XHR request body]";
  } catch {
    return "[unavailable request payload]";
  }
}

function toResponsePayload(
  request: XMLHttpRequest,
  runtime: XmlHttpRequestPayloadRuntime,
): BrowseSentEventPayload {
  try {
    switch (request.responseType) {
      case "":
      case "text":
        return request.responseText;
      case "arraybuffer": {
        const response: unknown = request.response;

        if (!isArrayBuffer(response, runtime)) {
          return "[unavailable ArrayBuffer response]";
        }

        const byteLength = getArrayBufferByteLength(response, runtime);

        return byteLength === undefined
          ? "[unavailable ArrayBuffer response]"
          : copyArrayBuffer(response, 0, byteLength);
      }
      case "json": {
        const response: unknown = request.response;

        return JSON.stringify(response) ?? "null";
      }
      case "blob": {
        const response: unknown = request.response;

        return summarizeBlob(response, runtime) ?? "[unavailable Blob response]";
      }
      case "document": {
        const response: unknown = request.response;

        return summarizeDocument(response, runtime) ?? "[unavailable Document response]";
      }
      default:
        return "[unsupported XHR response type]";
    }
  } catch {
    return "[unavailable response payload]";
  }
}

function equalsAsciiCaseInsensitive(value: string, uppercase: string, lowercase: string): boolean {
  if (value.length !== uppercase.length) {
    return false;
  }

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (character !== uppercase[index] && character !== lowercase[index]) {
      return false;
    }
  }

  return true;
}

function normalizeMethod(method: string): string {
  if (equalsAsciiCaseInsensitive(method, "DELETE", "delete")) {
    return "DELETE";
  }

  if (equalsAsciiCaseInsensitive(method, "GET", "get")) {
    return "GET";
  }

  if (equalsAsciiCaseInsensitive(method, "HEAD", "head")) {
    return "HEAD";
  }

  if (equalsAsciiCaseInsensitive(method, "OPTIONS", "options")) {
    return "OPTIONS";
  }

  if (equalsAsciiCaseInsensitive(method, "POST", "post")) {
    return "POST";
  }

  if (equalsAsciiCaseInsensitive(method, "PUT", "put")) {
    return "PUT";
  }

  return method;
}

function createDescriptor(args: readonly unknown[]): XmlHttpRequestDescriptor | undefined {
  const [method, url, async = true] = args;

  if (typeof method !== "string" || typeof url !== "string") {
    return undefined;
  }

  return {
    method: normalizeMethod(method),
    url,
    async: Boolean(async),
    sent: false,
  };
}

function captureCompletion(
  request: XMLHttpRequest,
  payloadRuntime: XmlHttpRequestPayloadRuntime,
  outcome: XmlHttpRequestCompletion["outcome"],
): XmlHttpRequestCompletion {
  const metadata = {
    contentType: observeValue(() => request.getResponseHeader("content-type"), null),
    outcome,
    responseType: observeValue(() => request.responseType, ""),
    responseURL: observeValue(() => request.responseURL, ""),
    status: observeValue(() => request.status, 0),
    statusText: observeValue(() => request.statusText, ""),
  };

  return outcome === "load"
    ? {
        ...metadata,
        payload: toResponsePayload(request, payloadRuntime),
      }
    : metadata;
}

function createReopenedCompletion(): XmlHttpRequestCompletion {
  return {
    contentType: null,
    outcome: "reopened",
    responseType: "",
    responseURL: "",
    status: 0,
    statusText: "",
  };
}

function instrumentXmlHttpRequest(
  request: XMLHttpRequest,
  context: BrowseSentEventInterceptorContext,
  payloadRuntime: XmlHttpRequestPayloadRuntime,
): void {
  const originalOpenDescriptor = Object.getOwnPropertyDescriptor(request, "open");
  const originalSendDescriptor = Object.getOwnPropertyDescriptor(request, "send");
  const openDescriptor = getPropertyDescriptor(request, "open");
  const sendDescriptor = getPropertyDescriptor(request, "send");

  if (
    (openDescriptor && !("value" in openDescriptor)) ||
    (sendDescriptor && !("value" in sendDescriptor))
  ) {
    throw new TypeError("Accessor-backed XMLHttpRequest methods cannot be instrumented safely.");
  }

  const originalOpen: unknown = Reflect.get(request, "open");
  const originalSend: unknown = Reflect.get(request, "send");

  if (typeof originalOpen !== "function" || typeof originalSend !== "function") {
    throw new TypeError("Expected XMLHttpRequest methods.");
  }

  let descriptor: XmlHttpRequestDescriptor | undefined;
  let active: ActiveXmlHttpRequest | undefined;
  const openCallStack: PendingXmlHttpRequestOpen[] = [];
  const doneGenerations: ActiveXmlHttpRequest[] = [];
  let ignoredLoadEndEvents = 0;

  function finalize(current: ActiveXmlHttpRequest, completion: XmlHttpRequestCompletion): void {
    if (current.finalized) {
      return;
    }

    current.finalized = true;

    if (completion.outcome === "load" && completion.payload !== undefined) {
      observeSafely(() => {
        context.engine.recordMessage({
          connectionId: current.connection.id,
          direction: "in",
          protocol: "xhr",
          payload: completion.payload ?? "",
          type: "response",
          metadata: {
            contentType: completion.contentType,
            status: completion.status,
            statusText: completion.statusText,
          },
        });
      });
    }

    observeSafely(() => {
      context.engine.updateConnection(current.connection.id, {
        state: "closed",
        closedAt: now(),
        metadata: {
          contentType: completion.contentType,
          outcome: completion.outcome,
          responseType: completion.responseType,
          responseURL: completion.responseURL,
          status: completion.status,
          statusText: completion.statusText,
        },
      });
    });

    if (active === current) {
      active = undefined;
    }
  }

  function activatePendingOpen(pending: PendingXmlHttpRequestOpen): void {
    if (pending.activated) {
      return;
    }

    pending.activated = true;
    const previousActive = active;

    if (previousActive && !previousActive.finalized && !previousActive.doneCompletion) {
      finalize(previousActive, createReopenedCompletion());
    }

    descriptor = pending.descriptor;

    if (active === previousActive) {
      active = undefined;
    }
  }

  function closeAfterSendError(): void {
    const current = active;

    if (!current || current.finalized) {
      return;
    }

    current.finalized = true;
    observeSafely(() => {
      context.engine.updateConnection(current.connection.id, {
        state: "closed",
        closedAt: now(),
        metadata: {
          outcome: "send-threw",
        },
      });
    });
    active = undefined;
  }

  function beginObservation(
    currentDescriptor: XmlHttpRequestDescriptor,
    body: Document | XMLHttpRequestBodyInit | null,
  ): void {
    if (isUrlExcluded(context, currentDescriptor.url)) {
      return;
    }

    observeSafely(() => {
      const knownConnectionIds = new Set(
        context.engine.getConnections().map((connection) => connection.id),
      );
      let connection: BrowseSentEventConnection | undefined;

      try {
        connection = context.engine.recordConnection({
          protocol: "xhr",
          url: currentDescriptor.url,
          state: "connecting",
          metadata: {
            async: currentDescriptor.async,
            method: currentDescriptor.method,
            timeout: observeValue(() => request.timeout, 0),
            withCredentials: observeValue(() => request.withCredentials, false),
          },
        });
      } catch {
        connection = context.engine
          .getConnections()
          .find((candidate) => !knownConnectionIds.has(candidate.id));
      }

      if (!connection) {
        return;
      }

      active = {
        connection,
        finalized: false,
      };
      observeSafely(() => {
        context.engine.recordMessage({
          connectionId: connection.id,
          direction: "out",
          protocol: "xhr",
          payload:
            currentDescriptor.method === "GET" || currentDescriptor.method === "HEAD"
              ? ""
              : toRequestPayload(body, payloadRuntime),
          type: "request",
          metadata: {
            method: currentDescriptor.method,
          },
        });
      });
    });
  }

  const handleLoadStart = () => {
    const current = active;

    if (current) {
      observeSafely(() => {
        context.engine.updateConnection(current.connection.id, { state: "open" });
      });
    }
  };
  const handleReadyStateChange = () => {
    const readyState = observeValue(() => request.readyState, 0);
    const pending = openCallStack.at(-1);

    if (readyState === 1 && pending) {
      activatePendingOpen(pending);
    }

    const current = active;

    if (readyState === 4 && current && !current.doneCompletion) {
      current.doneCompletion = captureCompletion(request, payloadRuntime, "load");
      doneGenerations.push(current);
    }
  };
  const terminalListeners = (["load", "error", "abort", "timeout"] as const).map(
    (outcome) =>
      [
        outcome,
        () => {
          const current = doneGenerations.pop() ?? active;

          if (!current || current.finalized) {
            return;
          }

          const completion = current.doneCompletion
            ? { ...current.doneCompletion, outcome }
            : captureCompletion(request, payloadRuntime, outcome);

          finalize(current, completion);
          ignoredLoadEndEvents += 1;
        },
      ] as const,
  );
  const handleLoadEnd = () => {
    if (ignoredLoadEndEvents > 0) {
      ignoredLoadEndEvents -= 1;
      return;
    }

    const current = active;

    if (current) {
      finalize(current, captureCompletion(request, payloadRuntime, "unknown"));
    }
  };
  const listeners: readonly (readonly [string, EventListener])[] = [
    ["loadstart", handleLoadStart],
    ["readystatechange", handleReadyStateChange],
    ...terminalListeners,
    ["loadend", handleLoadEnd],
  ];

  function restoreMethod(
    name: "open" | "send",
    propertyDescriptor: PropertyDescriptor | undefined,
    original: unknown,
  ): void {
    observeSafely(() => {
      Reflect.set(request, name, original);

      if (propertyDescriptor) {
        Reflect.defineProperty(request, name, propertyDescriptor);
        return;
      }

      Reflect.deleteProperty(request, name);
    });
  }

  const wrappedOpen = function (this: XMLHttpRequest, ...args: unknown[]) {
    if (this !== request) {
      return Reflect.apply(originalOpen, this, args);
    }

    const pending: PendingXmlHttpRequestOpen = {
      activated: false,
      descriptor: createDescriptor(args),
    };

    openCallStack.push(pending);

    try {
      const result = Reflect.apply(originalOpen, this, args);

      activatePendingOpen(pending);

      return result;
    } finally {
      const pendingIndex = openCallStack.lastIndexOf(pending);

      if (pendingIndex >= 0) {
        openCallStack.splice(pendingIndex, 1);
      }
    }
  };
  const wrappedSend = function (
    this: XMLHttpRequest,
    ...args: [body?: Document | XMLHttpRequestBodyInit | null]
  ) {
    if (this !== request) {
      return Reflect.apply(originalSend, this, args);
    }

    if (!descriptor || descriptor.sent) {
      return Reflect.apply(originalSend, this, args);
    }

    const currentDescriptor = descriptor;

    currentDescriptor.sent = true;
    const body = args[0] ?? null;

    beginObservation(currentDescriptor, body);

    try {
      return Reflect.apply(originalSend, this, args);
    } catch (error) {
      closeAfterSendError();
      currentDescriptor.sent = false;
      throw error;
    }
  };

  try {
    if (
      !Reflect.set(request, "open", wrappedOpen) ||
      Reflect.get(request, "open") !== wrappedOpen
    ) {
      throw new TypeError("Could not instrument XMLHttpRequest.open.");
    }

    if (
      !Reflect.set(request, "send", wrappedSend) ||
      Reflect.get(request, "send") !== wrappedSend
    ) {
      throw new TypeError("Could not instrument XMLHttpRequest.send.");
    }

    for (const [type, listener] of listeners) {
      request.addEventListener(type, listener);
    }
  } catch (error) {
    for (const [type, listener] of listeners) {
      observeSafely(() => {
        request.removeEventListener(type, listener);
      });
    }

    restoreMethod("send", originalSendDescriptor, originalSend);
    restoreMethod("open", originalOpenDescriptor, originalOpen);

    throw error;
  }
}

export function installXmlHttpRequestInterceptor(
  context: BrowseSentEventInterceptorContext,
): InstalledBrowseSentEventInterceptor | undefined {
  const OriginalXmlHttpRequest = context.target.XMLHttpRequest;

  if (!OriginalXmlHttpRequest) {
    return undefined;
  }

  const payloadRuntime = createPayloadRuntime(context.target);
  const ProxiedXmlHttpRequest = new Proxy(OriginalXmlHttpRequest, {
    construct(target, args, newTarget) {
      const request = Reflect.construct(target, args, newTarget);

      try {
        if (isInstrumentableXmlHttpRequest(request)) {
          instrumentXmlHttpRequest(request, context, payloadRuntime);
        }
      } catch {
        // 선행 patch가 계측을 거부해도 생성된 XHR 인스턴스는 그대로 반환한다.
      }

      return request;
    },
  });
  const patch = installGlobalPatch(context.target, "XMLHttpRequest", () => ProxiedXmlHttpRequest);

  return {
    name: "xhr",
    uninstall() {
      patch.uninstall();
    },
  };
}
