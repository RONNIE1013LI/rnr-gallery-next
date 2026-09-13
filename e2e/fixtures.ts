import { test as base, expect } from "@playwright/test";

export const test = base.extend<{ previewProtection: void }>({
  previewProtection: [async ({ context, baseURL }, use) => {
    const token = process.env.RNR_E2E_PREVIEW_BYPASS;
    if (baseURL && new URL(baseURL).hostname === "staging.rnrgallery.com" && token) {
      await context.route("https://staging.rnrgallery.com/**", async (route) => {
        await route.continue({ headers: { ...route.request().headers(), "x-vercel-protection-bypass": token } });
      });
    }
    await use();
  }, { auto: true }],
});
export { expect };
