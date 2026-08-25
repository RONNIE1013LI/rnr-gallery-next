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

  it("keeps the new manual-order submit action visible on desktop and mobile", () => {
    const createForm = cssRule(adminCss, ".manualEntryCreateForm");
    const createActions = cssRule(adminCss, ".manualEntryCreateForm .formSubmitBar");
    const createButton = cssRule(adminCss, ".manualEntryCreateForm .formSubmitBar button");
    const mobile = adminCss.slice(adminCss.lastIndexOf("@media (max-width: 680px)"));
    const mobileCreateActions = cssRule(mobile, ".manualEntryCreateForm .formSubmitBar");
    const mobileCreateButton = cssRule(mobile, ".manualEntryCreateForm .formSubmitBar button");

    expect(createForm).toContain("padding-bottom: 88px;");
    expect(createActions).toContain("position: fixed;");
    expect(createActions).toContain("bottom: max(12px, env(safe-area-inset-bottom));");
    expect(createActions).toContain("inset-inline:");
    expect(createActions).toContain("z-index: 5;");
    expect(createActions).toContain("background: var(--admin-surface, #fff);");
    expect(createButton).toContain("background: var(--admin-accent, #345c45);");
    expect(createButton).toContain("color: #fff;");
    expect(mobileCreateActions).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(mobileCreateButton).toContain("justify-self: center;");
    expect(mobileCreateButton).toContain("width: min(100%, 280px);");
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

  it("keeps manual choice pills compact on phones", () => {
    const mobile = adminCss.slice(adminCss.lastIndexOf("@media (max-width: 680px)"));
    const options = cssRule(mobile, ".manualChoiceOptions");
    const option = cssRule(mobile, ".manualChoiceOption");
    const radio = cssRule(mobile, ".manualFieldRows .manualChoiceOption input");

    expect(options).toContain("gap: 4px;");
    expect(options).toContain("padding: 6px;");
    expect(option).toContain("min-height: 30px;");
    expect(option).toContain("padding: 5px 8px 5px 6px;");
    expect(option).toContain("font-size: 12px;");
    expect(radio).toContain("width: 14px;");
    expect(radio).toContain("min-height: 14px;");
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

  it("keeps each mobile filter condition compact with a row-local remove control", () => {
    const mobile = formsCss.slice(formsCss.lastIndexOf("@media (max-width: 720px)"));
    expect(mobile).toMatch(/\.filterRow\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)\s*44px;/);
    expect(mobile).toMatch(/\.filterRow > :nth-child\(3\)\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*3;/);
    expect(mobile).toMatch(/\.filterRow > button\s*\{[\s\S]*?width:\s*44px;[\s\S]*?grid-column:\s*3;/);
    expect(mobile).toMatch(/\.savedSearchWorkspace \.personalViews input\s*\{[\s\S]*?width:\s*100%;/);
  });

  it("styles the native upload surface without replacing the file input", () => {
    expect(adminCss).toMatch(/input\[type="file"\]::file-selector-button[\s\S]*?min-height:\s*32px;/);
  });
});
