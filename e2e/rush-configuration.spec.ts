import { expect, test } from "./fixtures";

for (const days of [3, 1]) {
  test(`configured ${days === 3 ? "non-rush" : "rush"} survives cart and guest checkout with a past event date`, async ({ page }) => {
    await page.goto("/products/custom-themed-wall-banner/configure");
    await page.getByRole("button", { name: "Next: step 2", exact: true }).click();
    await page.getByLabel("Send Photos After Ordering", { exact: false }).check();
    await page.getByRole("button", { name: /Timing and delivery/ }).click();
    await page.getByLabel("Production service", { exact: true }).selectOption(String(days));
    await page.getByLabel("When do you need the finished item?").fill("2026-01-01");
    await page.getByRole("button", { name: "Review your order", exact: true }).click();
    await page.getByRole("button", { name: "Add to Cart — Send Photos Later", exact: true }).click();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("rnr:commerce:v1:guest:cart")!).items[0]);
    expect(saved).toMatchObject({ productionWorkingDays: days, urgentServiceConfirmed: days < 3, eventDate: "2026-01-01" });
    if (days === 3) expect(saved.urgentFeeInclGstCents).toBe(0);
    else expect(saved.urgentFeeInclGstCents).toBeGreaterThan(0);
    await page.goto("/cart");
    await expect(page.getByText(`${days} working days`, { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Continue to checkout", exact: true }).click();
    await page.getByRole("link", { name: "Continue as Guest", exact: true }).click();
    await expect(page.getByRole("form", { name: "Checkout details" })).toBeVisible();
    await page.getByLabel("Full name (required)").fill("UI Test");
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem("rnr:commerce:v1:guest:cart")!).items[0]);
    expect(after).toEqual(saved);
    await page.screenshot({ path: `output/playwright/after-local-fixtures/checkout-${days}-day-service.png`, fullPage: true });
  });
}
