import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = fs.readFileSync(
  path.join(process.cwd(), "src/components/storefront.module.css"),
  "utf8",
);

function designDetailTitleRule() {
  const match = css.match(/\.designDetailCopy h1\s*\{([\s\S]*?)\}/);
  expect(match?.[1], ".designDetailCopy h1 rule should exist").toBeDefined();
  return match?.[1] ?? "";
}

describe("Design detail title typography", () => {
  it("uses the site's standard display-heading typography", () => {
    const rule = designDetailTitleRule();

    expect(rule).toMatch(/font-family:\s*var\(--font-display\)\s*;/);
    expect(rule).toMatch(/font-size:\s*var\(--type-purchase\)\s*;/);
    expect(rule).toMatch(/font-weight:\s*650\s*;/);
    expect(rule).toMatch(/letter-spacing:\s*-0\.045em\s*;/);
    expect(rule).toMatch(/line-height:\s*1\.02\s*;/);
  });

  it("preserves the existing spacing above the title", () => {
    expect(designDetailTitleRule()).toMatch(/margin-top:\s*0\.8rem\s*;/);
  });
});
