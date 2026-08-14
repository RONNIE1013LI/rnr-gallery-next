import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/components/forms/forms.module.css"), "utf8");

describe("Forms source visual parity", () => {
  it("uses the compact desktop workbench measurements from the running form", () => {
    expect(css).toContain("--forms-header-height: 38px;");
    expect(css).toContain("font-family: Arial, Helvetica, sans-serif;");
    expect(css).toContain("font-size: 10.5px;");
    expect(css).toContain("padding: 1px 4px;");
  });

  it("keeps the mobile forms experience touch friendly", () => {
    expect(css).toContain("@media (max-width: 720px)");
    expect(css).toContain("min-height: 48px;");
  });

  it("preserves the source field-specific option colours", () => {
    expect(css).toContain('.statusValue[data-field="deliveryMethod"][data-status="email"]');
    expect(css).toContain("background: #944fb2;");
    expect(css).toContain('.statusValue[data-field="customerSource"][data-status="email"]');
    expect(css).toContain("background: #55c7df;");
    expect(css).toContain('.statusValue[data-field="bankRecon"][data-status="not-checked"]');
    expect(css).toContain("background: #f7b84b;");
    expect(css).toContain('.statusValue[data-field="bankRecon"][data-status="arrive"]');
    expect(css).toContain("background: #4c61b6;");
    expect(css).toContain('.statusValue[data-field="bankRecon"][data-status="stripe"]');
    expect(css).toContain("background: #6554df;");
    expect(css).toContain('select[name="customerSource"] option[value="rnr"]');
    expect(css).toContain('select[name="customerSource"] option[value="instagram"]');
    expect(css).toContain('select[name="deliveryMethod"] option[value="post"]');
    expect(css).toContain('select[name="paymentReconciliationStatus"] option[value="Checked6"]');
  });
});
