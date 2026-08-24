import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const formsCss = readFileSync("src/components/forms/forms.module.css", "utf8");

function cssRule(source: string, selector: string) {
  const start = source.indexOf(`${selector} {`);
  expect(start, `${selector} should exist`).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf("}", start) + 1);
}

describe("Forms statistics visual contract", () => {
  it("gives full-history report widgets the complete report width", () => {
    expect(cssRule(formsCss, `.statsReportWidget[data-type="bar"],
.statsReportWidget[data-type="line"],
.statsReportWidget[data-type="table"],
.statsReportWidget[data-type="text"],
.statsReportWidget[data-type="divider"]`)).toContain("grid-column: 1 / -1;");
    expect(cssRule(formsCss, `.statWidget[data-type="line"],
.statWidget[data-type="table"],
.statWidget[data-type="text"],
.statWidget[data-type="divider"]`)).toContain("grid-column: 1 / -1;");
  });

  it("keeps chart scrollers bounded and mobile report actions touch safe", () => {
    expect(cssRule(formsCss, ".statChartScroller")).toContain("width: 100%;");
    expect(cssRule(formsCss, ".statChartScroller")).toContain("overflow-x: auto;");
    const mobile = formsCss.slice(formsCss.indexOf("@media (max-width: 600px)"));
    expect(cssRule(mobile, ".statsPageToolbar button")).toContain("min-height: 44px;");
    expect(cssRule(mobile, ".statsReportActions button")).toContain("min-height: 44px;");
  });
});
