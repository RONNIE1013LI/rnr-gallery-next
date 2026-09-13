import { defineConfig } from "@playwright/test";

const baseURL = process.env.RNR_E2E_BASE_URL ?? "http://localhost:3413";
const url = new URL(baseURL);
if (!["localhost", "127.0.0.1", "staging.rnrgallery.com"].includes(url.hostname)) {
  throw new Error("E2E requires a local or isolated Preview target; Production is not allowed.");
}

export default defineConfig({
  testDir: "./e2e",
  outputDir: "output/playwright/e2e-results",
  reporter: [["list"], ["html", { outputFolder: "output/playwright/e2e-report", open: "never" }]],
  use: {
    baseURL,
    channel: "chrome",
    viewport: { width: 1366, height: 936 },
    screenshot: "only-on-failure",
    trace: url.hostname === "staging.rnrgallery.com" ? "off" : "retain-on-failure",
  },
});
