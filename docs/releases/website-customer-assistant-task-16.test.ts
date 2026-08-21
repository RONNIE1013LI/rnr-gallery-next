import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readReleaseDocument = (name: string) =>
  readFileSync(join(process.cwd(), "docs", "releases", name), "utf8");

describe("Task 16 release evidence templates", () => {
  it("keeps external Staging evidence explicitly unverified", () => {
    const staging = readReleaseDocument(
      "2026-08-21-website-customer-assistant-staging-validation.md",
    );

    expect(staging).toContain("**Status: NOT RUN.**");
    expect(staging).toMatch(/No Preview or\s+Production deployment/);
    expect(staging).toContain("| Preview deployment | NOT RUN |");
    expect(staging).toContain("| Production changes | NONE |");
    expect(staging).toContain("This template does not establish Staging readiness.");
    expect(staging).not.toMatch(/- \[x\]/i);
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
