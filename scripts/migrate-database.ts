import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  sanitizedMigrationEnvironment,
  selectMigrationTarget,
  verifyDatabaseIdentity,
  type DatabaseIdentity,
  type MigrationArguments,
  type SafeDatabaseIdentity,
} from "./migration-safety";

type MigrationEnvironmentValues = Readonly<Record<string, string | undefined>>;

type RunMigrationInput = Readonly<{
  args: MigrationArguments;
  env: MigrationEnvironmentValues;
  identifyDatabase: (url: string, hostname: string) => Promise<DatabaseIdentity>;
  runDrizzle: (env: NodeJS.ProcessEnv) => Promise<number>;
  writeSafeIdentity: (identity: SafeDatabaseIdentity) => void;
}>;

function takeValue(args: readonly string[], index: number, flag: string) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseMigrationArguments(args: readonly string[]): MigrationArguments {
  let environment: MigrationArguments["environment"] | undefined;
  let confirmProduction = false;
  let expectedDatabase: string | undefined;
  let expectedHostFingerprint: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--environment") {
      const value = takeValue(args, index, argument);
      if (value !== "test" && value !== "production") {
        throw new Error("Migration environment must be test or production");
      }
      environment = value;
      index += 1;
    } else if (argument === "--confirm-production") {
      confirmProduction = true;
    } else if (argument === "--expected-database") {
      expectedDatabase = takeValue(args, index, argument);
      index += 1;
    } else if (argument === "--expected-host-fingerprint") {
      expectedHostFingerprint = takeValue(args, index, argument);
      index += 1;
    } else {
      throw new Error(`Unknown migration argument: ${argument}`);
    }
  }

  if (!environment) throw new Error("Migration environment is required");
  return Object.freeze({
    environment,
    confirmProduction,
    ...(expectedDatabase ? { expectedDatabase } : {}),
    ...(expectedHostFingerprint ? { expectedHostFingerprint } : {}),
  });
}

export async function identifyDatabase(
  connectionString: string,
  hostname: string,
): Promise<DatabaseIdentity> {
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = 10000");
    const result = await client.query<{
      database: string;
      server_version: string;
      in_recovery: boolean;
    }>(`select current_database() as database,
               version() as server_version,
               pg_is_in_recovery() as in_recovery`);
    const row = result.rows[0];
    if (!row) throw new Error("Database identity could not be read");
    await client.query("ROLLBACK");
    return Object.freeze({
      database: row.database,
      hostname,
      serverVersion: row.server_version,
      inRecovery: row.in_recovery,
    });
  } finally {
    await client.end();
  }
}

export function runDrizzle(env: NodeJS.ProcessEnv) {
  return new Promise<number>((resolveExit, reject) => {
    const executable = resolve("node_modules/.bin/drizzle-kit");
    const child = spawn(executable, ["migrate"], { env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Drizzle migration terminated by ${signal}`));
      else resolveExit(code ?? 1);
    });
  });
}

export async function runMigration(input: RunMigrationInput) {
  const target = selectMigrationTarget({ ...input.args, env: input.env });
  const actual = await input.identifyDatabase(target.url, target.hostname);
  const safeIdentity = verifyDatabaseIdentity({
    environment: target.environment,
    expectedDatabase: target.expectedDatabase,
    expectedHostFingerprint: target.expectedHostFingerprint,
  }, actual);
  input.writeSafeIdentity(safeIdentity);
  return input.runDrizzle(sanitizedMigrationEnvironment(input.env, target.url));
}

async function main() {
  const args = parseMigrationArguments(process.argv.slice(2));
  const exitCode = await runMigration({
    args,
    env: process.env,
    identifyDatabase,
    runDrizzle,
    writeSafeIdentity(identity) {
      process.stdout.write(`${JSON.stringify(identity)}\n`);
    },
  });
  process.exitCode = exitCode;
}

const entrypoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (entrypoint === import.meta.url) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Migration failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
