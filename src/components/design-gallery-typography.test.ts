import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Design Gallery card typography", () => {
  it("uses the site default body font for artwork card titles", () => {
    const css = fs.readFileSync(
      path.join(process.cwd(), "src/components/storefront.module.css"),
      "utf8",
    );
    const rule = css.match(/\.galleryCardBody h2\s*\{([\s\S]*?)\}/);

    expect(rule?.[1]).toBeDefined();
    expect(rule?.[1]).toMatch(/font-family:\s*var\(--font-body\)\s*;/);
    expect(rule?.[1]).not.toMatch(/font-family:\s*var\(--font-display\)\s*;/);
  });
});
