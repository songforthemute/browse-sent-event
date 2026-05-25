import { expect, test } from "@playwright/test";

test("mounts the closed-shadow DevTools panel host", async ({ page }) => {
  await page.goto("/");

  const panel = page.locator("bse-devtools-panel");

  await expect(panel).toHaveCount(1);
  await expect(panel).not.toHaveAttribute("open", "");
});

test("renders seeded transport data in the panel", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Seed panel" }).click();

  const panel = page.locator("bse-devtools-panel");
  const box = await panel.boundingBox();

  await expect(panel).toHaveAttribute("open", "");
  expect(box?.width).toBeGreaterThan(300);
  expect(box?.height).toBeGreaterThan(300);
  await expect(panel).toHaveScreenshot("devtools-panel-seeded.png", {
    animations: "disabled",
  });
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
