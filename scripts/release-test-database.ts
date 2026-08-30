import { createHash, randomBytes } from "node:crypto";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import pg from "pg";
import { databaseHostFingerprint } from "./migration-safety";

const execFile = promisify(execFileCallback);

type ReleaseDatabaseNames = Readonly<{
  application: string;
  integration: string;
}>;

type ReleaseTestGateInput = Readonly<{
  adminUrl: string;
  originMainSha: string;
  runId: string;
  productionTargetFingerprints: readonly string[];
  expectedProductionDatabase: string;
  expectedProductionHostFingerprint: string;
  rootDir: string;
  baseEnvironment: Readonly<Record<string, string | undefined>>;
}>;

type ReleaseTestGateDependencies = Readonly<{
  createDatabase: (adminUrl: string, database: string) => Promise<void>;
  dropDatabase: (adminUrl: string, database: string) => Promise<void>;
  runCommand: (
    command: string,
    args: readonly string[],
    env: NodeJS.ProcessEnv,
    cwd?: string,
  ) => Promise<number>;
}>;

function postgresUrl(value: string, label: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a PostgreSQL URL`);
  }
  if ((url.protocol !== "postgres:" && url.protocol !== "postgresql:") || !url.hostname) {
    throw new Error(`${label} must be a PostgreSQL URL`);
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database) throw new Error(`${label} must name a database`);
  return { url, database };
}

export function databaseTargetFingerprint(value: string) {
  const { url, database } = postgresUrl(value, "Database URL");
  const identity = `${url.hostname.toLowerCase()}:${url.port || "5432"}/${database}`;
  return createHash("sha256").update(identity).digest("hex");
}

export function releaseDatabaseNames(gitSha: string, runId: string): ReleaseDatabaseNames {
  if (!/^[0-9a-f]{8,40}$/i.test(gitSha)) {
    throw new Error("A full or abbreviated Git SHA is required");
  }
  if (!/^[0-9A-Za-z_]{6,24}$/.test(runId)) {
    throw new Error("A safe release run identifier is required");
  }
  const normalizedRunId = runId.toLowerCase();
  const databaseRunId = normalizedRunId.length <= 12
    ? normalizedRunId
    : createHash("sha256").update(normalizedRunId).digest("hex").slice(0, 12);
  const prefix = `rnr_gallery_test_release_gate_${gitSha.slice(0, 8).toLowerCase()}_${databaseRunId}`;
  return Object.freeze({
    application: `${prefix}_app`,
    integration: `${prefix}_integration`,
  });
}

function databaseUrl(adminUrl: string, database: string) {
  const parsed = postgresUrl(adminUrl, "RELEASE_TEST_DATABASE_ADMIN_URL").url;
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

function assertSafeReleaseTargets(
  input: ReleaseTestGateInput,
  names: ReleaseDatabaseNames,
) {
  const admin = postgresUrl(input.adminUrl, "RELEASE_TEST_DATABASE_ADMIN_URL");
  if (!/^[0-9a-f]{64}$/i.test(input.expectedProductionHostFingerprint)) {
    throw new Error("Expected Production database host fingerprint must be SHA-256 hex");
  }
  if (
    databaseHostFingerprint(admin.url.hostname)
      === input.expectedProductionHostFingerprint.toLowerCase()
  ) {
    throw new Error("Release database administration must not use the Production database host");
  }
  if (admin.database === input.expectedProductionDatabase) {
    throw new Error("Release database administration must not connect through the Production database");
  }
  if (input.productionTargetFingerprints.length === 0) {
    throw new Error("At least one Production database fingerprint is required");
  }
  const productionTargetFingerprints = input.productionTargetFingerprints.map(
    (fingerprint) => fingerprint.toLowerCase(),
  );
  for (const fingerprint of input.productionTargetFingerprints) {
    if (!/^[0-9a-f]{64}$/i.test(fingerprint)) {
      throw new Error("Production database fingerprints must be SHA-256 hex");
    }
  }
  for (const database of [names.application, names.integration]) {
    if (!/^rnr_gallery_test_release_gate_[0-9a-f]{8}_[0-9a-z_]+_(?:app|integration)$/.test(database)) {
      throw new Error("Release database name is unsafe");
    }
    const targetFingerprint = databaseTargetFingerprint(databaseUrl(input.adminUrl, database));
    if (productionTargetFingerprints.includes(targetFingerprint)) {
      throw new Error("Release target matches a Production database fingerprint");
    }
  }
}

function releaseEnvironment(
  input: ReleaseTestGateInput,
  names: ReleaseDatabaseNames,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...input.baseEnvironment,
    NODE_ENV: "test",
  };
  for (const key of [
    "DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
    "PRODUCTION_DATABASE_URL",
    "TEST_DATABASE_URL",
    "DIRECT_URL",
    "POSTGRES_URL",
    "POSTGRES_URL_NON_POOLING",
    "POSTGRES_URL_NO_SSL",
    "POSTGRES_PRISMA_URL",
    "PGHOST",
    "PGHOST_UNPOOLED",
    "PGPORT",
    "PGDATABASE",
    "PGUSER",
    "PGPASSWORD",
    "POSTGRES_HOST",
    "POSTGRES_DATABASE",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
  ]) {
    delete env[key];
  }
  delete env.PRODUCTION_DATABASE_AUDIT_URL;
  delete env.RELEASE_TEST_DATABASE_ADMIN_URL;
  env.DATABASE_URL = databaseUrl(input.adminUrl, names.application);
  env.TEST_DATABASE_URL = databaseUrl(input.adminUrl, names.integration);
  env.EXPECTED_PRODUCTION_DATABASE = input.expectedProductionDatabase;
  env.EXPECTED_PRODUCTION_HOST_FINGERPRINT = input.expectedProductionHostFingerprint;
  return env;
}

export async function runReleaseTestGate(
  input: ReleaseTestGateInput,
  dependencies: ReleaseTestGateDependencies,
) {
  const names = releaseDatabaseNames(input.originMainSha, input.runId);
  assertSafeReleaseTargets(input, names);
  const created: string[] = [];
  let primaryFailure: unknown;
  try {
    await dependencies.createDatabase(input.adminUrl, names.application);
    created.push(names.application);
    await dependencies.createDatabase(input.adminUrl, names.integration);
    created.push(names.integration);

    const env = releaseEnvironment(input, names);
    const migrationExit = await dependencies.runCommand(
      "npm",
      ["run", "db:migrate", "--", "--environment", "test"],
      env,
      input.rootDir,
    );
    if (migrationExit !== 0) throw new Error("Release test migration failed");

    const testExit = await dependencies.runCommand(
      "npm",
      ["run", "test:run"],
      env,
      input.rootDir,
    );
    if (testExit !== 0) throw new Error("Release test suite failed");
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    let cleanupFailure: Error | undefined;
    for (const database of created.reverse()) {
      try {
        await dependencies.dropDatabase(input.adminUrl, database);
      } catch {
        cleanupFailure ??= new Error("Disposable release database cleanup failed");
      }
    }
    if (cleanupFailure) {
      if (primaryFailure) {
        throw new AggregateError(
          [primaryFailure, cleanupFailure],
          "Release test failed and disposable database cleanup failed",
        );
      }
      throw cleanupFailure;
    }
  }
}

async function createDatabase(adminUrl: string, database: string) {
  let created = false;
  try {
    const client = new pg.Client({ connectionString: adminUrl });
    try {
      await client.connect();
      const existing = await client.query<{ exists: boolean }>(
        "SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists",
        [database],
      );
      if (existing.rows[0]?.exists) {
        throw new Error("Disposable release database already exists");
      }
      await client.query(`CREATE DATABASE "${database}"`);
      created = true;
    } finally {
      await client.end();
    }

    const verification = new pg.Client({ connectionString: databaseUrl(adminUrl, database) });
    try {
      await verification.connect();
      const result = await verification.query<{ database: string }>(
        "SELECT current_database() AS database",
      );
      if (result.rows[0]?.database !== database) {
        throw new Error("Disposable release database identity verification failed");
      }
    } finally {
      await verification.end();
    }
  } catch (error) {
    if (created) {
      try {
        await dropDatabase(adminUrl, database);
      } catch {
        throw new Error("Disposable release database verification and cleanup failed");
      }
    }
    throw error;
  }
}

async function dropDatabase(adminUrl: string, database: string) {
  const client = new pg.Client({ connectionString: adminUrl });
  try {
    await client.connect();
    await client.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [database],
    );
    await client.query(`DROP DATABASE IF EXISTS "${database}"`);
  } finally {
    await client.end();
  }
}

function runCommand(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  cwd = process.cwd(),
) {
  return new Promise<number>((resolveExit, reject) => {
    const child = spawn(command, [...args], { cwd, env, stdio: "inherit" });
    const forwardSignal = (signal: NodeJS.Signals) => child.kill(signal);
    const interrupt = () => forwardSignal("SIGINT");
    const terminate = () => forwardSignal("SIGTERM");
    const cleanupListeners = () => {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    };
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", terminate);
    child.once("error", (error) => {
      cleanupListeners();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      cleanupListeners();
      if (signal) reject(new Error(`Release verification terminated by ${signal}`));
      else resolveExit(code ?? 1);
    });
  });
}

function requiredEnvironment(key: string) {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

async function main() {
  process.once("SIGINT", () => {
    process.exitCode = 130;
  });
  process.once("SIGTERM", () => {
    process.exitCode = 143;
  });
  try {
    await execFile("git", ["fetch", "origin", "--prune"], { cwd: process.cwd() });
    const { stdout } = await execFile("git", ["rev-parse", "origin/main"], {
      cwd: process.cwd(),
    });
    const originMainSha = stdout.trim();
    const runId = process.env.GITHUB_RUN_ID?.replace(/[^0-9A-Za-z_]/g, "_")
      ?? `${process.pid}_${randomBytes(3).toString("hex")}`;
    await runReleaseTestGate({
      adminUrl: requiredEnvironment("RELEASE_TEST_DATABASE_ADMIN_URL"),
      originMainSha,
      runId,
      productionTargetFingerprints: requiredEnvironment(
        "PRODUCTION_DATABASE_TARGET_FINGERPRINTS",
      ).split(",").map((value) => value.trim()).filter(Boolean),
      expectedProductionDatabase: requiredEnvironment("EXPECTED_PRODUCTION_DATABASE"),
      expectedProductionHostFingerprint: requiredEnvironment(
        "EXPECTED_PRODUCTION_HOST_FINGERPRINT",
      ),
      rootDir: process.cwd(),
      baseEnvironment: process.env,
    }, { createDatabase, dropDatabase, runCommand });
    process.stdout.write("RELEASE TEST DATABASE: CLEANUP PASS\n");
    process.stdout.write("RELEASE TEST GATE: PASS\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Release test gate failed";
    process.stderr.write(`RELEASE TEST GATE: FAIL\n${message}\n`);
    process.exitCode = 1;
  }
}

const entrypoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (entrypoint === import.meta.url) {
  void main();
}
