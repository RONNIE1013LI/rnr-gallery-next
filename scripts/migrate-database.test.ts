import { describe, expect, it, vi } from "vitest";
import {
  parseMigrationArguments,
  runMigration,
} from "./migrate-database";
import { databaseHostFingerprint } from "./migration-safety";

const testUrl = "postgresql://tester:secret@test-db.example/rnr_gallery_test";

describe("guarded migration runner", () => {
  it("parses an explicit test environment and rejects unknown flags", () => {
    expect(parseMigrationArguments(["--environment", "test"]))
      .toEqual({ environment: "test", confirmProduction: false });
    expect(() => parseMigrationArguments(["--environment", "staging"]))
      .toThrow("environment");
    expect(() => parseMigrationArguments(["--unknown"]))
      .toThrow("Unknown migration argument");
  });

  it("parses all required production identity arguments", () => {
    expect(parseMigrationArguments([
      "--environment", "production",
      "--confirm-production",
      "--expected-database", "neondb",
      "--expected-host-fingerprint", "a".repeat(64),
    ])).toEqual({
      environment: "production",
      confirmProduction: true,
      expectedDatabase: "neondb",
      expectedHostFingerprint: "a".repeat(64),
    });
  });

  it("verifies identity before invoking Drizzle with a sanitized environment", async () => {
    const identifyDatabase = vi.fn().mockResolvedValue({
      database: "rnr_gallery_test",
      hostname: "test-db.example",
      serverVersion: "PostgreSQL 17",
      inRecovery: false,
    });
    const runDrizzle = vi.fn().mockResolvedValue(0);
    const writeSafeIdentity = vi.fn();

    const exitCode = await runMigration({
      args: { environment: "test", confirmProduction: false },
      env: { DATABASE_URL: "postgresql://wrong/prod", TEST_DATABASE_URL: testUrl },
      identifyDatabase,
      runDrizzle,
      writeSafeIdentity,
    });

    expect(exitCode).toBe(0);
    expect(identifyDatabase).toHaveBeenCalledWith(testUrl, "test-db.example");
    expect(writeSafeIdentity).toHaveBeenCalledWith(expect.objectContaining({
      environment: "test",
      database: "rnr_gallery_test",
      hostFingerprint: databaseHostFingerprint("test-db.example"),
    }));
    expect(runDrizzle).toHaveBeenCalledWith(expect.objectContaining({
      DATABASE_URL: testUrl,
    }));
    expect(runDrizzle.mock.calls[0]?.[0]).not.toHaveProperty("TEST_DATABASE_URL");
  });

  it("does not invoke Drizzle when database identity verification fails", async () => {
    const runDrizzle = vi.fn();
    await expect(runMigration({
      args: {
        environment: "production",
        confirmProduction: true,
        expectedDatabase: "neondb",
        expectedHostFingerprint: "a".repeat(64),
      },
      env: { PRODUCTION_DATABASE_URL: "postgresql://app:secret@prod.example/neondb" },
      identifyDatabase: vi.fn().mockResolvedValue({
        database: "other",
        hostname: "prod.example",
        serverVersion: "PostgreSQL 17",
        inRecovery: false,
      }),
      runDrizzle,
      writeSafeIdentity: vi.fn(),
    })).rejects.toThrow("identity mismatch");
    expect(runDrizzle).not.toHaveBeenCalled();
  });
});
