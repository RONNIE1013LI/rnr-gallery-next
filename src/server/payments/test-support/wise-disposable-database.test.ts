import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { releaseDatabaseNames } from "../../../../scripts/release-test-database";
import { assertWiseDisposableDatabaseEnvironment } from "./wise-disposable-database";

const productionHostname = "production.example.test";
const names = releaseDatabaseNames("12345678", "session_123456789");
const environment = {
  TEST_DATABASE_URL: `postgresql://tester@127.0.0.1:55443/${names.integration}`,
  DATABASE_URL: `postgresql://tester@127.0.0.1:55443/${names.application}`,
  EXPECTED_PRODUCTION_DATABASE: "neondb",
  EXPECTED_PRODUCTION_HOST_FINGERPRINT: createHash("sha256").update(productionHostname).digest("hex"),
};

describe("Wise disposable database guard", () => {
  it.each(["run123", "session_123", "session_123456789", "wisepreflight"])(
    "accepts the release runner's session-specific integration database for %s",
    (runId) => {
      const database = releaseDatabaseNames("12345678", runId).integration;
      const url = `postgresql://tester@127.0.0.1:55443/${database}`;
      expect(assertWiseDisposableDatabaseEnvironment({ ...environment, TEST_DATABASE_URL: url })).toBe(url);
    },
  );

  it.each(["localhost", "[::1]"])("accepts loopback host %s", (hostname) => {
    const url = `postgresql://tester@${hostname}:55443/${names.integration}`;
    expect(assertWiseDisposableDatabaseEnvironment({ ...environment, TEST_DATABASE_URL: url })).toBe(url);
  });

  it.each([
    "rnr_gallery_test",
    names.application,
    "rnr_gallery_test_release_gate_12345678_short_integration",
    "rnr_gallery_test_release_gate_12345678_sessiontoolong_integration",
    "rnr_gallery_test_release_gate_invalid_run123_integration",
  ])("rejects non-session integration database %s", (database) => {
    expect(() => assertWiseDisposableDatabaseEnvironment({
      ...environment, TEST_DATABASE_URL: `postgresql://tester@127.0.0.1:55443/${database}`,
    })).toThrow();
  });

  it.each(["host", "hostaddr", "service"])("rejects connection redirection through %s", (key) => {
    expect(() => assertWiseDisposableDatabaseEnvironment({
      ...environment, TEST_DATABASE_URL: `${environment.TEST_DATABASE_URL}?${key}=elsewhere`,
    })).toThrow("disposable local database");
  });

  it.each([
    { TEST_DATABASE_URL: undefined },
    { TEST_DATABASE_URL: environment.TEST_DATABASE_URL.replace("127.0.0.1", "remote.example.test") },
    { TEST_DATABASE_URL: environment.TEST_DATABASE_URL.replace("postgresql:", "https:") },
    { DATABASE_URL: environment.TEST_DATABASE_URL },
    { EXPECTED_PRODUCTION_DATABASE: names.integration },
    { EXPECTED_PRODUCTION_HOST_FINGERPRINT: createHash("sha256").update("127.0.0.1").digest("hex") },
    { EXPECTED_PRODUCTION_DATABASE: undefined },
    { EXPECTED_PRODUCTION_HOST_FINGERPRINT: undefined },
  ])("fails closed for unsafe environment %j", (override) => {
    expect(() => assertWiseDisposableDatabaseEnvironment({ ...environment, ...override })).toThrow();
  });
});
