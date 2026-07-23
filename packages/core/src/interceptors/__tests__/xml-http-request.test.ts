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
  }

  send(body: Document | XMLHttpRequestBodyInit | null = null): void {
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

  it("records a request opened with a URL object", () => {
    const engine = createDevtoolsEngine({ capacity: 10 });

    installXmlHttpRequestInterceptor({
      engine,
      target: globalThis.window,
    });

    const request = new globalThis.window.XMLHttpRequest();

    request.open("GET", new globalThis.URL("/items", "https://example.test"));
    request.send();

    expect(engine.getConnections()).toEqual([
      expect.objectContaining({
        protocol: "xhr",
        url: "https://example.test/items",
      }),
    ]);
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
});
