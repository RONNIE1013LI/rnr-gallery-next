import { createHash } from "node:crypto";

export type MigrationEnvironment = "test" | "production";

type MigrationEnvironmentValues = Readonly<
  Record<string, string | undefined>
>;

export type MigrationArguments = Readonly<{
  environment: MigrationEnvironment;
  confirmProduction: boolean;
  expectedDatabase?: string;
  expectedHostFingerprint?: string;
}>;

export type SelectedMigrationTarget = Readonly<{
  environment: MigrationEnvironment;
  url: string;
  database: string;
  hostname: string;
  expectedDatabase: string;
  expectedHostFingerprint: string;
}>;

export type DatabaseIdentity = Readonly<{
  database: string;
  hostname: string;
  serverVersion: string;
  inRecovery: boolean;
}>;

export type SafeDatabaseIdentity = Readonly<{
  environment: MigrationEnvironment;
  database: string;
  hostFingerprint: string;
  serverVersion: string;
  inRecovery: boolean;
}>;

function requiredPostgresUrl(value: string | undefined, variable: string) {
  if (!value?.trim()) throw new Error(`${variable} is required`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${variable} must be a PostgreSQL URL`);
  }
  if (!url.protocol.startsWith("postgres") || !url.hostname) {
    throw new Error(`${variable} must be a PostgreSQL URL`);
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database) throw new Error(`${variable} must name a database`);
  return { url: value, database, hostname: url.hostname };
}

export function databaseHostFingerprint(hostname: string) {
  return createHash("sha256").update(hostname.toLowerCase()).digest("hex");
}

function sameDatabaseUrl(left: string | undefined, right: string) {
  if (!left?.trim()) return false;
  const leftUrl = new URL(requiredPostgresUrl(left, "database comparison URL").url);
  const rightUrl = new URL(requiredPostgresUrl(right, "TEST_DATABASE_URL").url);
  return leftUrl.hostname.toLowerCase() === rightUrl.hostname.toLowerCase()
    && (leftUrl.port || "5432") === (rightUrl.port || "5432")
    && decodeURIComponent(leftUrl.pathname.replace(/^\//, ""))
      === decodeURIComponent(rightUrl.pathname.replace(/^\//, ""));
}

export function assertIsolatedTestDatabaseUrl(
  testDatabaseUrl: string | undefined,
  env: MigrationEnvironmentValues,
) {
  const selected = requiredPostgresUrl(testDatabaseUrl, "TEST_DATABASE_URL");
  if (!/(?:^|[_-])test(?:$|[_-])/i.test(selected.database)) {
    throw new Error("TEST_DATABASE_URL must name a dedicated test database");
  }
  const expectedProductionDatabase = env.EXPECTED_PRODUCTION_DATABASE?.trim();
  const expectedProductionHostFingerprint = env.EXPECTED_PRODUCTION_HOST_FINGERPRINT
    ?.trim().toLowerCase();
  if (!expectedProductionDatabase
    || !expectedProductionHostFingerprint
    || !/^[0-9a-f]{64}$/.test(expectedProductionHostFingerprint)) {
    throw new Error("Safe Production database identity metadata is required for Test DB isolation");
  }
  if (
    sameDatabaseUrl(env.DATABASE_URL, selected.url) ||
    sameDatabaseUrl(env.PRODUCTION_DATABASE_URL, selected.url) ||
    (selected.database === expectedProductionDatabase
      && databaseHostFingerprint(selected.hostname) === expectedProductionHostFingerprint)
  ) {
    throw new Error("The test database must differ from application and production databases");
  }
  return Object.freeze(selected);
}

export function selectMigrationTarget(input: Omit<MigrationArguments, "confirmProduction"> & {
  confirmProduction?: boolean;
  env: MigrationEnvironmentValues;
}): SelectedMigrationTarget {
  if (input.environment === "test") {
    const selected = assertIsolatedTestDatabaseUrl(
      input.env.TEST_DATABASE_URL,
      input.env,
    );
    return Object.freeze({
      environment: "test",
      ...selected,
      expectedDatabase: selected.database,
      expectedHostFingerprint: databaseHostFingerprint(selected.hostname),
    });
  }

  const selected = requiredPostgresUrl(
    input.env.PRODUCTION_DATABASE_URL,
    "PRODUCTION_DATABASE_URL",
  );
  if (!input.confirmProduction) {
    throw new Error("Explicit production migration confirmation is required");
  }
  if (!input.expectedDatabase || !input.expectedHostFingerprint) {
    throw new Error("Both expected production database and host fingerprint are required");
  }
  if (!/^[0-9a-f]{64}$/i.test(input.expectedHostFingerprint)) {
    throw new Error("Expected production host fingerprint must be SHA-256 hex");
  }
  return Object.freeze({
    environment: "production",
    ...selected,
    expectedDatabase: input.expectedDatabase,
    expectedHostFingerprint: input.expectedHostFingerprint.toLowerCase(),
  });
}

export function verifyDatabaseIdentity(
  expected: Readonly<{
    environment: MigrationEnvironment;
    expectedDatabase: string;
    expectedHostFingerprint: string;
  }>,
  actual: DatabaseIdentity,
): SafeDatabaseIdentity {
  const hostFingerprint = databaseHostFingerprint(actual.hostname);
  if (
    actual.database !== expected.expectedDatabase ||
    hostFingerprint !== expected.expectedHostFingerprint ||
    actual.inRecovery
  ) {
    throw new Error("Database identity mismatch; migration refused");
  }
  return Object.freeze({
    environment: expected.environment,
    database: actual.database,
    hostFingerprint,
    serverVersion: actual.serverVersion,
    inRecovery: actual.inRecovery,
  });
}

export function sanitizedMigrationEnvironment(
  env: MigrationEnvironmentValues,
  selectedUrl: string,
): NodeJS.ProcessEnv {
  const child = { ...env };
  delete child.DATABASE_URL;
  delete child.TEST_DATABASE_URL;
  delete child.PRODUCTION_DATABASE_URL;
  const nodeEnvironment =
    env.NODE_ENV === "test" ||
    env.NODE_ENV === "development" ||
    env.NODE_ENV === "production"
      ? env.NODE_ENV
      : "production";
  return {
    ...child,
    NODE_ENV: nodeEnvironment,
    DATABASE_URL: selectedUrl,
  };
}
