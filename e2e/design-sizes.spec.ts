import { expect, test } from "./fixtures";

for (const width of [1366, 1024, 768, 430, 390]) {
  test(`design sizes stay separate and within their container at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 1024 });
    await page.goto("/design-gallery?design_type=canvas");
    const design = page.locator('a[href^="/designs/"]').first();
    await expect(design).toBeVisible();
    await design.click();
    const sizes = page.getByRole("list", { name: "Available sizes" });
    await expect(sizes).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`sizes-${width}.png`), fullPage: true });
    const boxes = await sizes.locator("li").evaluateAll((items) => items.map((item) => {
      const range = document.createRange(); range.selectNodeContents(item);
      const text = range.getBoundingClientRect();
      const container = item.parentElement!.getBoundingClientRect();
      return { top: text.top, bottom: text.bottom, right: text.right, containerRight: container.right };
    }));
    expect(boxes.length).toBeGreaterThan(1);
    for (let index = 0; index < boxes.length; index++) {
      expect(boxes[index].right).toBeLessThanOrEqual(boxes[index].containerRight + 1);
      if (index > 0) expect(boxes[index].top).toBeGreaterThanOrEqual(boxes[index - 1].bottom);
    }
  });
}
