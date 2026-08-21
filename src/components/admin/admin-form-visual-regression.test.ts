import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const adminCss = readFileSync("src/components/admin/admin.module.css", "utf8");
const formsCss = readFileSync("src/components/forms/forms.module.css", "utf8");

function cssRule(source: string, selector: string) {
  const start = source.indexOf(`${selector} {`);
  expect(start, `${selector} should exist`).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf("}", start) + 1);
}

describe("Admin form visual refinements", () => {
  it("keeps form actions in document flow so they cannot cover fields", () => {
    expect(cssRule(adminCss, ".formSubmitBar")).toContain("position: static;");
    expect(cssRule(adminCss, ".reviewFormActions")).toContain("position: static;");
  });

  it("uses readable touch-safe invoice controls", () => {
    expect(adminCss).toMatch(/\.invoiceWorkspaceEditor label\s*\{[\s\S]*?font-size:\s*12px;/);
    expect(adminCss).toMatch(/\.invoiceWorkspaceEditor input,\s*\.invoiceWorkspaceEditor textarea\s*\{[\s\S]*?min-height:\s*44px;/);
    expect(cssRule(adminCss, ".invoiceWorkspaceHeader button:not(.secondaryAdminButton),\n  .invoiceWorkspaceHeader .secondaryAdminButton")).toContain("min-height: 44px;");
  });

  it("keeps manual entry controls touch friendly on narrow screens", () => {
    const mobile = formsCss.slice(formsCss.lastIndexOf("@media (max-width: 720px)"));
    expect(mobile).toMatch(/\.formEntryPage input,[\s\S]*?min-height:\s*44px;/);
  });

  it("lets mobile Order Entry fill the viewport with a compact visible close control", () => {
    const mobile = formsCss.slice(formsCss.indexOf("@media (max-width: 700px)"));
    expect(mobile).toMatch(/\.orderEntryDrawer\s*\{[\s\S]*?max-width:\s*100vw;[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/);
    expect(mobile).toMatch(/\.orderEntryResizeHandle\s*\{[\s\S]*?display:\s*none;/);
    expect(mobile).toMatch(/\.orderEntryDrawer \.drawerHeader button::before\s*\{[\s\S]*?width:\s*32px;[\s\S]*?height:\s*32px;/);
  });

  it("uses a compact mobile search row and a full-screen filter workspace", () => {
    const mobile = formsCss.slice(formsCss.lastIndexOf("@media (max-width: 720px)"));
    expect(mobile).toMatch(/\.listToolbar\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s*48px;/);
    expect(mobile).toMatch(/\.filterPanel\s*\{[\s\S]*?inset:\s*0;[\s\S]*?width:\s*100vw;[\s\S]*?height:\s*100dvh;/);
  });
});
