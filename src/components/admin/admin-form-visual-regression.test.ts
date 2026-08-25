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
  it("keeps mobile Forms buttons compact without shrinking form fields", () => {
    const shell = cssRule(formsCss, ".shell");
    const statsMobile = formsCss.slice(formsCss.indexOf("@media (max-width: 600px)"));
    const workbenchMobile = formsCss.slice(formsCss.indexOf("@media (max-width: 720px)"));

    expect(shell).toContain("--forms-control-height-mobile: 48px;");
    expect(shell).toContain("--forms-button-height-mobile: 40px;");
    expect(statsMobile).toMatch(/\.statsPageToolbar button\s*\{[\s\S]*?min-height:\s*var\(--forms-button-height-mobile\);/);
    expect(statsMobile).toMatch(/\.statsReportActions button\s*\{[\s\S]*?min-height:\s*var\(--forms-button-height-mobile\);/);
    expect(workbenchMobile).toMatch(/\.signOutControl button,[\s\S]*?\.orderCard header button\s*\{[\s\S]*?min-height:\s*var\(--forms-button-height-mobile\);/);
  });

  it("keeps mobile order cards only slightly taller than their text", () => {
    const mobile = formsCss.slice(formsCss.lastIndexOf("@media (max-width: 680px)"));

    expect(cssRule(mobile, ".orderCard header button")).toContain("min-height: 32px;");
    expect(cssRule(mobile, ".orderCard dl")).toContain("gap: 2px 5px;");
    expect(cssRule(mobile, ".orderCard dd")).toContain("min-height: 30px;");
    expect(cssRule(mobile, ".orderCard dd")).toContain("padding: 3px 7px;");
  });

  it("matches the mobile search controls to the compact order field height", () => {
    const mobile = formsCss.slice(formsCss.lastIndexOf("@media (max-width: 720px)"));
    const searchControls = cssRule(mobile, ".quickSearch input,\n  .quickSearch button,\n  .filterButton");

    expect(searchControls).toContain("height: 30px;");
    expect(searchControls).toContain("min-height: 30px;");
  });

  it("keeps the manual-order summary in two columns on phones", () => {
    const mobile = adminCss.slice(adminCss.lastIndexOf("@media (max-width: 680px)"));
    const summary = cssRule(mobile, ".manualEntryForm .formRecordSummary");
    const fields = cssRule(mobile, ".manualEntryForm .formRecordSummary > div");
    const oddFields = cssRule(mobile, ".manualEntryForm .formRecordSummary > div:nth-child(odd)");
    const lastRow = cssRule(mobile, ".manualEntryForm .formRecordSummary > div:nth-last-child(-n + 2)");

    expect(summary).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
    expect(fields).toContain("padding: 6px 8px;");
    expect(oddFields).toContain("border-right: 1px solid var(--admin-border);");
    expect(lastRow).toContain("border-bottom: 0;");
  });

  it("keeps form actions in document flow so they cannot cover fields", () => {
    expect(cssRule(adminCss, ".formSubmitBar")).toContain("position: static;");
    expect(cssRule(adminCss, ".reviewFormActions")).toContain("position: static;");
  });

  it("keeps the new manual-order submit action at the bottom of the page", () => {
    const manualActions = cssRule(adminCss, ".manualEntryForm .formSubmitBar");
    const createButton = cssRule(adminCss, ".manualEntryCreateForm .formSubmitBar button");
    const mobile = adminCss.slice(adminCss.lastIndexOf("@media (max-width: 680px)"));
    const mobileCreateActions = cssRule(mobile, ".manualEntryCreateForm .formSubmitBar");
    const mobileCreateButton = cssRule(mobile, ".manualEntryCreateForm .formSubmitBar button");

    expect(manualActions).toContain("position: static;");
    expect(adminCss).not.toMatch(/\.manualEntryCreateForm\s*\{[^}]*padding-bottom:/);
    expect(adminCss).not.toMatch(/\.manualEntryCreateForm \.formSubmitBar\s*\{[^}]*position:\s*fixed;/);
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
    expect(cssRule(mobile, ".formEntryPage input,\n  .formEntryPage select,\n  .formEntryPage textarea"))
      .toContain("min-height: var(--forms-control-height-mobile);");
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

  it("lets mobile Order Entry fill the viewport with compact 30px header actions", () => {
    const mobile = formsCss.slice(formsCss.indexOf("@media (max-width: 700px)"));
    const openFullEditor = cssRule(mobile, ".orderEntryDrawer .drawerHeader a");
    const closeButton = cssRule(mobile, ".orderEntryDrawer .drawerHeader button");
    const closeButtonFocus = cssRule(mobile, ".orderEntryDrawer .drawerHeader button:focus-visible");

    expect(mobile).toMatch(/\.orderEntryDrawer\s*\{[\s\S]*?max-width:\s*100vw;[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/);
    expect(mobile).toMatch(/\.orderEntryResizeHandle\s*\{[\s\S]*?display:\s*none;/);
    expect(openFullEditor).toContain("box-sizing: border-box;");
    expect(openFullEditor).toContain("height: 30px;");
    expect(openFullEditor).toContain("min-height: 30px;");
    expect(closeButton).toContain("border: 1px solid var(--forms-border);");
    expect(closeButton).toContain("border-radius: 50%;");
    expect(closeButton).toContain("background: #fff;");
    expect(closeButton).toContain("width: var(--forms-button-height-mobile);");
    expect(closeButton).toContain("height: var(--forms-button-height-mobile);");
    expect(closeButtonFocus).toContain("outline: 0;");
    expect(closeButtonFocus).toContain("box-shadow: inset 0 0 0 2px var(--forms-focus);");
    expect(mobile).not.toMatch(/\.orderEntryDrawer \.drawerHeader button::before\s*\{/);
    expect(cssRule(mobile, ".orderEntryDrawer .orderEntryDrawerPanel .orderEntryDrawerContent button"))
      .toContain("min-height: var(--forms-button-height-mobile);");
    expect(cssRule(mobile, ".orderEntryDrawer .orderEntryDrawerPanel .orderEntryDrawerContent a"))
      .toContain("min-height: var(--forms-button-height-mobile);");
  });

  it("uses a compact mobile search row and a downward filter popover", () => {
    const mobile = formsCss.slice(formsCss.lastIndexOf("@media (max-width: 720px)"));
    const filterPanel = cssRule(mobile, ".filterPanel");
    const filterBackdrop = cssRule(mobile, ".filterBackdrop");
    expect(mobile).toMatch(/\.listToolbar\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s*48px;/);
    expect(filterPanel).toContain("position: absolute;");
    expect(filterPanel).toContain("top: calc(100% + 6px);");
    expect(filterPanel).toContain("right: 0;");
    expect(filterPanel).toContain("bottom: auto;");
    expect(filterPanel).toContain("box-sizing: border-box;");
    expect(filterPanel).toContain("max-height: min(58dvh, 520px);");
    expect(cssRule(mobile, ".filterPanel input,\n  .filterPanel select")).toContain("box-sizing: border-box;");
    expect(filterPanel).not.toContain("height: 100dvh;");
    expect(filterBackdrop).toContain("background: rgb(15 23 42 / 16%);");
  });

  it("centres a round mobile back-to-top action without exposing it on desktop", () => {
    const base = cssRule(formsCss, ".mobileBackToTop");
    const mobile = formsCss.slice(formsCss.lastIndexOf("@media (max-width: 720px)"));
    const mobileAction = cssRule(mobile, ".mobileBackToTop");

    expect(base).toContain("display: none;");
    expect(mobileAction).toContain("display: grid;");
    expect(mobileAction).toContain("position: fixed;");
    expect(mobileAction).toContain("top: 50%;");
    expect(mobileAction).toContain("left: 50%;");
    expect(mobileAction).toContain("border-radius: 50%;");
  });

  it("keeps each mobile filter condition compact with a row-local remove control", () => {
    const mobile = formsCss.slice(formsCss.lastIndexOf("@media (max-width: 720px)"));
    expect(mobile).toMatch(/\.filterRow\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)\s*var\(--forms-filter-control-height-mobile\);/);
    expect(mobile).toMatch(/\.filterRow > :nth-child\(3\)\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*3;/);
    expect(mobile).toMatch(/\.filterRow > button\s*\{[\s\S]*?width:\s*var\(--forms-filter-control-height-mobile\);[\s\S]*?grid-column:\s*3;/);
    expect(mobile).toMatch(/\.savedSearchWorkspace \.personalViews input\s*\{[\s\S]*?width:\s*100%;/);
  });

  it("styles the native upload surface without replacing the file input", () => {
    expect(adminCss).toMatch(/input\[type="file"\]::file-selector-button[\s\S]*?min-height:\s*32px;/);
  });

  it("keeps manual-order payment proof thumbnails compact on desktop and mobile", () => {
    const manualProofs = cssRule(adminCss, ".manualEntryForm .paymentProofPreviewGrid");
    const mobile = adminCss.slice(adminCss.lastIndexOf("@media (max-width: 680px)"));
    const mobileDelete = cssRule(
      mobile,
      ".manualEntryForm .paymentProofPreviewGrid .paymentProofPreviewCard button.paymentProofDeleteButton",
    );

    expect(manualProofs).toContain("grid-template-columns: repeat(auto-fill, 96px);");
    expect(manualProofs).toContain("justify-content: start;");
    expect(mobileDelete).toContain("width: 22px;");
    expect(mobileDelete).toContain("height: 22px;");
    expect(mobileDelete).toContain("min-width: 22px;");
    expect(mobileDelete).toContain("min-height: 22px;");
    expect(mobileDelete).toContain("border-radius: 50%;");
  });
});
