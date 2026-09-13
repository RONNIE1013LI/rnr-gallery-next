import { expect, test } from "./fixtures";

for (const [width, height] of [[390, 844], [430, 932], [768, 1024], [1024, 1366], [1366, 936]]) {
  test(`gallery cards and filters remain usable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.goto("/design-gallery");
    const cards = page.locator('article').filter({ has: page.locator('a[href^="/designs/"]') });
    await expect(cards.first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`gallery-${width}.png`), fullPage: true });
    const headings = cards.locator('h2');
    await expect(headings.first()).toBeVisible();
    const media = await cards.locator('a > div:first-child').evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height));
    expect(Math.max(...media) - Math.min(...media)).toBeLessThan(2);
    await page.getByRole('button', { name: /^Filters/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Filter designs' });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    await page.screenshot({ path: testInfo.outputPath(`filters-${width}.png`) });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /^Filters/ })).toBeFocused();
  });
}
