import { describe, expect, it, vi } from "vitest";
import {
  databaseTargetFingerprint,
  releaseDatabaseNames,
  runReleaseTestGate,
} from "./release-test-database";
import { databaseHostFingerprint } from "./migration-safety";

const adminUrl = "postgresql://release_admin:secret@127.0.0.1:55432/postgres";
const productionUrl = "postgresql://runtime:secret@production.example:5432/rnr_gallery";

function input(overrides: Partial<Parameters<typeof runReleaseTestGate>[0]> = {}) {
  return {
    adminUrl,
    originMainSha: "a".repeat(40),
    runId: "run12345",
    productionTargetFingerprints: [databaseTargetFingerprint(productionUrl)],
    expectedProductionDatabase: "rnr_gallery",
    expectedProductionHostFingerprint: "b".repeat(64),
    rootDir: "/repo",
    baseEnvironment: {},
    ...overrides,
  };
}

describe("disposable release database naming", () => {
  it("creates worktree/session-specific test database names", () => {
    expect(releaseDatabaseNames("ABCDEF0123456789", "Run_1234")).toEqual({
      application: "rnr_gallery_test_release_gate_abcdef01_run_1234_app",
      integration: "rnr_gallery_test_release_gate_abcdef01_run_1234_integration",
    });
  });

  it("rejects an invalid Git SHA or run identifier", () => {
    expect(() => releaseDatabaseNames("not-a-sha", "run12345")).toThrow(/Git SHA/i);
    expect(() => releaseDatabaseNames("a".repeat(40), "../unsafe")).toThrow(/run identifier/i);
  });

  it("keeps long run identifiers within PostgreSQL's 63-byte name limit", () => {
    const names = releaseDatabaseNames("26e7d786".repeat(5), "local_1788128029018");

    expect(names.application.length).toBeLessThanOrEqual(63);
    expect(names.integration.length).toBeLessThanOrEqual(63);
    expect(names.application).not.toBe(names.integration);
  });
});

describe("disposable release test gate", () => {
  it("creates isolated databases, migrates, tests, then cleans up", async () => {
    const events: string[] = [];
    const createDatabase = vi.fn(async (_url: string, name: string) => {
      events.push(`create:${name}`);
    });
    const dropDatabase = vi.fn(async (_url: string, name: string) => {
      events.push(`drop:${name}`);
    });
    const runCommand = vi.fn(async (command: string, args: readonly string[], env: NodeJS.ProcessEnv) => {
      events.push(`${command}:${args.join(" ")}`);
      expect(env.TEST_DATABASE_URL).toContain("_integration");
      expect(env.DATABASE_URL).toContain("_app");
      expect(env.TEST_DATABASE_URL).not.toBe(env.DATABASE_URL);
      expect(env.NODE_ENV).toBe("test");
      expect(env).not.toHaveProperty("PRODUCTION_DATABASE_URL");
      expect(env).not.toHaveProperty("POSTGRES_URL");
      expect(env).not.toHaveProperty("DIRECT_URL");
      expect(env).not.toHaveProperty("PGHOST");
      return 0;
    });

    await runReleaseTestGate(input({
      baseEnvironment: {
        DATABASE_URL: productionUrl,
        PRODUCTION_DATABASE_URL: productionUrl,
        POSTGRES_URL: productionUrl,
        DIRECT_URL: productionUrl,
        PGHOST: "production.example",
      },
    }), { createDatabase, dropDatabase, runCommand });

    expect(events).toEqual([
      "create:rnr_gallery_test_release_gate_aaaaaaaa_run12345_app",
      "create:rnr_gallery_test_release_gate_aaaaaaaa_run12345_integration",
      "npm:run db:migrate -- --environment test",
      "npm:run test:run",
      "drop:rnr_gallery_test_release_gate_aaaaaaaa_run12345_integration",
      "drop:rnr_gallery_test_release_gate_aaaaaaaa_run12345_app",
    ]);
  });

  it("cleans up both disposable databases after a test failure", async () => {
    const dropDatabase = vi.fn(async (...args: [string, string]) => {
      void args;
    });
    const runCommand = vi.fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);

    await expect(runReleaseTestGate(input(), {
      createDatabase: vi.fn(async () => undefined),
      dropDatabase,
      runCommand,
    })).rejects.toThrow(/test suite failed/i);

    expect(dropDatabase).toHaveBeenCalledTimes(2);
  });

  it("cleans the application database if integration database creation fails", async () => {
    const createDatabase = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("create failed"));
    const dropDatabase = vi.fn(async (...args: [string, string]) => {
      void args;
    });

    await expect(runReleaseTestGate(input(), {
      createDatabase,
      dropDatabase,
      runCommand: vi.fn(),
    })).rejects.toThrow("create failed");

    expect(dropDatabase).toHaveBeenCalledTimes(1);
    expect(dropDatabase.mock.calls[0]?.[1]).toMatch(/_app$/);
  });

  it("fails before database creation when a target matches Production", async () => {
    const names = releaseDatabaseNames("a".repeat(40), "run12345");
    const target = new URL(adminUrl);
    target.pathname = `/${names.integration}`;
    const createDatabase = vi.fn();

    await expect(runReleaseTestGate(input({
      productionTargetFingerprints: [databaseTargetFingerprint(target.toString())],
    }), {
      createDatabase,
      dropDatabase: vi.fn(),
      runCommand: vi.fn(),
    })).rejects.toThrow(/Production database fingerprint/i);

    expect(createDatabase).not.toHaveBeenCalled();
  });

  it("fails closed without a Production fingerprint", async () => {
    await expect(runReleaseTestGate(input({ productionTargetFingerprints: [] }), {
      createDatabase: vi.fn(),
      dropDatabase: vi.fn(),
      runCommand: vi.fn(),
    })).rejects.toThrow(/Production database fingerprint is required/i);
  });

  it("rejects a release administration host that matches Production", async () => {
    await expect(runReleaseTestGate(input({
      expectedProductionHostFingerprint: databaseHostFingerprint("127.0.0.1"),
    }), {
      createDatabase: vi.fn(),
      dropDatabase: vi.fn(),
      runCommand: vi.fn(),
    })).rejects.toThrow(/Production database host/i);
  });
});
