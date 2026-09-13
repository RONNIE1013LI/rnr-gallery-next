import { expect, test } from "./fixtures";

test("guest navigation changes URL and renders checkout form without reloading", async ({ page }) => {
  await page.goto("/products/custom-themed-wall-banner/configure");
  await page.getByRole("button", { name: "Next: step 2", exact: true }).click();
  await page.getByLabel("Send Photos After Ordering", { exact: false }).check();
  await page.getByRole("button", { name: "Review your order", exact: true }).click();
  await page.getByRole("button", { name: "Add to Cart — Send Photos Later", exact: true }).click();
  await page.goto("/cart");
  await expect(page.getByRole("heading", { name: "Custom Themed Wall Banner", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Continue to checkout", exact: true }).click();
  await expect(page).toHaveURL(/\/checkout\/start$/);
  await page.evaluate(() => { (window as Window & { checkoutDocumentMarker?: boolean }).checkoutDocumentMarker = true; });
  await page.getByRole("link", { name: "Continue as Guest", exact: true }).click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.getByRole("heading", { name: "Checkout", exact: true })).toBeVisible();
  await expect(page.getByRole("form", { name: "Checkout details" })).toBeVisible();
  await expect(page.getByLabel("Full name (required)")).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { checkoutDocumentMarker?: boolean }).checkoutDocumentMarker)).toBe(true);
  await page.getByRole("button", { name: "Review delivery & totals" }).click();
  await expect(page.getByRole("alert", { name: "Check your details" })).toBeFocused();
  await page.getByRole("link", { name: "Contact details: Full name" }).click();
  await expect(page.getByLabel("Full name (required)")).toBeFocused();
});
