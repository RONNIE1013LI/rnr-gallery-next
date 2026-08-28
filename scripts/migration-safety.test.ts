import { describe, expect, it } from "vitest";
import {
  assertIsolatedTestDatabaseUrl,
  databaseHostFingerprint,
  sanitizedMigrationEnvironment,
  selectMigrationTarget,
  verifyDatabaseIdentity,
} from "./migration-safety";

const testUrl = "postgresql://tester:secret@test-db.example/rnr_gallery_test";
const productionUrl = "postgresql://app:secret@production-db.example/neondb";
const productionIdentity = {
  EXPECTED_PRODUCTION_DATABASE: "neondb",
  EXPECTED_PRODUCTION_HOST_FINGERPRINT: databaseHostFingerprint("production-db.example"),
};

describe("migration target safety", () => {
  it("uses only TEST_DATABASE_URL for an explicit test migration", () => {
    const target = selectMigrationTarget({
      environment: "test",
      env: {
        DATABASE_URL: productionUrl,
        TEST_DATABASE_URL: testUrl,
        ...productionIdentity,
      },
    });

    expect(target.environment).toBe("test");
    expect(target.database).toBe("rnr_gallery_test");
    expect(target.url).toBe(testUrl);
  });

  it("rejects a test target without an explicit test database name", () => {
    expect(() => selectMigrationTarget({
      environment: "test",
      env: { TEST_DATABASE_URL: productionUrl, ...productionIdentity },
    })).toThrow("dedicated test database");
  });

  it("rejects a test URL that equals an application or production URL", () => {
    for (const env of [
      { TEST_DATABASE_URL: testUrl, DATABASE_URL: testUrl, ...productionIdentity },
      { TEST_DATABASE_URL: testUrl, PRODUCTION_DATABASE_URL: testUrl, ...productionIdentity },
    ]) {
      expect(() => selectMigrationTarget({ environment: "test", env }))
        .toThrow("must differ");
    }
  });

  it("rejects the same host, port and database even when credentials differ", () => {
    expect(() => selectMigrationTarget({
      environment: "test",
      env: {
        TEST_DATABASE_URL: "postgresql://test_role:test@test-db.example:5432/rnr_gallery_test",
        PRODUCTION_DATABASE_URL: "postgresql://runtime_role:production@test-db.example:5432/rnr_gallery_test",
        ...productionIdentity,
      },
    })).toThrow("must differ");
  });

  it("provides the same fail-closed isolation guard to database integration tests", () => {
    expect(() => assertIsolatedTestDatabaseUrl(testUrl, {
      DATABASE_URL: "postgresql://app:secret@test-db.example/rnr_gallery_test",
      ...productionIdentity,
    })).toThrow("must differ");
    expect(() => assertIsolatedTestDatabaseUrl(productionUrl, productionIdentity))
      .toThrow("dedicated test database");
    expect(assertIsolatedTestDatabaseUrl(testUrl, {
      DATABASE_URL: productionUrl,
      PRODUCTION_DATABASE_URL: productionUrl,
      ...productionIdentity,
    })).toMatchObject({ database: "rnr_gallery_test" });
  });

  it("fails closed without safe Production identity metadata or with a malformed comparison URL", () => {
    expect(() => assertIsolatedTestDatabaseUrl(testUrl, {})).toThrow("identity metadata");
    expect(() => assertIsolatedTestDatabaseUrl(testUrl, {
      ...productionIdentity,
      PRODUCTION_DATABASE_URL: "not-a-postgres-url",
    })).toThrow("PostgreSQL URL");
  });

  it("uses only PRODUCTION_DATABASE_URL and requires explicit confirmation", () => {
    expect(() => selectMigrationTarget({
      environment: "production",
      confirmProduction: false,
      expectedDatabase: "neondb",
      expectedHostFingerprint: databaseHostFingerprint("production-db.example"),
      env: { DATABASE_URL: productionUrl },
    })).toThrow("PRODUCTION_DATABASE_URL");

    expect(() => selectMigrationTarget({
      environment: "production",
      confirmProduction: false,
      expectedDatabase: "neondb",
      expectedHostFingerprint: databaseHostFingerprint("production-db.example"),
      env: { DATABASE_URL: testUrl, PRODUCTION_DATABASE_URL: productionUrl },
    })).toThrow("confirmation");

    const target = selectMigrationTarget({
      environment: "production",
      confirmProduction: true,
      expectedDatabase: "neondb",
      expectedHostFingerprint: databaseHostFingerprint("production-db.example"),
      env: { DATABASE_URL: testUrl, PRODUCTION_DATABASE_URL: productionUrl },
    });
    expect(target.url).toBe(productionUrl);
    expect(target.database).toBe("neondb");
  });

  it("requires both expected production identity values", () => {
    for (const input of [
      { expectedDatabase: undefined, expectedHostFingerprint: "a".repeat(64) },
      { expectedDatabase: "neondb", expectedHostFingerprint: undefined },
    ]) {
      expect(() => selectMigrationTarget({
        environment: "production",
        confirmProduction: true,
        ...input,
        env: { PRODUCTION_DATABASE_URL: productionUrl },
      })).toThrow("expected production");
    }
  });

  it("verifies safe identity without returning a connection string", () => {
    const expectedHostFingerprint = databaseHostFingerprint("production-db.example");
    const identity = verifyDatabaseIdentity({
      environment: "production",
      expectedDatabase: "neondb",
      expectedHostFingerprint,
    }, {
      database: "neondb",
      hostname: "production-db.example",
      serverVersion: "PostgreSQL 17",
      inRecovery: false,
    });

    expect(identity).toEqual({
      environment: "production",
      database: "neondb",
      hostFingerprint: expectedHostFingerprint,
      serverVersion: "PostgreSQL 17",
      inRecovery: false,
    });
    expect(JSON.stringify(identity)).not.toContain("secret");
    expect(() => verifyDatabaseIdentity({
      environment: "production",
      expectedDatabase: "wrong",
      expectedHostFingerprint,
    }, {
      database: "neondb",
      hostname: "production-db.example",
      serverVersion: "PostgreSQL 17",
      inRecovery: false,
    })).toThrow("identity mismatch");
  });

  it("sanitizes every inherited database selector before invoking Drizzle", () => {
    const child = sanitizedMigrationEnvironment({
      PATH: "/bin",
      DATABASE_URL: productionUrl,
      TEST_DATABASE_URL: testUrl,
      PRODUCTION_DATABASE_URL: productionUrl,
    }, testUrl);

    expect(child).toMatchObject({ PATH: "/bin", DATABASE_URL: testUrl });
    expect(child).not.toHaveProperty("TEST_DATABASE_URL");
    expect(child).not.toHaveProperty("PRODUCTION_DATABASE_URL");
  });
});
