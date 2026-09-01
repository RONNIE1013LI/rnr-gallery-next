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
    expect(workflow).toContain("secrets.DATABASE_ENVIRONMENT_METADATA_FINGERPRINT");
    expect(workflow).toMatch(/Check out authoritative main[\s\S]*ref:\s*main/);
    expect(workflow).not.toContain("vercel --prod");
    expect(workflow).not.toMatch(/curl[\s\S]*(PATCH|POST|DELETE)/i);
  });

  it("keeps the repository prebuild source guard active", () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["automation:guard"]).toBe(
      "tsx scripts/automation/production-automation-static-guard.ts",
    );
    expect(packageJson.scripts?.prebuild).toBe(
      "npm run automation:guard && tsx scripts/verify-production-deployment-source.ts",
    );
  });

  it("canonicalizes only meta-webindexer public image requests before Vercel image optimization", () => {
    const vercel = JSON.parse(
      readFileSync(resolve(root, "vercel.json"), "utf8"),
    ) as {
      redirects?: Array<Record<string, unknown>>;
    };

    expect(vercel.redirects).toEqual([{
      source: "/_next/image",
      has: [
        {
          type: "header",
          key: "user-agent",
          value: "(?:^|.*[\\s;(])meta-webindexer(?:/.*|$|[\\s;)].*)",
        },
        {
          type: "query",
          key: "url",
          value: "(?<metaImageSource>/(?:gallery-images|media)/.*)",
        },
      ],
      missing: [{ type: "query", key: "rnr_meta_image" }],
      destination: "/_next/image?url=:metaImageSource&w=828&q=60&rnr_meta_image=1",
      statusCode: 307,
    }]);
  });
});
