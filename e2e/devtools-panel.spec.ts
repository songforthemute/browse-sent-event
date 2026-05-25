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
