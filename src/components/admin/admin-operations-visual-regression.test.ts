import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/components/admin/admin.module.css", "utf8");
const filterRoutes = [
  "src/app/admin/orders/page.tsx",
  "src/app/admin/jobs/page.tsx",
  "src/app/admin/customers/page.tsx",
  "src/app/admin/users/page.tsx",
  "src/app/admin/audit/page.tsx",
].map((path) => readFileSync(path, "utf8"));

function cssRule(source: string, selector: string) {
  const start = source.indexOf(`${selector} {`);
  expect(start, `${selector} should exist`).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf("}", start) + 1);
}

describe("Admin operational visual system", () => {
  it("uses the approved warm operational palette", () => {
    const shell = cssRule(css, ".shell");
    expect(shell).toContain("--admin-canvas: #f5f3ee;");
    expect(shell).toContain("--admin-ink: #1f2b24;");
    expect(shell).toContain("--admin-accent: #345c45;");
    expect(shell).toContain("--admin-response: #f8f8f4;");
  });

  it("keeps dashboard metrics compact and scannable", () => {
    const cards = cssRule(css, ".metricGrid article");
    expect(cards).toContain("gap: 6px;");
    expect(cards).toContain("padding: 14px;");
  });

  it("gives scrollable tables a visible keyboard focus state", () => {
    const focus = cssRule(css, ".tableScroll:focus-visible");
    expect(focus).toContain("outline: 2px solid var(--admin-accent);");
  });

  it("uses the shared accent for primary operational actions", () => {
    expect(cssRule(css, ".primaryAdminButton")).toContain("background: var(--admin-accent);");
    expect(cssRule(css, ".filterActions button,\n.filterActions a,\n.compactForm button")).toContain("background: var(--admin-accent);");
    expect(cssRule(css, ".formSubmitBar button")).toContain("background: var(--admin-accent);");
  });

  it("uses a two-column mobile summary and full-width action layout", () => {
    const contract = css.slice(css.indexOf("/* Unified backend responsive contract */"));
    expect(cssRule(contract, ".metricGrid")).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
    expect(cssRule(contract, ".pageHeader")).toContain("flex-direction: column;");
    expect(cssRule(contract, ".filterPanel")).toContain("grid-template-columns: 1fr;");
    expect(cssRule(contract, ".filterActions > *")).toContain("min-height: 44px;");
  });

  it("uses complete semantic borders instead of decorative side tabs", () => {
    expect(css).not.toMatch(/border-left:\s*3px solid/);
  });

  it("keeps the full mobile administration menu visible without nested clipping", () => {
    const panel = cssRule(css, ".mobileMenuPanel");
    const navigation = cssRule(css, ".mobileMenu .navigation");
    const groups = cssRule(css, ".mobileMenu .navigationGroup");

    expect(panel).toContain("position: fixed;");
    expect(panel).toContain("inset: 64px 0 0;");
    expect(panel).toContain("overflow-y: auto;");
    expect(navigation).toContain("max-height: none;");
    expect(navigation).toContain("overflow: visible;");
    expect(groups).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
  });

  it("keeps mobile navigation text readable on hover and keyboard focus", () => {
    const activeLink = cssRule(
      css,
      ".mobileMenu .navigation a:hover,\n  .mobileMenu .navigation a:focus-visible",
    );

    expect(activeLink).toContain("color: #fff;");
  });

  it("uses one responsive disclosure for every Admin search and filter panel", () => {
    for (const route of filterRoutes) {
      expect(route).toContain("<AdminFilterDisclosure>");
      expect(route).toContain("</AdminFilterDisclosure>");
    }
    expect(cssRule(css, ".filterDisclosure > summary")).toContain("min-height: 48px;");
    expect(css).toMatch(/@media \(min-width: 681px\)[\s\S]*?\.filterDisclosure:not\(\[open\]\) > \.filterPanel[\s\S]*?display:\s*grid;/);
  });

  it("turns the wide review table into labelled records on mobile", () => {
    const mobile = css.slice(css.lastIndexOf("@media (max-width: 680px)"));

    expect(mobile).toMatch(/\.reviewTable,[\s\S]*?\.reviewTable tbody,[\s\S]*?\.reviewTable tr,[\s\S]*?\.reviewTable td[\s\S]*?display:\s*block;/);
    expect(mobile).toMatch(/\.reviewTable td::before\s*\{[\s\S]*?content:\s*attr\(data-label\);/);
  });
});
