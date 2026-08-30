import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

describe("Production governance wiring", () => {
  it("exposes one read-only Production guard and one isolated release-test command", () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["production:guard"]).toBe(
      "tsx scripts/production-guard.ts",
    );
    expect(packageJson.scripts?.["release:test:isolated"]).toBe(
      "tsx scripts/release-test-database.ts",
    );
  });

  it("runs the guard on main pushes, manually, and weekly without deployment commands", () => {
    const workflow = readFileSync(
      resolve(root, ".github/workflows/production-guard.yml"),
      "utf8",
    );

    expect(workflow).toMatch(/push:[\s\S]*branches:\s*\[main\]/);
    expect(workflow).toMatch(/workflow_dispatch:/);
    expect(workflow).toMatch(/schedule:[\s\S]*cron:/);
    expect(workflow).toContain("npm run production:guard");
    expect(workflow).toContain("secrets.PRODUCTION_GUARD_GITHUB_TOKEN");
    expect(workflow).not.toContain("vercel --prod");
    expect(workflow).not.toMatch(/curl[\s\S]*(PATCH|POST|DELETE)/i);
  });

  it("keeps the repository prebuild source guard active", () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.prebuild).toBe(
      "tsx scripts/verify-production-deployment-source.ts",
    );
  });
});
