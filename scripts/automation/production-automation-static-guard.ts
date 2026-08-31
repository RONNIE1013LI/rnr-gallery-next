import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { OFFICIAL_PRODUCTION_HOSTS } from "./production-access-guard";

export type Finding = Readonly<{
  relativePath: string;
  line: number;
}>;

const approvedPaths = new Set([
  "scripts/automation/production-access-guard.ts",
  "scripts/automation/production-access-guard.test.ts",
  "scripts/automation/production-automation-static-guard.ts",
  "scripts/automation/production-automation-static-guard.test.ts",
  "scripts/production-browser-check.ts",
  "scripts/production-browser-check.test.ts",
  "scripts/production-guard.ts",
  "scripts/production-guard.test.ts",
]);

const skippedDirectories = new Set([".git", ".next", "node_modules", "coverage", "output", ".worktrees"]);
const automationDirectories = new Set(["scripts", "tests", "test", "e2e", "playwright"]);
const automationFilename = /(playwright|browser|smoke|screenshot|visual|ui-audit|e2e|lighthouse)/i;
const escapedHosts = OFFICIAL_PRODUCTION_HOSTS.map((host) => host.replaceAll(".", "\\.")).join("|");
const officialProductionHost = new RegExp(
  `(?:^|[^a-z0-9.-])(?:https:\\/\\/)?(?:${escapedHosts})(?=$|[/:?#\\s"'])`,
  "i",
);

function normalizedRelativePath(rootDir: string, path: string) {
  return relative(rootDir, path).split(sep).join("/");
}

function isAutomationFile(relativePath: string) {
  const segments = relativePath.split("/");
  return automationDirectories.has(segments[0] ?? "") || automationFilename.test(segments.at(-1) ?? "");
}

function findFiles(rootDir: string, directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return skippedDirectories.has(entry.name) ? [] : findFiles(rootDir, resolve(directory, entry.name));
    }
    if (!entry.isFile()) return [];
    const path = resolve(directory, entry.name);
    const relativePath = normalizedRelativePath(rootDir, path);
    return approvedPaths.has(relativePath) || !isAutomationFile(relativePath) ? [] : [path];
  });
}

function isTextFile(path: string) {
  return !readFileSync(path).includes(0);
}

export function findForbiddenProductionAutomationReferences(rootDir: string): readonly Finding[] {
  const resolvedRootDir = resolve(rootDir);
  const findings: Finding[] = [];

  for (const path of findFiles(resolvedRootDir, resolvedRootDir)) {
    if (!isTextFile(path)) continue;
    const relativePath = normalizedRelativePath(resolvedRootDir, path);
    const lines = readFileSync(path, "utf8").split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (officialProductionHost.test(line)) findings.push({ relativePath, line: index + 1 });
    }
  }

  return findings.sort((left, right) => left.relativePath.localeCompare(right.relativePath) || left.line - right.line);
}

export function assertNoForbiddenProductionAutomationReferences(rootDir: string): void {
  const findings = findForbiddenProductionAutomationReferences(rootDir);
  if (findings.length === 0) return;
  throw new Error([
    "PRODUCTION_AUTOMATION_HARDCODE_BLOCKED",
    ...findings.map((finding) => `${finding.relativePath}:${finding.line}`),
    "Use the central Production Access Guard and approved Production Smoke workflow.",
  ].join("\n"));
}

function runsAsCli() {
  return process.argv[1] !== undefined
    && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (runsAsCli()) assertNoForbiddenProductionAutomationReferences(process.cwd());
