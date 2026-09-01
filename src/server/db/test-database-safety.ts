import { createHash } from "node:crypto";

const refusal = "REFUSING TO RUN DATABASE TESTS AGAINST PRODUCTION";

type DatabaseEnvironment = Readonly<Record<string, string | undefined>>;

type DatabaseTarget = Readonly<{
  database: string;
  hostname: string;
  port: string;
}>;

function parseDatabaseTarget(value: string | undefined): DatabaseTarget | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "postgres:" && url.protocol !== "postgresql:") || !url.hostname) {
      return null;
    }
    const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (!database) return null;
    return {
      database,
      hostname: url.hostname.toLowerCase(),
      port: url.port || "5432",
    };
  } catch {
    return null;
  }
}

function refuse(reason: string): never {
  throw new Error(`${refusal}: ${reason}`);
}

function sameTarget(left: DatabaseTarget, right: DatabaseTarget) {
  return left.hostname === right.hostname
    && left.port === right.port
    && left.database === right.database;
}

function databaseTarget(value: string) {
  const target = parseDatabaseTarget(value);
  return target ? `${target.hostname}:${target.port}/${target.database}` : null;
}

export function isDedicatedTestDatabase(
  testDatabaseUrl: string | undefined,
  applicationDatabaseUrl: string | undefined,
): boolean {
  if (!testDatabaseUrl || !applicationDatabaseUrl) return false;

  const testTarget = databaseTarget(testDatabaseUrl);
  const applicationTarget = databaseTarget(applicationDatabaseUrl);
  if (!testTarget || !applicationTarget || testTarget === applicationTarget) {
    return false;
  }

  const databaseName = new URL(testDatabaseUrl).pathname.replace(/^\//, "");
  return /(?:^|[-_])test(?:$|[-_])/.test(databaseName);
}

export function assertSafeTestDatabaseEnvironment(env: DatabaseEnvironment) {
  if (!env.TEST_DATABASE_URL?.trim()) return undefined;

  const test = parseDatabaseTarget(env.TEST_DATABASE_URL);
  if (!test) refuse("TEST_DATABASE_URL must be a valid PostgreSQL URL");
  if (!/(?:^|[-_])test(?:$|[-_])/i.test(test.database)) {
    refuse("TEST_DATABASE_URL must name a dedicated test database");
  }

  const productionDatabase = env.EXPECTED_PRODUCTION_DATABASE?.trim();
  const productionHostFingerprint = env.EXPECTED_PRODUCTION_HOST_FINGERPRINT
    ?.trim().toLowerCase();
  if (!productionDatabase
    || !productionHostFingerprint
    || !/^[0-9a-f]{64}$/.test(productionHostFingerprint)) {
    refuse("verified Production database identity metadata is required");
  }

  const comparisonVariables = [
    "DATABASE_URL",
    "PRODUCTION_DATABASE_URL",
    "POSTGRES_URL",
    "POSTGRES_PRISMA_URL",
    "POSTGRES_URL_NON_POOLING",
  ] as const;
  for (const variable of comparisonVariables) {
    const candidate = parseDatabaseTarget(env[variable]);
    if (candidate && sameTarget(test, candidate)) {
      refuse(`TEST_DATABASE_URL matches ${variable}`);
    }
  }

  const testHostFingerprint = createHash("sha256")
    .update(test.hostname)
    .digest("hex");
  if (testHostFingerprint === productionHostFingerprint
    || test.database === productionDatabase) {
    refuse("TEST_DATABASE_URL matches the verified Production identity");
  }

  return Object.freeze(test);
}
