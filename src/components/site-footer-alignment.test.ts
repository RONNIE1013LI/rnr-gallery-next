import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = fs.readFileSync(
  path.join(process.cwd(), "src/app/globals.css"),
  "utf8",
);

function ruleBody(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  expect(match?.[1], `${selector} should exist`).toBeDefined();
  return match?.[1] ?? "";
}

describe("Site footer customer-column alignment", () => {
  it("aligns Cookie preferences to the same desktop row height as footer links", () => {
    const footerLink = ruleBody(".site-footer a");
    const cookieTrigger = ruleBody(".site-footer__cookie-trigger");

    expect(footerLink).toMatch(/min-height:\s*30px\s*;/);
    expect(cookieTrigger).toMatch(/min-height:\s*30px\s*;/);
    expect(cookieTrigger).toMatch(/display:\s*inline-flex\s*;/);
    expect(cookieTrigger).toMatch(/align-items:\s*center\s*;/);
  });

  it("preserves the 36px mobile footer touch target", () => {
    const mobile = css.slice(css.indexOf("@media (max-width: 560px)"));

    expect(mobile).toMatch(
      /\.site-footer a,\s*\.site-footer__cookie-trigger\s*\{[\s\S]*?min-height:\s*36px\s*;/,
    );
  });
});
