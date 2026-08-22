import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readReleaseDocument = (name: string) =>
  readFileSync(join(process.cwd(), "docs", "releases", name), "utf8");

describe("Task 16 release evidence templates", () => {
  it("records the approved final Staging readiness evidence", () => {
    const staging = readReleaseDocument(
      "2026-08-21-website-customer-assistant-staging-validation.md",
    );

    expect(staging).toContain("**Status: STAGING READY.**");
    expect(staging).toContain("| Preview deployment | PASS |");
    expect(staging).toContain("| Production changes | NONE |");
    expect(staging).toContain("Ronnie Website response quality sign-off: `PASS`");
    expect(staging).toContain("Ronnie alert recipient, exactly-once inbox delivery and secure deep-link approval");
    expect(staging).toContain("The accepted full checklist plus the final focused recheck now record **Staging READY**.");
  });

  it("does not present an unperformed rollback check as passing", () => {
    const rollback = readReleaseDocument(
      "2026-08-21-website-customer-assistant-rollback.md",
    );

    expect(rollback).toContain("**Status: NOT RUN.**");
    expect(rollback).toMatch(/No Staging or\s+Production rollback has been performed/);
    expect(rollback).not.toMatch(/PASS\/FAIL/);
    expect(rollback).not.toMatch(/automatic send count: 0/);
    expect(rollback.match(/^- .+: NOT RUN\.$/gm)).toHaveLength(8);
  });
});
