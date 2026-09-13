import { expect, test } from "./fixtures";

for (const width of [1366, 768, 390]) {
 for (const days of [3, 1]) {
  test(`Staging AU address and carrier review preserves configured ${days}-day service at ${width}px`, async ({ page, baseURL }) => {
    test.skip(new URL(baseURL!).hostname !== "staging.rnrgallery.com", "Requires isolated Staging checkout services");
    await page.setViewportSize({ width, height: width === 768 ? 1024 : 844 });
    await page.goto("/au/products/custom-themed-wall-banner/configure");
    await page.getByRole("button", { name: "Next: step 2", exact: true }).click();
    await page.getByLabel("Send Photos After Ordering", { exact: false }).check();
    await page.getByRole("button", { name: /Timing and delivery/ }).click();
    await page.getByLabel("When do you need the finished item?").fill("2026-01-01");
    await page.getByLabel("Production service", { exact: true }).selectOption(String(days));
    await page.getByRole("button", { name: "Review your order", exact: true }).click();
    await page.getByRole("button", { name: "Add to Cart — Send Photos Later", exact: true }).click();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("rnr:commerce:v1:guest:cart")!).items[0]);
    expect(saved.urgentServiceConfirmed).toBe(days < 3);
    await page.goto("/cart");
    await page.getByRole("link", { name: "Continue to checkout", exact: true }).click();
    await page.getByRole("link", { name: "Continue as Guest", exact: true }).click();
    await page.getByLabel("Full name (required)").fill("Staging UI verification");
    await page.getByLabel("Email address (required)").fill("staging-ui@example.test");
    await page.getByLabel("Phone (required)").fill("0412345678");
    await page.getByLabel("Street address (required)").fill("1 Test Street");
    for (const [suburb, state, postcode] of [["Sydney", "NSW", "2000"], ["Alice Springs", "NT", "0870"]]) {
      await page.getByLabel("Suburb (required)").fill(suburb);
      await page.getByLabel("State / territory (required)").selectOption(state);
      await page.getByLabel("Postcode (required)").fill(postcode);
      const sessionResponse = page.waitForResponse(response => response.url().endsWith("/api/checkout/session") && response.request().method() === "POST");
      await page.getByRole("button", { name: "Review delivery & totals" }).click();
      const response = await sessionResponse;
      expect(response.status()).toBe(200);
      const item = (await response.json()).checkout.cart.items[0];
      expect(item).toMatchObject({ urgentServiceConfirmed: days < 3, urgentService: { workingDays: days, feeInclGstCents: saved.urgentFeeInclGstCents } });
      await expect(page.getByText(`${days < 3 ? "Rush" : "Non-Rush"} · ${days} working ${days === 1 ? "day" : "days"}`, { exact: true })).toBeVisible();
      for (const code of ["au-dhl-express", "au-standard"]) {
        await page.locator(`input[name="shippingService"][value="${code}"]`).check();
        await expect(page.getByRole("button", { name: "Continue to secure card payment", exact: true })).toBeEnabled();
        await expect(page.getByText(`${days < 3 ? "Rush" : "Non-Rush"} · ${days} working ${days === 1 ? "day" : "days"}`, { exact: true })).toBeVisible();
      }
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem("rnr:commerce:v1:guest:cart")!).items[0])).toEqual(saved);
    }
    await page.screenshot({ path: `output/playwright/after-staging/rush-au-review-${width}-${days}.png`, fullPage: true });
    // Stop before creating an order or payment session.
  });
}
}
