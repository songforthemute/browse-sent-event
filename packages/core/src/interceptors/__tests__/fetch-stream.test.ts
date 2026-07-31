import { afterEach, describe, expect, it, vi } from "vitest";
import { createDevtoolsEngine } from "../../runtime/engine.js";
import { installFetchStreamInterceptor } from "../fetch-stream.js";

const originalFetch = globalThis.window.fetch;

function createStreamResponse(chunks: string[], contentType = "text/plain"): Response {
  const encoder = new globalThis.TextEncoder();

  return new globalThis.Response(
    new globalThis.ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }

        controller.close();
      },
    }),
    {
      headers: {
        "content-type": contentType,
      },
    },
  );
}

function createResponseWithFailingClone(): Response {
  const response = createStreamResponse(["app response"]);
  const failingClone = new globalThis.Response(
    new globalThis.ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("tap failed"));
      },
    }),
    {
      headers: {
        "content-type": "text/plain",
      },
    },
  );

  Reflect.set(response, "clone", () => failingClone);

  return response;
}

function waitForStreamTap(): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}

describe("installFetchStreamInterceptor", () => {
  afterEach(() => {
    Reflect.set(globalThis.window, "fetch", originalFetch);
  });

  it("records readable stream chunks without consuming the app response", async () => {
    const engine = createDevtoolsEngine({ capacity: 10 });

    Reflect.set(globalThis.window, "fetch", () =>
      Promise.resolve(createStreamResponse(["first", "second"])),
    );

    installFetchStreamInterceptor({
      engine,
      target: globalThis.window,
    });

    const response = await globalThis.window.fetch("https://example.test/stream");

    await expect(response.text()).resolves.toBe("firstsecond");
    await waitForStreamTap();

    expect(engine.getConnections()).toEqual([
      expect.objectContaining({
        protocol: "fetch-stream",
        state: "closed",
        url: "https://example.test/stream",
      }),
    ]);
    expect(engine.getMessages()).toEqual([
      expect.objectContaining({ payloadPreview: "first" }),
      expect.objectContaining({ payloadPreview: "second" }),
    ]);
  });

  it("classifies text/event-stream fetch responses as eventsource", async () => {
    const engine = createDevtoolsEngine({ capacity: 10 });

    Reflect.set(globalThis.window, "fetch", () =>
      Promise.resolve(createStreamResponse(["data: hello\n\n"], "text/event-stream")),
    );

    installFetchStreamInterceptor({
      engine,
      target: globalThis.window,
    });

    const response = await globalThis.window.fetch("https://example.test/sse");

    await response.text();
    await waitForStreamTap();

    expect(engine.getConnections()[0]).toEqual(
      expect.objectContaining({
        protocol: "eventsource",
        metadata: expect.objectContaining({ source: "fetch" }),
      }),
    );
  });

  it("records clone stream failures without breaking the app response", async () => {
    const engine = createDevtoolsEngine({ capacity: 10 });

    Reflect.set(globalThis.window, "fetch", () =>
      Promise.resolve(createResponseWithFailingClone()),
    );

    installFetchStreamInterceptor({
      engine,
      target: globalThis.window,
    });

    const response = await globalThis.window.fetch("https://example.test/failing-stream");

    await expect(response.text()).resolves.toBe("app response");
    await waitForStreamTap();

    expect(engine.getConnections()).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({
          captureError: expect.stringContaining("tap failed"),
          captureStatus: "failed",
        }),
        state: "closed",
        url: "https://example.test/failing-stream",
      }),
    ]);
  });

  it("returns excluded fetch responses without cloning or recording them", async () => {
    const engine = createDevtoolsEngine({ capacity: 10 });
    const response = createStreamResponse(["native response"]);
    const clone = vi.spyOn(response, "clone");

    Reflect.set(globalThis.window, "fetch", () => Promise.resolve(response));

    installFetchStreamInterceptor({
      engine,
      shouldExcludeUrl: (url) => url.includes("/ignored"),
      target: globalThis.window,
    });

    const received = await globalThis.window.fetch("https://example.test/ignored");

    expect(received).toBe(response);
    await expect(received.text()).resolves.toBe("native response");
    expect(clone).not.toHaveBeenCalled();
    expect(engine.getConnections()).toEqual([]);
    expect(engine.getMessages()).toEqual([]);
  });
});
