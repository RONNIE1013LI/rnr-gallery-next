import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageCss = readFileSync("src/app/reply-assistant/reply-assistant.module.css", "utf8");
const queueCss = readFileSync("src/components/reply-assistant/reply-assistant.module.css", "utf8");

describe("Reply Assistant visual hierarchy", () => {
  it("uses the approved operational palette and dashboard toolbar", () => {
    expect(pageCss).toContain("--reply-canvas: #f5f3ee;");
    expect(pageCss).toContain("--reply-accent: #345c45;");
    expect(pageCss).toMatch(/\.dashboardToolbar\s*\{[\s\S]*?display:\s*flex;/);
  });

  it("separates conversation context from reply work on wide screens", () => {
    expect(queueCss).toMatch(/\.messageBody\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 0\.92fr\) minmax\(320px, 1\.08fr\);/);
    expect(queueCss).toMatch(/\.messageResponse\s*\{[\s\S]*?background:\s*var\(--reply-response\);/);
  });

  it("keeps actions touch-safe and returns message cards to one column on narrow screens", () => {
    expect(queueCss).toMatch(/\.actions button,[\s\S]*?min-height:\s*44px;/);
    const mobile = queueCss.slice(queueCss.lastIndexOf("@media (max-width: 900px)"));
    expect(mobile).toMatch(/\.messageBody\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/);
  });

  it("places conversations before KPI cards on mobile without changing desktop order", () => {
    expect(pageCss).toMatch(/\.liveDashboard\s*\{\s*display:\s*contents;/);
    const mobile = pageCss.slice(pageCss.indexOf("@media (max-width: 700px)"));
    expect(mobile).toMatch(/\.liveDashboard\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;/);
    expect(mobile).toMatch(/\.conversationPanel\s*\{[\s\S]*?order:\s*1;/);
    expect(mobile).toMatch(/\.metricPanel\s*\{[\s\S]*?order:\s*2;/);
  });

  it("keeps AI control separate, desktop-expanded, and mobile-collapsible", () => {
    expect(pageCss).toMatch(/\.aiControlDisclosure\s*\{\s*display:\s*none;/);
    expect(pageCss).toMatch(/\.aiControlSettings\s*\{[\s\S]*?display:\s*grid;/);

    const mobile = pageCss.slice(pageCss.indexOf("@media (max-width: 700px)"));
    expect(mobile).toMatch(/\.aiControlPanel\s*\{\s*order:\s*-1;/);
    expect(mobile).toMatch(/\.aiControlDisclosure\s*\{[\s\S]*?display:\s*inline-flex;[\s\S]*?min-height:\s*44px;/);
    expect(mobile).toMatch(/\.aiControlSettings\[data-mobile-expanded="false"\]\s*\{\s*display:\s*none;/);
  });
});
