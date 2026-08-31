import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertProductionDeploymentSource } from "./verify-production-deployment-source";

const root = resolve(import.meta.dirname, "..");

describe("production deployment guard wiring", () => {
  it("runs the source guard before every production build", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(root, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.prebuild).toBe(
      "npm run automation:guard && tsx scripts/verify-production-deployment-source.ts",
    );
    expect(
      existsSync(resolve(root, "scripts/automation/production-automation-static-guard.ts")),
    ).toBe(true);
    expect(
      existsSync(resolve(root, "scripts/verify-production-deployment-source.ts")),
    ).toBe(true);
  });
});

describe("production deployment source guard", () => {
  it("does not affect local or Preview builds", () => {
    expect(() => assertProductionDeploymentSource({})).not.toThrow();
    expect(() => assertProductionDeploymentSource({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "feat/example",
    })).not.toThrow();
  });

  it("allows a Git-backed Production build from main", () => {
    expect(() => assertProductionDeploymentSource({
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "main",
      VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
    })).not.toThrow();
  });

  it.each([undefined, "HEAD", "feat/example", "release/temporary"])(
    "rejects a Production build from %s",
    (ref) => {
      expect(() => assertProductionDeploymentSource({
        VERCEL_ENV: "production",
        VERCEL_GIT_COMMIT_REF: ref,
        VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
      })).toThrow(
        "PRODUCTION SOURCE GUARD FAILED:\nOnly main may create a normal Production build.",
      );
    },
  );

  it.each([undefined, "", "abc", "g".repeat(40)])(
    "rejects a Production build without a valid Git commit SHA",
    (sha) => {
      expect(() => assertProductionDeploymentSource({
        VERCEL_ENV: "production",
        VERCEL_GIT_COMMIT_REF: "main",
        VERCEL_GIT_COMMIT_SHA: sha,
      })).toThrow("Production deployments require a full Git commit SHA");
    },
  );
});
