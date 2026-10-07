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

  it("keeps the same 30px footer row height on mobile", () => {
    const mobile = css.slice(css.indexOf("@media (max-width: 560px)"));

    expect(ruleBody(".site-footer a")).toMatch(/min-height:\s*30px\s*;/);
    expect(ruleBody(".site-footer__cookie-trigger")).toMatch(/min-height:\s*30px\s*;/);
    expect(mobile).not.toMatch(/\.site-footer(?: a|__cookie-trigger)\s*[,\{]/);
  });
});
