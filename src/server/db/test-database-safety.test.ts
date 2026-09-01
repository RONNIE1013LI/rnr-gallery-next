import { describe, expect, it } from "vitest";
import {
  assertSafeTestDatabaseEnvironment,
  isDedicatedTestDatabase,
} from "./test-database-safety";

describe("isDedicatedTestDatabase", () => {
  it("fails closed when the application database URL is not present", () => {
    expect(
      isDedicatedTestDatabase(
        "postgresql://tester:secret@127.0.0.1:55443/rnr_test",
        undefined,
      ),
    ).toBe(false);
  });

  it("rejects the application database itself", () => {
    const url = "postgresql://tester:secret@127.0.0.1:55443/rnr_test";
    expect(isDedicatedTestDatabase(url, url)).toBe(false);
  });

  it("rejects the same database target when credentials differ", () => {
    expect(
      isDedicatedTestDatabase(
        "postgresql://tester:test-secret@127.0.0.1:55443/rnr_test",
        "postgresql://app:app-secret@127.0.0.1:55443/rnr_test",
      ),
    ).toBe(false);
  });

  it("accepts a separately named test database", () => {
    expect(
      isDedicatedTestDatabase(
        "postgresql://tester:secret@127.0.0.1:55443/gallery_integration_test",
        "postgresql://app:secret@127.0.0.1:55443/rnr_test",
      ),
    ).toBe(true);
  });
});

describe("assertSafeTestDatabaseEnvironment", () => {
  const productionFingerprint =
    "baa43ddcddcac5530101232bdf74cd8f649aa60f2276c7dbd95214b3c4d2d304";
  const safeEnvironment = {
    TEST_DATABASE_URL: "postgresql://tester:secret@test-db.example:5432/rnr_gallery_ci_test",
    DATABASE_URL: "postgresql://app:secret@127.0.0.1:55443/local_app",
    EXPECTED_PRODUCTION_DATABASE: "neondb",
    EXPECTED_PRODUCTION_HOST_FINGERPRINT: productionFingerprint,
  };

  it("does nothing when database integration tests are not enabled", () => {
    expect(() => assertSafeTestDatabaseEnvironment({})).not.toThrow();
  });

  it("accepts a dedicated test target with verified Production identity metadata", () => {
    expect(assertSafeTestDatabaseEnvironment(safeEnvironment)).toMatchObject({
      database: "rnr_gallery_ci_test",
      hostname: "test-db.example",
    });
  });

  it.each(["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "PRODUCTION_DATABASE_URL"])(
    "hard-fails when TEST_DATABASE_URL matches %s",
    (variable) => {
      expect(() => assertSafeTestDatabaseEnvironment({
        ...safeEnvironment,
        [variable]: safeEnvironment.TEST_DATABASE_URL,
      })).toThrow("REFUSING TO RUN DATABASE TESTS AGAINST PRODUCTION");
    },
  );

  it("hard-fails when the target matches the verified Production identity", () => {
    expect(() => assertSafeTestDatabaseEnvironment({
      ...safeEnvironment,
      TEST_DATABASE_URL: "postgresql://tester:secret@prod.example:5432/neondb",
      EXPECTED_PRODUCTION_HOST_FINGERPRINT:
        "e14b0f2020aee58fa590ed1eb5cd670dcfbcc788198027fbfbe6bee44b1a4a17",
    })).toThrow("REFUSING TO RUN DATABASE TESTS AGAINST PRODUCTION");
  });

  it.each([
    ["missing Production database name", { EXPECTED_PRODUCTION_DATABASE: undefined }],
    ["missing Production host fingerprint", { EXPECTED_PRODUCTION_HOST_FINGERPRINT: undefined }],
    ["non-test database name", { TEST_DATABASE_URL: "postgresql://tester:secret@test-db.example:5432/gallery" }],
  ])("fails closed for %s", (_label, override) => {
    expect(() => assertSafeTestDatabaseEnvironment({
      ...safeEnvironment,
      ...override,
    })).toThrow("REFUSING TO RUN DATABASE TESTS AGAINST PRODUCTION");
  });
});
