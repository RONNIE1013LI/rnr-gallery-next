import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    css: { include: /(storefront|payment-request|customer-chat)\.module\.css$/ },
    environment: "jsdom",
    fileParallelism: !process.env.TEST_DATABASE_URL,
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: process.env.TEST_DATABASE_URL ? 15_000 : 5_000,
  },
});
