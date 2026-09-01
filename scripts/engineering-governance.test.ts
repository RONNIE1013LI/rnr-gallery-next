import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  APPROVED_CRONS,
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
