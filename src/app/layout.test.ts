import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { metadata } from "./layout";

function cssFile(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function cssRule(source: string, selector: string) {
  const start = source.indexOf(selector);
  expect(start, `Missing CSS selector: ${selector}`).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf("}", start) + 1);
}

describe("root layout metadata", () => {
  it("uses the current R&R Gallery mark for browser and Apple icons", () => {
    expect(metadata.icons).toEqual({
      icon: "/media/brand/rr-gallery-logo-2026.webp",
      apple: "/media/brand/rr-gallery-logo-2026.webp",
    });
  });

  it("reserves the vertical scrollbar gutter so page changes do not shift the site frame", () => {
    const globals = cssFile("src/app/globals.css");

    expect(cssRule(globals, "html {")).toContain("scrollbar-gutter: stable;");
  });

  it("prevents iOS from rewriting server-rendered contact details before hydration", () => {
    expect(metadata.formatDetection).toEqual({
      address: false,
      email: false,
      telephone: false,
    });
  });

  it("uses one capsule radius for text action buttons across every site surface", () => {
    const globals = cssFile("src/app/globals.css");
    const storefront = cssFile("src/components/storefront.module.css");
    const admin = cssFile("src/components/admin/admin.module.css");
    const forms = cssFile("src/components/forms/forms.module.css");

    expect(globals).toContain("--radius-button: 999px;");
    for (const [source, selector] of [
      [storefront, ".primaryButton,\n.secondaryButton {"],
      [storefront, ".checkoutContinuation .socialAuthButton,"],
      [storefront, ".socialAuthButton {\n  width: 100%;"],
      [admin, ".primaryAdminButton {"],
      [admin, ".filterActions button,"],
      [admin, ".secondaryAdminButton,\n.removeItemButton {"],
      [forms, ".signOutControl button,"],
      [forms, ".formsErrorState a,"],
      [forms, ".filterButton,"],
      [forms, ".addFilterButton,"],
    ] as const) {
      expect(cssRule(source, selector)).toContain("border-radius: var(--radius-button);");
    }
  });

  it("preserves the approved morning mobile-menu trigger and close treatment", () => {
    const globals = cssFile("src/app/globals.css");
    const trigger = cssRule(globals, ".mobile-menu > button {");
    const openTrigger = cssRule(globals, ".mobile-menu--open > button {");

    expect(trigger).toContain("width: 52px;");
    expect(trigger).toContain("height: 56px;");
    expect(trigger).toContain("background: transparent;");
    expect(trigger).toContain("border: 1px solid transparent;");
    expect(openTrigger).toContain("color: var(--text-on-dark);");
    expect(openTrigger).toContain("border-color: transparent;");

    const openHeader = cssRule(globals, ".site-header--menu-open {");
    expect(openHeader).toContain("background: var(--brand-green);");
    expect(openHeader).toContain("-webkit-backdrop-filter: none;");
    expect(openHeader).toContain("backdrop-filter: none;");

    const backdrop = cssRule(globals, ".mobile-menu > .mobile-menu__backdrop {");
    expect(backdrop).toContain("position: fixed;");
    expect(backdrop).toContain("width: auto;");
    expect(backdrop).toContain("height: calc(100dvh - 5.25rem);");
    expect(backdrop).toContain("-webkit-backdrop-filter: saturate(80%) blur(8px);");
    expect(backdrop).toContain("backdrop-filter: saturate(80%) blur(8px);");
  });

  it("uses the approved shared Header and Footer brand-frame tokens", () => {
    const globals = cssFile("src/app/globals.css");

    expect(globals).toContain("--brand-green: #142b25;");
    expect(globals).toContain("--brand-ivory: #faf5ef;");
    expect(globals).toContain("--brand-gold: #b89a62;");
    expect(globals).toContain("--brand-ivory-hover: #eee7de;");
    expect(globals).toContain("--text-on-dark: #f5f1eb;");
    expect(globals).toContain("--text-on-dark-muted: #cfc8be;");
    expect(cssRule(globals, ".site-header {")).toContain("background: var(--brand-green);");
    expect(cssRule(globals, ".site-footer {")).toContain("background: var(--brand-green);");
  });

  it("stacks admin page-header actions at the tablet breakpoint", () => {
    const admin = cssFile("src/components/admin/admin.module.css");
    const mobileStart = admin.lastIndexOf("@media (max-width: 560px) {");
    const tabletStart = admin.lastIndexOf("@media (max-width: 820px) {", mobileStart);

    expect(tabletStart).toBeGreaterThanOrEqual(0);
    expect(mobileStart).toBeGreaterThan(tabletStart);

    const tablet = admin.slice(tabletStart, mobileStart);
    expect(tablet).toContain(".productionPageHeader {\n    display: grid;");
    expect(tablet).toContain(".productionPageHeader .headerActions {\n    justify-content: flex-start;");
  });
});
