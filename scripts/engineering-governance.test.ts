import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";

import { describe, expect, it } from "vitest";

import {
  APPROVED_CRONS,
  REDIS_ONLY_RECOVERY_ROUTES,
  CACHE_INVALIDATION_WIRING,
  GOVERNED_POLLING_FILES,
  PRIVATE_SHARED_CACHE_BOUNDARIES,
  TWO_DAY_MAINTENANCE_HANDLERS,
} from "./engineering-governance-baseline";

const root = resolve(import.meta.dirname, "..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

function sourceFiles(path: string): string[] {
  const absolute = resolve(root, path);
  if (statSync(absolute).isFile()) return [path];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(child);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [child] : [];
  });
}

describe("engineering governance baseline", () => {
  it("keeps recovery routes and their executable local import graph free of Neon dependencies", () => {
    const visited = new Set<string>();
    function inspect(path: string) {
      if (visited.has(path)) return;
      visited.add(path);
      const code = ts.transpileModule(readFileSync(path, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        fileName: path,
      }).outputText;
      for (const match of code.matchAll(/(?:from\s*|import\s*\(\s*|import\s+|require\s*\(\s*)["']([^"']+)["']/g)) {
        const dependency = match[1];
        expect(dependency, path).not.toMatch(/^(?:pg(?:\/|$)|postgres(?:\/|$)|drizzle-orm(?:\/|$)|@neondatabase\/)|server\/db(?:\/|$)|customer-service\/runtime$/);
        if (!dependency.startsWith(".") && !dependency.startsWith("@/")) continue;
        const base = dependency.startsWith("@/")
          ? resolve(root, "src", dependency.slice(2))
          : resolve(dirname(path), dependency);
        if (base.endsWith(".json")) continue;
        const next = [base, base + ".ts", base + ".tsx", resolve(base, "index.ts")]
          .find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
        expect(next, dependency).toBeDefined();
        if (next) inspect(next);
      }
    }
    for (const route of REDIS_ONLY_RECOVERY_ROUTES) {
      expect(route.neon).toBe(false);
      const code = source(route.path);
      expect(code).toContain(route.recovery);
      expect(code).not.toMatch(/createCustomerServiceRuntime|turnRecoveryRunner|recoverDueHumanReplies|refreshLearningCandidates|refreshOpenWebsiteReviewSelectors|reviewAlertService|compiledKnowledge/);
      inspect(resolve(root, route.path));
    }
  });

  it("keeps Vercel cron configuration equal to the approved registry", () => {
    const vercel = JSON.parse(source("vercel.json")) as {
      crons?: Array<{ path: string; schedule: string }>;
    };

    expect(vercel.crons).toEqual(APPROVED_CRONS);
    expect(vercel.crons?.some(({ path }) => path.includes("conversion-deliveries")))
      .toBe(false);
  });

  it("keeps every daily maintenance endpoint behind the shared two-day gate", () => {
    for (const path of TWO_DAY_MAINTENANCE_HANDLERS) {
      expect(source(path), path).toContain("shouldRunTwoDayMaintenance");
    }
  });

  it("prevents unapproved idle, focus, and visibility polling in critical UI modules", () => {
    const prohibited = [
      /\bsetInterval\s*\(/,
      /\brefreshInterval\b/,
      /\brefetchInterval\b/,
      /addEventListener\s*\(\s*["'](?:focus|visibilitychange)["']/,
    ];

    for (const path of GOVERNED_POLLING_FILES) {
      const contents = source(path);
      for (const pattern of prohibited) expect(contents, `${path}: ${pattern}`).not.toMatch(pattern);
    }

    const customerChat = source("src/components/customer-chat/customer-chat.tsx");
    expect(customerChat).toContain("const pollingIntervalMs = 5_000");
    expect(customerChat).toContain("const maximumPendingPolls = 24");
    expect(customerChat).toContain("startPendingPolling();");
    expect(customerChat).toContain("stopPendingPolling();");
  });

  it("keeps private and user-specific modules out of the shared public cache", () => {
    for (const boundary of PRIVATE_SHARED_CACHE_BOUNDARIES) {
      for (const path of sourceFiles(boundary)) {
        expect(source(path), path).not.toMatch(/\bcachePublicData\s*\(/);
      }
    }
  });

  it("keeps every public mutation wired to its explicit invalidation policy", () => {
    for (const { path, policy } of CACHE_INVALIDATION_WIRING) {
      expect(source(path), path).toContain(`PUBLIC_CACHE_INVALIDATION.${policy}`);
    }
  });
});
