import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    css: { include: /storefront\.module\.css$/ },
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
