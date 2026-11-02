import { assertSafeTestDatabaseEnvironment } from "../../db/test-database-safety";

export function assertWiseDisposableDatabaseEnvironment(
  env: Readonly<Record<string, string | undefined>>,
) {
  const url = env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is required");
  assertSafeTestDatabaseEnvironment(env);
  const target = new URL(url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
    || !/^\/rnr_gallery_test_release_gate_[0-9a-f]{8}_[0-9a-z_]{6,12}_integration$/.test(target.pathname)
    || ["host", "hostaddr", "service"].some((key) => target.searchParams.has(key))) {
    throw new Error("Wise integration requires its own disposable local database");
  }
  return url;
}
