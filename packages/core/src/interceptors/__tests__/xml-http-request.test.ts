import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDevtoolsEngine } from "../../runtime/engine.js";
import { installXmlHttpRequestInterceptor } from "../xml-http-request.js";

const originalXmlHttpRequest = globalThis.window.XMLHttpRequest;

class FakeXmlHttpRequest extends globalThis.EventTarget {
  static readonly UNSENT = 0;
  static readonly OPENED = 1;
  static readonly HEADERS_RECEIVED = 2;
  static readonly LOADING = 3;
  static readonly DONE = 4;

  readonly UNSENT = FakeXmlHttpRequest.UNSENT;
  readonly OPENED = FakeXmlHttpRequest.OPENED;
  readonly HEADERS_RECEIVED = FakeXmlHttpRequest.HEADERS_RECEIVED;
  readonly LOADING = FakeXmlHttpRequest.LOADING;
  readonly DONE = FakeXmlHttpRequest.DONE;

  readyState = FakeXmlHttpRequest.UNSENT;
  response: unknown = "";
  responseText = "";
  responseType: XMLHttpRequestResponseType = "";
  responseURL = "";
  status = 0;
  statusText = "";
  timeout = 0;
  withCredentials = false;
  private sendInvoked = false;
  readonly sentBodies: (Document | XMLHttpRequestBodyInit | null)[] = [];
  openedWith:
    | {
        readonly method: string;
        readonly url: string;
        readonly async: boolean;
      }
    | undefined;

  open(method: string, url: string | URL, async = true): void {
    this.openedWith = {
      method,
      url: String(url),
      async,
    };
    this.readyState = FakeXmlHttpRequest.OPENED;
    this.sendInvoked = false;
    this.dispatchEvent(new globalThis.ProgressEvent("readystatechange"));
  }

  send(body: Document | XMLHttpRequestBodyInit | null = null): void {
    if (this.sendInvoked) {
      throw new globalThis.DOMException("Already sent", "InvalidStateError");
    }

    this.sendInvoked = true;
    this.sentBodies.push(body);
    this.dispatchEvent(new globalThis.ProgressEvent("loadstart"));
  }

  getResponseHeader(name: string): string | null {
    return name.toLowerCase() === "content-type" ? "application/json" : null;
  }

  succeed(responseText: string, status = 200): void {
    this.status = status;
    this.statusText = status === 200 ? "OK" : "ERROR";
    this.responseText = responseText;
    this.response = responseText;
    this.responseURL = "https://example.test/items";
    this.readyState = FakeXmlHttpRequest.DONE;
    this.dispatchEvent(new globalThis.ProgressEvent("readystatechange"));
    this.dispatchEvent(new globalThis.ProgressEvent("load"));
    this.dispatchEvent(new globalThis.ProgressEvent("loadend"));
  }
}

describe("installXmlHttpRequestInterceptor", () => {
  beforeEach(() => {
    Reflect.set(globalThis.window, "XMLHttpRequest", FakeXmlHttpRequest);
  });

  afterEach(() => {
    Reflect.set(globalThis.window, "XMLHttpRequest", originalXmlHttpRequest);
  });

  it("records a completed XHR request and response", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });
    const installed = installXmlHttpRequestInterceptor({
      engine,
      target: globalThis.window,
    });
    const request = new globalThis.window.XMLHttpRequest();

    request.open("post", "https://example.test/items");
    request.send('{"name":"sample"}');
    Reflect.apply(Reflect.get(request, "succeed"), request, ['{"id":"item-1"}']);

    expect(Reflect.get(request, "openedWith")).toEqual({
      method: "post",
      url: "https://example.test/items",
      async: true,
    });
    expect(Reflect.get(request, "sentBodies")).toEqual(['{"name":"sample"}']);
    expect(installed?.name).toBe("xhr");
    expect(engine.getConnections()).toEqual([
      expect.objectContaining({
        protocol: "xhr",
        state: "closed",
        url: "https://example.test/items",
        metadata: expect.objectContaining({
          method: "POST",
          outcome: "load",
          status: 200,
        }),
      }),
    ]);
    expect(engine.getMessages()).toEqual([
      expect.objectContaining({
        direction: "out",
        payloadPreview: '{"name":"sample"}',
        protocol: "xhr",
        type: "request",
      }),
      expect.objectContaining({
        direction: "in",
        payloadPreview: '{"id":"item-1"}',
        protocol: "xhr",
        type: "response",
      }),
    ]);

    installed?.uninstall();
    expect(globalThis.window.XMLHttpRequest).toBe(FakeXmlHttpRequest);
  });

  it("preserves the native instance identity and static constants", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });

    installXmlHttpRequestInterceptor({
      engine,
      target: globalThis.window,
    });

    const request = new globalThis.window.XMLHttpRequest();

    expect(request).toBeInstanceOf(FakeXmlHttpRequest);
    expect(globalThis.window.XMLHttpRequest.DONE).toBe(FakeXmlHttpRequest.DONE);
  });

  it("preserves the receiver semantics of borrowed native methods", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });

    installXmlHttpRequestInterceptor({
      engine,
      target: globalThis.window,
    });

    const first = new globalThis.window.XMLHttpRequest();
    const second = new globalThis.window.XMLHttpRequest();

    Reflect.apply(Reflect.get(first, "open"), second, ["GET", "https://example.test/borrowed"]);

    expect(Reflect.get(first, "openedWith")).toBeUndefined();
    expect(Reflect.get(second, "openedWith")).toEqual({
      method: "GET",
      url: "https://example.test/borrowed",
      async: true,
    });
    Reflect.apply(Reflect.get(first, "send"), second, ["borrowed-body"]);
    expect(Reflect.get(first, "sentBodies")).toEqual([]);
    expect(Reflect.get(second, "sentBodies")).toEqual(["borrowed-body"]);
    expect(() =>
      Reflect.apply(Reflect.get(first, "open"), undefined, [
        "GET",
        "https://example.test/detached",
      ]),
    ).toThrow();
    expect(() => Reflect.apply(Reflect.get(first, "send"), undefined, [])).toThrow();
    expect(engine.getConnections()).toEqual([]);
    expect(engine.getMessages()).toEqual([]);
  });

  it("preserves a URL object without recording an inferred URL", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });

    installXmlHttpRequestInterceptor({
      engine,
      target: globalThis.window,
    });

    const request = new globalThis.window.XMLHttpRequest();
    const url = new globalThis.URL("/items", "https://example.test");

    request.open("GET", url);
    request.send();

    expect(Reflect.get(request, "openedWith")).toEqual({
      method: "GET",
      url: "https://example.test/items",
      async: true,
    });
    expect(engine.getConnections()).toEqual([]);
    expect(engine.getMessages()).toEqual([]);
  });

  it("does not record a URL object with a custom primitive conversion", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });

    installXmlHttpRequestInterceptor({
      engine,
      target: globalThis.window,
    });

    const request = new globalThis.window.XMLHttpRequest();
    const url = new globalThis.URL("/intrinsic", "https://example.test");

    Object.defineProperty(url, Symbol.toPrimitive, {
      configurable: true,
      value() {
        return "https://example.test/custom-conversion";
      },
    });
    request.open("GET", url);
    request.send();

    expect(Reflect.get(request, "openedWith")).toEqual({
      method: "GET",
      url: "https://example.test/custom-conversion",
      async: true,
    });
    expect(engine.getConnections()).toEqual([]);
    expect(engine.getMessages()).toEqual([]);
  });

  it("does not record a URL object with an inherited primitive conversion", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });
    const urlPrototype = globalThis.URL.prototype;
    const originalDescriptor = Object.getOwnPropertyDescriptor(urlPrototype, Symbol.toPrimitive);

    installXmlHttpRequestInterceptor({
      engine,
      target: globalThis.window,
    });
    Object.defineProperty(urlPrototype, Symbol.toPrimitive, {
      configurable: true,
      value() {
        return "https://example.test/inherited-conversion";
      },
    });

    try {
      const request = new globalThis.window.XMLHttpRequest();
      const url = new globalThis.URL("/intrinsic", "https://example.test");

      request.open("GET", url);
      request.send();

      expect(Reflect.get(request, "openedWith")).toEqual({
        method: "GET",
        url: "https://example.test/inherited-conversion",
        async: true,
      });
      expect(engine.getConnections()).toEqual([]);
      expect(engine.getMessages()).toEqual([]);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(urlPrototype, Symbol.toPrimitive, originalDescriptor);
      } else {
        Reflect.deleteProperty(urlPrototype, Symbol.toPrimitive);
      }
    }
  });

  it("does not reflect on an unsupported URL-like proxy", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });
    let getPrototypeOfCalls = 0;
    const url = new Proxy(
      {
        toString() {
          return "https://example.test/proxy-url";
        },
      },
      {
        getPrototypeOf(target) {
          getPrototypeOfCalls += 1;

          return Reflect.getPrototypeOf(target);
        },
      },
    );

    installXmlHttpRequestInterceptor({
      engine,
      target: globalThis.window,
    });

    const request = new globalThis.window.XMLHttpRequest();

    Reflect.apply(Reflect.get(request, "open"), request, ["GET", url]);
    request.send();

    expect(getPrototypeOfCalls).toBe(0);
    expect(engine.getConnections()).toEqual([]);
    expect(engine.getMessages()).toEqual([]);
  });

  it("records send called from the OPENED state handler", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });

    installXmlHttpRequestInterceptor({
      engine,
      target: globalThis.window,
    });

    const request = new globalThis.window.XMLHttpRequest();
    let sent = false;

    request.addEventListener("readystatechange", () => {
      if (request.readyState === request.OPENED && !sent) {
        sent = true;
        request.send("opened-body");
      }
    });
    request.open("POST", "https://example.test/opened-send");

    expect(engine.getConnections()).toEqual([
      expect.objectContaining({
        url: "https://example.test/opened-send",
      }),
    ]);
    expect(engine.getMessages()[0]?.payloadPreview).toBe("opened-body");
  });

  it("keeps the newest descriptor after open reenters from OPENED", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });

    installXmlHttpRequestInterceptor({
      engine,
      target: globalThis.window,
    });

    const request = new globalThis.window.XMLHttpRequest();
    let nested = false;

    request.addEventListener("readystatechange", () => {
      if (request.readyState === request.OPENED && !nested) {
        nested = true;
        request.open("POST", "https://example.test/inner");
        request.send("inner-body");
      }
    });
    request.open("GET", "https://example.test/outer");

    expect(engine.getConnections()).toEqual([
      expect.objectContaining({
        url: "https://example.test/inner",
        metadata: expect.objectContaining({ method: "POST" }),
      }),
    ]);
    expect(engine.getMessages()[0]?.payloadPreview).toBe("inner-body");
  });

  it("copies ArrayBuffer request and response payloads", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });

    installXmlHttpRequestInterceptor({
      engine,
      target: globalThis.window,
    });

    const request = new globalThis.window.XMLHttpRequest();
    const requestBody = new Uint8Array([1, 2, 3]);

    request.open("POST", "https://example.test/binary");
    request.responseType = "arraybuffer";
    request.send(requestBody);

    Reflect.set(request, "response", new Uint8Array([4, 5]).buffer);
    Reflect.set(request, "status", 200);
    request.dispatchEvent(new globalThis.ProgressEvent("load"));
    request.dispatchEvent(new globalThis.ProgressEvent("loadend"));

    const [outgoing, incoming] = engine.getMessages();

    expect(outgoing?.payload).toEqual(new Uint8Array([1, 2, 3]).buffer);
    expect(incoming?.payload).toEqual(new Uint8Array([4, 5]).buffer);
    expect(outgoing?.payload).not.toBe(requestBody.buffer);
  });

  it("copies ArrayBuffer without reading an overridden byteLength", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });
    const body = new globalThis.ArrayBuffer(3);
    let overrideCalls = 0;

    Object.defineProperty(body, "byteLength", {
      configurable: true,
      get() {
        overrideCalls += 1;

        return 0;
      },
    });
    installXmlHttpRequestInterceptor({
      engine,
      target: globalThis.window,
    });

    const request = new globalThis.window.XMLHttpRequest();

    request.open("POST", "https://example.test/array-buffer-override");
    request.send(body);

    expect(overrideCalls).toBe(0);
    expect(engine.getMessages()[0]?.size).toBe(3);
  });

  it("summarizes FormData without exposing field values", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });
    const formData = new globalThis.FormData();

    formData.append("token", "secret-value");
    formData.append("file", new globalThis.Blob(["content"], { type: "text/plain" }));

    installXmlHttpRequestInterceptor({
      engine,
      target: globalThis.window,
    });

    const request = new globalThis.window.XMLHttpRequest();

    request.open("POST", "https://example.test/form");
    request.send(formData);

    const payload = engine.getMessages()[0]?.payload;

    expect(payload).toContain("FormData");
    expect(payload).toContain("token");
    expect(payload).not.toContain("secret-value");
  });

  it("serializes a json response without reading responseText", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });

    installXmlHttpRequestInterceptor({
      engine,
      target: globalThis.window,
    });

    const request = new globalThis.window.XMLHttpRequest();

    request.open("GET", "https://example.test/json");
    request.responseType = "json";
    request.send();
    Reflect.set(request, "response", { id: "item-1" });
    Reflect.set(request, "status", 200);
    Object.defineProperty(request, "responseText", {
      configurable: true,
      get() {
        throw new Error("responseText must not be read");
      },
    });
    request.dispatchEvent(new globalThis.ProgressEvent("load"));
    request.dispatchEvent(new globalThis.ProgressEvent("loadend"));

    expect(engine.getMessages()[1]).toEqual(
      expect.objectContaining({
        payloadPreview: '{"id":"item-1"}',
      }),
    );
  });

  it.each(["error", "abort", "timeout"] as const)(
    "closes the connection on %s without recording a response",
    (outcome) => {
      const engine = createDevtoolsEngine({ capacity: 10 });

      installXmlHttpRequestInterceptor({
        engine,
        target: globalThis.window,
      });

      const request = new globalThis.window.XMLHttpRequest();

      request.open("GET", `https://example.test/${outcome}`);
      request.send();
      request.dispatchEvent(new globalThis.ProgressEvent(outcome));
      request.dispatchEvent(new globalThis.ProgressEvent("loadend"));

      expect(engine.getMessages()).toHaveLength(1);
      expect(engine.getConnections()[0]).toEqual(
        expect.objectContaining({
          state: "closed",
          metadata: expect.objectContaining({ outcome }),
        }),
      );
    },
  );

  it("rethrows a native send error and closes the attempted connection", () => {
    class ThrowingXmlHttpRequest extends FakeXmlHttpRequest {
      override send(): void {
        throw new globalThis.DOMException("Already sent", "InvalidStateError");
      }
    }

    Reflect.set(globalThis.window, "XMLHttpRequest", ThrowingXmlHttpRequest);

    const engine = createDevtoolsEngine({ capacity: 10 });

    installXmlHttpRequestInterceptor({
      engine,
      target: globalThis.window,
    });

    const request = new globalThis.window.XMLHttpRequest();

    request.open("POST", "https://example.test/failing-send");

    expect(() => request.send("body")).toThrowError(
      expect.objectContaining({ name: "InvalidStateError" }),
    );
    expect(engine.getConnections()[0]).toEqual(
      expect.objectContaining({
        state: "closed",
        metadata: expect.objectContaining({ outcome: "send-threw" }),
      }),
    );
  });

  it("creates a new connection when the same instance is reopened", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });

    installXmlHttpRequestInterceptor({
      engine,
      target: globalThis.window,
    });

    const request = new globalThis.window.XMLHttpRequest();

    request.open("GET", "https://example.test/reused");
    request.send();
    Reflect.apply(Reflect.get(request, "succeed"), request, ["first"]);
    request.open("GET", "https://example.test/reused");
    request.send();
    Reflect.apply(Reflect.get(request, "succeed"), request, ["second"]);

    expect(engine.getConnections()).toHaveLength(2);
    expect(engine.getConnections()[1]?.reconnectCount).toBe(1);
    expect(engine.getMessages()).toHaveLength(4);
  });

  it("keeps terminal generations separate when a load handler reuses the instance", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });

    installXmlHttpRequestInterceptor({
      engine,
      target: globalThis.window,
    });

    const request = new globalThis.window.XMLHttpRequest();

    request.addEventListener(
      "load",
      () => {
        request.open("GET", "https://example.test/reentrant-second");
        request.send();
        Reflect.set(request, "responseText", "second");
      },
      { once: true },
    );
    request.open("GET", "https://example.test/reentrant-first");
    request.send();
    Reflect.set(request, "responseText", "first");
    request.dispatchEvent(new globalThis.ProgressEvent("load"));
    request.dispatchEvent(new globalThis.ProgressEvent("loadend"));

    expect(engine.getConnections()).toEqual([
      expect.objectContaining({
        state: "closed",
        url: "https://example.test/reentrant-first",
        metadata: expect.objectContaining({ outcome: "load" }),
      }),
      expect.objectContaining({
        state: "open",
        url: "https://example.test/reentrant-second",
      }),
    ]);
    expect(engine.getMessages()).toHaveLength(3);
    expect(engine.getMessages()[1]?.payloadPreview).toBe("first");

    request.dispatchEvent(new globalThis.ProgressEvent("load"));
    request.dispatchEvent(new globalThis.ProgressEvent("loadend"));

    expect(engine.getConnections()[1]).toEqual(
      expect.objectContaining({
        state: "closed",
        metadata: expect.objectContaining({ outcome: "load" }),
      }),
    );
    expect(engine.getMessages()).toHaveLength(4);
    expect(engine.getMessages()[3]?.payloadPreview).toBe("second");
  });

  it("closes an in-flight generation when open reuses the instance", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });

    installXmlHttpRequestInterceptor({
      engine,
      target: globalThis.window,
    });

    const request = new globalThis.window.XMLHttpRequest();

    request.open("GET", "https://example.test/in-flight-first");
    request.send();
    request.open("GET", "https://example.test/in-flight-second");
    request.send();
    Reflect.apply(Reflect.get(request, "succeed"), request, ["second"]);

    expect(engine.getConnections()).toEqual([
      expect.objectContaining({
        state: "closed",
        url: "https://example.test/in-flight-first",
        metadata: expect.objectContaining({ outcome: "reopened" }),
      }),
      expect.objectContaining({
        state: "closed",
        url: "https://example.test/in-flight-second",
        metadata: expect.objectContaining({ outcome: "load" }),
      }),
    ]);
  });

  it("keeps nested DONE-handler completion generations in LIFO order", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });

    installXmlHttpRequestInterceptor({
      engine,
      target: globalThis.window,
    });

    const request = new globalThis.window.XMLHttpRequest();
    let reused = false;

    request.addEventListener("readystatechange", () => {
      if (request.readyState === request.DONE && !reused) {
        reused = true;
        request.open("GET", "https://example.test/done-second");
        request.send();
        Reflect.apply(Reflect.get(request, "succeed"), request, ["second"]);
      }
    });
    request.open("GET", "https://example.test/done-first");
    request.send();
    Reflect.apply(Reflect.get(request, "succeed"), request, ["first"]);

    expect(engine.getConnections()).toEqual([
      expect.objectContaining({
        state: "closed",
        url: "https://example.test/done-first",
        metadata: expect.objectContaining({ outcome: "load" }),
      }),
      expect.objectContaining({
        state: "closed",
        url: "https://example.test/done-second",
        metadata: expect.objectContaining({ outcome: "load" }),
      }),
    ]);
    expect(engine.getMessages()).toHaveLength(4);
    expect(engine.getMessages()[2]?.payloadPreview).toBe("second");
    expect(engine.getMessages()[3]?.payloadPreview).toBe("first");
  });

  it("delegates a duplicate send without recording another attempt", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });

    installXmlHttpRequestInterceptor({
      engine,
      target: globalThis.window,
    });

    const request = new globalThis.window.XMLHttpRequest();

    request.open("POST", "https://example.test/duplicate");
    request.send("first");

    expect(() => request.send("second")).toThrowError(
      expect.objectContaining({ name: "InvalidStateError" }),
    );
    expect(engine.getConnections()).toHaveLength(1);
    expect(engine.getMessages()).toHaveLength(1);
  });

  it("does not invoke an overridden FormData iterator while observing", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });
    const formData = new globalThis.FormData();
    let overrideCalls = 0;

    formData.append("name", "sample");
    Reflect.set(formData, "entries", () => {
      overrideCalls += 1;
      formData.append("injected", "wire-change");

      return [][Symbol.iterator]();
    });
    installXmlHttpRequestInterceptor({
      engine,
      target: globalThis.window,
    });

    const request = new globalThis.window.XMLHttpRequest();

    request.open("POST", "https://example.test/form-override");
    request.send(formData);

    expect(overrideCalls).toBe(0);
    expect(
      Reflect.apply(Reflect.get(globalThis.FormData.prototype, "has"), formData, ["injected"]),
    ).toBe(false);
    expect(engine.getMessages()[0]?.payloadPreview).toContain("name");
  });

  it.each(["GET", "HEAD"] as const)("does not record a body discarded by %s", (method) => {
    const engine = createDevtoolsEngine({ capacity: 10 });

    installXmlHttpRequestInterceptor({
      engine,
      target: globalThis.window,
    });

    const request = new globalThis.window.XMLHttpRequest();

    request.open(method, "https://example.test/discarded-body");
    request.send("secret-that-is-not-sent");

    expect(engine.getMessages()[0]?.payload).toBe("");
  });

  it("records a retry after native send argument conversion fails", () => {
    class ConvertingXmlHttpRequest extends FakeXmlHttpRequest {
      override send(body: Document | XMLHttpRequestBodyInit | null = null): void {
        const value: unknown = body;

        if (typeof value === "symbol") {
          throw new TypeError("Cannot convert a Symbol value to a string");
        }

        super.send(body);
      }
    }

    Reflect.set(globalThis.window, "XMLHttpRequest", ConvertingXmlHttpRequest);

    const engine = createDevtoolsEngine({ capacity: 10 });

    installXmlHttpRequestInterceptor({
      engine,
      target: globalThis.window,
    });

    const request = new globalThis.window.XMLHttpRequest();

    request.open("POST", "https://example.test/retry");
    expect(() => Reflect.apply(Reflect.get(request, "send"), request, [Symbol("invalid")])).toThrow(
      TypeError,
    );
    request.send("ok");
    Reflect.apply(Reflect.get(request, "succeed"), request, ["done"]);

    expect(engine.getConnections()).toHaveLength(2);
    expect(engine.getConnections()[0]).toEqual(
      expect.objectContaining({
        state: "closed",
        metadata: expect.objectContaining({ outcome: "send-threw" }),
      }),
    );
    expect(engine.getConnections()[1]).toEqual(
      expect.objectContaining({
        state: "closed",
        metadata: expect.objectContaining({ outcome: "load" }),
      }),
    );
    expect(engine.getMessages()).toHaveLength(3);
  });

  it("finalizes a connection even when an engine subscriber throws", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });

    engine.subscribe(() => {
      throw new Error("subscriber failed");
    });
    installXmlHttpRequestInterceptor({
      engine,
      target: globalThis.window,
    });

    const request = new globalThis.window.XMLHttpRequest();

    request.open("GET", "https://example.test/subscriber");
    expect(() => request.send()).not.toThrow();
    Reflect.apply(Reflect.get(request, "succeed"), request, ["done"]);

    expect(engine.getConnections()).toEqual([
      expect.objectContaining({
        state: "closed",
        metadata: expect.objectContaining({ outcome: "load" }),
      }),
    ]);
  });

  it("does not expose request metadata observation errors to native send", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });

    installXmlHttpRequestInterceptor({
      engine,
      target: globalThis.window,
    });

    const request = new globalThis.window.XMLHttpRequest();

    request.open("POST", "https://example.test/metadata");
    Object.defineProperty(request, "timeout", {
      configurable: true,
      get() {
        throw new Error("timeout unavailable");
      },
    });

    expect(() => request.send("body")).not.toThrow();
    expect(Reflect.get(request, "sentBodies")).toEqual(["body"]);
    expect(engine.getConnections()[0]?.metadata).toEqual(expect.objectContaining({ timeout: 0 }));
  });

  it("does not read response for a text response", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });

    installXmlHttpRequestInterceptor({
      engine,
      target: globalThis.window,
    });

    const request = new globalThis.window.XMLHttpRequest();

    request.open("GET", "https://example.test/text");
    request.send();
    Reflect.set(request, "responseText", "text response");
    Object.defineProperty(request, "response", {
      configurable: true,
      get() {
        throw new Error("response must not be read");
      },
    });
    request.dispatchEvent(new globalThis.ProgressEvent("load"));
    request.dispatchEvent(new globalThis.ProgressEvent("loadend"));

    expect(engine.getMessages()[1]?.payloadPreview).toBe("text response");
  });

  it("copies an ArrayBuffer created by another window", () => {
    const iframe = globalThis.document.createElement("iframe");

    globalThis.document.body.append(iframe);

    try {
      const foreignWindow = iframe.contentWindow;

      if (!foreignWindow) {
        throw new Error("Expected iframe contentWindow");
      }

      const ForeignArrayBuffer: unknown = Reflect.get(foreignWindow, "ArrayBuffer");

      if (typeof ForeignArrayBuffer !== "function") {
        throw new Error("Expected iframe ArrayBuffer");
      }

      const foreignBuffer: unknown = Reflect.construct(ForeignArrayBuffer, [3]);
      const engine = createDevtoolsEngine({ capacity: 10 });

      installXmlHttpRequestInterceptor({
        engine,
        target: globalThis.window,
      });

      const request = new globalThis.window.XMLHttpRequest();

      request.open("POST", "https://example.test/foreign-buffer");
      Reflect.apply(Reflect.get(request, "send"), request, [foreignBuffer]);

      expect(foreignBuffer).not.toBeInstanceOf(globalThis.ArrayBuffer);
      expect(engine.getMessages()[0]?.payload).toBeInstanceOf(globalThis.ArrayBuffer);
      expect(engine.getMessages()[0]?.size).toBe(3);
    } finally {
      iframe.remove();
    }
  });

  it("closes with fallback metadata when response observation fails", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });

    installXmlHttpRequestInterceptor({
      engine,
      target: globalThis.window,
    });

    const request = new globalThis.window.XMLHttpRequest();

    request.open("GET", "https://example.test/response-metadata");
    request.send();
    Reflect.set(request, "getResponseHeader", () => {
      throw new Error("headers unavailable");
    });
    Object.defineProperty(request, "status", {
      configurable: true,
      get() {
        throw new Error("status unavailable");
      },
    });

    expect(() => {
      request.dispatchEvent(new globalThis.ProgressEvent("load"));
      request.dispatchEvent(new globalThis.ProgressEvent("loadend"));
    }).not.toThrow();
    expect(engine.getConnections()[0]).toEqual(
      expect.objectContaining({
        state: "closed",
        metadata: expect.objectContaining({
          contentType: null,
          outcome: "load",
          status: 0,
        }),
      }),
    );
  });

  it("does not coerce open inputs again after the native call succeeds", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });
    let coercionCount = 0;
    const url = {
      toString() {
        coercionCount += 1;

        if (coercionCount > 1) {
          throw new Error("URL coerced more than once");
        }

        return "https://example.test/coercion";
      },
    };

    installXmlHttpRequestInterceptor({
      engine,
      target: globalThis.window,
    });

    const request = new globalThis.window.XMLHttpRequest();

    expect(() => Reflect.apply(Reflect.get(request, "open"), request, ["GET", url])).not.toThrow();
    expect(coercionCount).toBe(1);
  });

  it("does not retain an inner descriptor after URL conversion reenters open", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });

    installXmlHttpRequestInterceptor({
      engine,
      target: globalThis.window,
    });

    const request = new globalThis.window.XMLHttpRequest();
    let nested = false;
    const outerUrl = {
      toString() {
        if (!nested) {
          nested = true;
          request.open("POST", "https://example.test/conversion-inner");
        }

        return "https://example.test/conversion-outer";
      },
    };

    Reflect.apply(Reflect.get(request, "open"), request, ["GET", outerUrl]);
    request.send("outer-body");

    expect(Reflect.get(request, "openedWith")).toEqual({
      method: "GET",
      url: "https://example.test/conversion-outer",
      async: true,
    });
    expect(engine.getConnections()).toEqual([]);
    expect(engine.getMessages()).toEqual([]);
  });
});
