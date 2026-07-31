import { expect, test } from "@playwright/test";

const shouldAssertVisualSnapshot = !process.env.CI;

test("mounts the closed-shadow DevTools panel host", async ({ page }) => {
  await page.goto("/");

  const panel = page.locator("bse-devtools-panel");

  await expect(panel).toHaveCount(1);
  await expect(panel).not.toHaveAttribute("open", "");
});

test("applies runtime options from the Vite plugin", async ({ page }) => {
  await page.goto("/");

  const panel = page.locator("bse-devtools-panel");

  await expect(panel).not.toHaveAttribute("open", "");
  await page.keyboard.press("Control+Alt+B");
  await expect(panel).toHaveAttribute("open", "");

  const result = await page.evaluate(async () => {
    const fixture = Reflect.get(globalThis, "__bseFixture");
    const runtime = Reflect.get(globalThis, "__browseSentEventRuntime__");

    if (typeof fixture !== "object" || fixture === null) {
      throw new Error("Fixture bridge is missing");
    }

    if (typeof runtime !== "object" || runtime === null) {
      throw new Error("Runtime is missing");
    }

    const runIgnoredFetchStream = Reflect.get(fixture, "runIgnoredFetchStream");

    if (typeof runIgnoredFetchStream !== "function") {
      throw new Error("Ignored fetch fixture bridge is missing");
    }

    return {
      capacity: Reflect.get(runtime, "capacity"),
      ignoredFetch: await runIgnoredFetchStream(),
    };
  });

  expect(result.capacity).toBe(25);
  expect(result.ignoredFetch.payload).toBe("ignored stream response");
  expect(result.ignoredFetch.after).toEqual(result.ignoredFetch.before);
});

test("renders seeded transport data in the panel", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Seed panel" }).click();

  const panel = page.locator("bse-devtools-panel");
  const counts = await page.evaluate(() => {
    const fixture = Reflect.get(globalThis, "__bseFixture");

    if (typeof fixture !== "object" || fixture === null) {
      throw new Error("Fixture bridge is missing");
    }

    const getSnapshotCounts = Reflect.get(fixture, "getSnapshotCounts");

    if (typeof getSnapshotCounts !== "function") {
      throw new Error("Fixture counts bridge is missing");
    }

    return getSnapshotCounts();
  });
  const box = await panel.boundingBox();

  expect(counts).toEqual({ connections: 1, messages: 2 });
  await expect(panel).toHaveAttribute("open", "");
  expect(box?.width).toBeGreaterThan(300);
  expect(box?.height).toBeGreaterThan(300);

  if (shouldAssertVisualSnapshot) {
    await expect(panel).toHaveScreenshot("devtools-panel-seeded.png", {
      animations: "disabled",
    });
  }
});

test("records fetch stream and EventSource messages in a real browser", async ({ page }) => {
  await page.goto("/");

  const counts = await page.evaluate(async () => {
    const fixture = Reflect.get(globalThis, "__bseFixture");

    if (typeof fixture !== "object" || fixture === null) {
      throw new Error("Fixture bridge is missing");
    }

    const runFetchStream = Reflect.get(fixture, "runFetchStream");
    const runEventSource = Reflect.get(fixture, "runEventSource");
    const getSnapshotCounts = Reflect.get(fixture, "getSnapshotCounts");

    if (
      typeof runFetchStream !== "function" ||
      typeof runEventSource !== "function" ||
      typeof getSnapshotCounts !== "function"
    ) {
      throw new Error("Transport fixture bridge is missing");
    }

    await runFetchStream();
    await runEventSource();

    return getSnapshotCounts();
  });

  expect(counts.connections).toBeGreaterThanOrEqual(2);
  expect(counts.messages).toBeGreaterThanOrEqual(2);
});

test("records WebSocket messages in a real browser", async ({ page }) => {
  await page.goto("/");

  const counts = await page.evaluate(async (url) => {
    const fixture = Reflect.get(globalThis, "__bseFixture");

    if (typeof fixture !== "object" || fixture === null) {
      throw new Error("Fixture bridge is missing");
    }

    const runWebSocket = Reflect.get(fixture, "runWebSocket");
    const getSnapshotCounts = Reflect.get(fixture, "getSnapshotCounts");

    if (typeof runWebSocket !== "function" || typeof getSnapshotCounts !== "function") {
      throw new Error("WebSocket fixture bridge is missing");
    }

    await runWebSocket(url);

    return getSnapshotCounts();
  }, "ws://127.0.0.1:4175");

  expect(counts.connections).toBeGreaterThanOrEqual(1);
  expect(counts.messages).toBeGreaterThanOrEqual(2);
});

test("records XMLHttpRequest request and response in a real browser", async ({ page }) => {
  await page.goto("/");

  const capture = await page.evaluate(async () => {
    const fixture = Reflect.get(globalThis, "__bseFixture");

    if (typeof fixture !== "object" || fixture === null) {
      throw new Error("Fixture bridge is missing");
    }

    const runXmlHttpRequest = Reflect.get(fixture, "runXmlHttpRequest");
    const getXmlHttpRequestCapture = Reflect.get(fixture, "getXmlHttpRequestCapture");

    if (typeof runXmlHttpRequest !== "function" || typeof getXmlHttpRequestCapture !== "function") {
      throw new Error("XMLHttpRequest fixture bridge is missing");
    }

    await runXmlHttpRequest();

    return getXmlHttpRequestCapture();
  });

  expect(capture.connection).toMatchObject({
    protocol: "xhr",
    state: "closed",
    metadata: {
      method: "POST",
      outcome: "load",
      status: 200,
    },
  });
  expect(capture.messages).toEqual([
    expect.objectContaining({
      direction: "out",
      payloadPreview: '{"message":"xhr hello"}',
      type: "request",
    }),
    expect.objectContaining({
      direction: "in",
      payloadPreview: '{"message":"xhr goodbye"}',
      type: "response",
    }),
  ]);
});
