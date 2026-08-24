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
    const events: string[] = [];
    const identifyDatabase = vi.fn().mockImplementation(async () => {
      events.push("identify");
      return {
        database: "rnr_gallery_test",
        hostname: "test-db.example",
        serverVersion: "PostgreSQL 17",
        inRecovery: false,
      };
    });
    const verifyLineage = vi.fn().mockImplementation(async () => {
      events.push("verify-lineage");
    });
    const runDrizzle = vi.fn().mockImplementation(async () => {
      events.push("run-drizzle");
      return 0;
    });
    const writeSafeIdentity = vi.fn().mockImplementation(() => {
      events.push("write-identity");
    });

    const exitCode = await runMigration({
      args: { environment: "test", confirmProduction: false },
      env: { DATABASE_URL: "postgresql://wrong/prod", TEST_DATABASE_URL: testUrl },
      identifyDatabase,
      verifyLineage,
      runDrizzle,
      writeSafeIdentity,
    });

    expect(exitCode).toBe(0);
    expect(events).toEqual([
      "identify",
      "verify-lineage",
      "write-identity",
      "run-drizzle",
    ]);
    expect(identifyDatabase).toHaveBeenCalledWith(testUrl, "test-db.example");
    expect(verifyLineage).toHaveBeenCalledWith(testUrl);
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
      verifyLineage: vi.fn(),
      runDrizzle,
      writeSafeIdentity: vi.fn(),
    })).rejects.toThrow("identity mismatch");
    expect(runDrizzle).not.toHaveBeenCalled();
  });

  it("fails closed before identity output and Drizzle when lineage verification rejects", async () => {
    const runDrizzle = vi.fn();
    const writeSafeIdentity = vi.fn();
    const verifyLineage = vi.fn().mockRejectedValue(
      new Error("Migration hash mismatch at position 1"),
    );

    await expect(runMigration({
      args: { environment: "test", confirmProduction: false },
      env: { TEST_DATABASE_URL: testUrl },
      identifyDatabase: vi.fn().mockResolvedValue({
        database: "rnr_gallery_test",
        hostname: "test-db.example",
        serverVersion: "PostgreSQL 17",
        inRecovery: false,
      }),
      verifyLineage,
      runDrizzle,
      writeSafeIdentity,
    })).rejects.toThrow(/hash mismatch/i);

    expect(verifyLineage).toHaveBeenCalledWith(testUrl);
    expect(writeSafeIdentity).not.toHaveBeenCalled();
    expect(runDrizzle).not.toHaveBeenCalled();
  });
});
