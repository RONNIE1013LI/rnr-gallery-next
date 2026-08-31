import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertNoForbiddenProductionAutomationReferences,
  findForbiddenProductionAutomationReferences,
} from "./production-automation-static-guard";

const temporaryRoots: string[] = [];

async function fixtureFile(rootDir: string, relativePath: string, contents: string) {
  const filePath = join(rootDir, relativePath);
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

async function fixtureRoot() {
  const rootDir = await mkdtemp(join(tmpdir(), "rnr-production-automation-static-guard-"));
  temporaryRoots.push(rootDir);
  return rootDir;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((rootDir) => rm(rootDir, { force: true, recursive: true })));
});

describe("production automation static guard", () => {
  it("blocks an official Production URL in an executable Playwright file", async () => {
    const rootDir = await fixtureRoot();
    await fixtureFile(rootDir, "tests/new-playwright.ts", 'await page.goto("https://rnrgallery.com")\n');

    expect(findForbiddenProductionAutomationReferences(rootDir)).toEqual([
      { line: 1, relativePath: "tests/new-playwright.ts" },
    ]);
  });

  it("allows Preview URLs in executable Playwright files", async () => {
    const rootDir = await fixtureRoot();
    await fixtureFile(rootDir, "tests/new-playwright.ts", 'await page.goto("https://rnr-preview.vercel.app")\n');

    expect(findForbiddenProductionAutomationReferences(rootDir)).toEqual([]);
  });

  it("allows official domains only in the exact approved guard paths", async () => {
    const rootDir = await fixtureRoot();
    await Promise.all([
      "scripts/automation/production-access-guard.ts",
      "scripts/automation/production-access-guard.test.ts",
      "scripts/automation/production-automation-static-guard.ts",
      "scripts/automation/production-automation-static-guard.test.ts",
      "scripts/production-browser-check.ts",
      "scripts/production-browser-check.test.ts",
      "scripts/production-guard.ts",
      "scripts/production-guard.test.ts",
    ].map((relativePath) => fixtureFile(rootDir, relativePath, [
      '"https://rnrgallery.com"',
      '"https://www.rnrgallery.com"',
      '"https://rrgallery.co.nz"',
      '"https://www.rrgallery.co.nz"',
    ].join("\n"))));

    expect(findForbiddenProductionAutomationReferences(rootDir)).toEqual([]);
  });

  it("does not treat a non-automation component as executable browser automation", async () => {
    const rootDir = await fixtureRoot();
    await fixtureFile(rootDir, "src/components/example.tsx", 'const site = "https://rnrgallery.com"\n');

    expect(findForbiddenProductionAutomationReferences(rootDir)).toEqual([]);
  });

  it("detects both bare official hosts and HTTPS URLs in automation files", async () => {
    const rootDir = await fixtureRoot();
    await fixtureFile(rootDir, "playwright/check.ts", [
      'const bareHost = "www.rnrgallery.com";',
      'await page.goto("https://www.rrgallery.co.nz/help");',
    ].join("\n"));

    expect(findForbiddenProductionAutomationReferences(rootDir)).toEqual([
      { line: 1, relativePath: "playwright/check.ts" },
      { line: 2, relativePath: "playwright/check.ts" },
    ]);
  });

  it("sorts findings without exposing source content", async () => {
    const rootDir = await fixtureRoot();
    await fixtureFile(rootDir, "tests/z-playwright.ts", "\nhttps://rnrgallery.com\n");
    await fixtureFile(rootDir, "e2e/a-check.ts", "https://rrgallery.co.nz\n\nhttps://www.rnrgallery.com\n");

    const findings = findForbiddenProductionAutomationReferences(rootDir);

    expect(findings).toEqual([
      { line: 1, relativePath: "e2e/a-check.ts" },
      { line: 3, relativePath: "e2e/a-check.ts" },
      { line: 2, relativePath: "tests/z-playwright.ts" },
    ]);
    expect(findings.every((finding) => !("contents" in finding))).toBe(true);
    expect(() => assertNoForbiddenProductionAutomationReferences(rootDir)).toThrow(
      [
        "PRODUCTION_AUTOMATION_HARDCODE_BLOCKED",
        "e2e/a-check.ts:1",
        "e2e/a-check.ts:3",
        "tests/z-playwright.ts:2",
        "Use the central Production Access Guard and approved Production Smoke workflow.",
      ].join("\n"),
    );
  });
});
