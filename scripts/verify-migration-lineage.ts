import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  identifyDatabase,
  parseMigrationArguments,
} from "./migrate-database";
import {
  assertAppliedMigrationPrefix,
  readAppliedMigrationLineage,
  readLocalMigrationLineage,
  type MigrationLineageEntry,
} from "./migration-lineage";
import {
  selectMigrationTarget,
  verifyDatabaseIdentity,
  type DatabaseIdentity,
  type MigrationArguments,
} from "./migration-safety";
import {
  compareSchemaCatalogs,
  readSchemaCatalog,
  type CatalogDifference,
  type SchemaCatalog,
} from "./schema-catalog";

type EnvironmentValues = Readonly<Record<string, string | undefined>>;

export type LineageCheckArguments = MigrationArguments & Readonly<{
  compareTestCatalog: boolean;
}>;

type CatalogObjectCounts = Readonly<{
  tables: number;
  columns: number;
  indexes: number;
  constraints: number;
  enums: number;
  sequences: number;
}>;

type DatabaseReconciliationSummary = Readonly<{
  database: string;
  appliedCount: number;
  matchingPrefixCount: number;
  catalogObjectCounts: CatalogObjectCounts;
}>;

export type LineageCheckSummary = Readonly<{
  environment: "production";
  production: DatabaseReconciliationSummary;
  test?: DatabaseReconciliationSummary;
  differences: readonly CatalogDifference[];
}>;

type RunLineageCheckInput = Readonly<{
  args: LineageCheckArguments;
  env: EnvironmentValues;
  rootDir: string;
  identifyDatabase: (url: string, hostname: string) => Promise<DatabaseIdentity>;
  readLocalLineage: (rootDir: string) => readonly MigrationLineageEntry[];
  readAppliedLineage: (url: string) => Promise<readonly MigrationLineageEntry[]>;
  readCatalog: (url: string) => Promise<SchemaCatalog>;
}>;

export function parseLineageCheckArguments(args: readonly string[]): LineageCheckArguments {
  let compareTestCatalog = false;
  const migrationArguments: string[] = [];
  for (const argument of args) {
    if (argument === "--compare-test-catalog") {
      if (compareTestCatalog) throw new Error("Duplicate --compare-test-catalog argument");
      compareTestCatalog = true;
    } else {
      migrationArguments.push(argument);
    }
  }
  const parsed = parseMigrationArguments(migrationArguments);
  if (parsed.environment !== "production") {
    throw new Error("Lineage catalog checks require the production environment");
  }
  if (!parsed.expectedDatabase) {
    throw new Error("Expected database is required");
  }
  if (!parsed.expectedHostFingerprint) {
    throw new Error("Expected host fingerprint is required");
  }
  return Object.freeze({ ...parsed, compareTestCatalog });
}

async function safeRead<T>(label: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new Error(`${label} could not be read`);
  }
}

function catalogObjectCounts(catalog: SchemaCatalog): CatalogObjectCounts {
  return Object.freeze({
    tables: catalog.tables.length,
    columns: catalog.tables.reduce((count, table) => count + table.columns.length, 0),
    indexes: catalog.indexes.length,
    constraints: catalog.constraints.length,
    enums: catalog.enums.length,
    sequences: catalog.sequences.length,
  });
}

function databaseSummary(input: Readonly<{
  database: string;
  applied: readonly MigrationLineageEntry[];
  catalog: SchemaCatalog;
}>): DatabaseReconciliationSummary {
  return Object.freeze({
    database: input.database,
    appliedCount: input.applied.length,
    matchingPrefixCount: input.applied.length,
    catalogObjectCounts: catalogObjectCounts(input.catalog),
  });
}

export async function runLineageCheck(
  input: RunLineageCheckInput,
): Promise<LineageCheckSummary> {
  const productionTarget = selectMigrationTarget({ ...input.args, env: input.env });
  const testTarget = input.args.compareTestCatalog
    ? selectMigrationTarget({ environment: "test", env: input.env })
    : undefined;

  const productionIdentity = await safeRead(
    "Production database identity",
    () => input.identifyDatabase(productionTarget.url, productionTarget.hostname),
  );
  const safeProductionIdentity = verifyDatabaseIdentity({
    environment: "production",
    expectedDatabase: productionTarget.expectedDatabase,
    expectedHostFingerprint: productionTarget.expectedHostFingerprint,
  }, productionIdentity);

  let local: readonly MigrationLineageEntry[];
  try {
    local = input.readLocalLineage(input.rootDir);
  } catch {
    throw new Error("Local migration lineage could not be read");
  }
  const productionApplied = await safeRead(
    "Production migration lineage",
    () => input.readAppliedLineage(productionTarget.url),
  );
  assertAppliedMigrationPrefix(productionApplied, local);

  let testIdentity: DatabaseIdentity | undefined;
  let testApplied: readonly MigrationLineageEntry[] | undefined;
  if (testTarget) {
    testIdentity = await safeRead(
      "Test database identity",
      () => input.identifyDatabase(testTarget.url, testTarget.hostname),
    );
    verifyDatabaseIdentity({
      environment: "test",
      expectedDatabase: testTarget.expectedDatabase,
      expectedHostFingerprint: testTarget.expectedHostFingerprint,
    }, testIdentity);
    testApplied = await safeRead(
      "Test migration lineage",
      () => input.readAppliedLineage(testTarget.url),
    );
    assertAppliedMigrationPrefix(testApplied, local);
    if (testApplied.length !== productionApplied.length) {
      throw new Error("Test migration lineage length differs from Production");
    }
  }

  const productionCatalog = await safeRead(
    "Production schema catalog",
    () => input.readCatalog(productionTarget.url),
  );
  const testCatalog = testTarget
    ? await safeRead("Test schema catalog", () => input.readCatalog(testTarget.url))
    : undefined;
  const differences = testCatalog
    ? compareSchemaCatalogs(productionCatalog, testCatalog)
    : Object.freeze([] as CatalogDifference[]);
  if (differences.length > 0) {
    throw new Error(`Schema catalog mismatch: ${differences.map(({ path }) => path).join(", ")}`);
  }

  return Object.freeze({
    environment: "production",
    production: databaseSummary({
      database: safeProductionIdentity.database,
      applied: productionApplied,
      catalog: productionCatalog,
    }),
    ...(testIdentity && testApplied && testCatalog
      ? {
          test: databaseSummary({
            database: testIdentity.database,
            applied: testApplied,
            catalog: testCatalog,
          }),
        }
      : {}),
    differences,
  });
}

async function main() {
  const summary = await runLineageCheck({
    args: parseLineageCheckArguments(process.argv.slice(2)),
    env: process.env,
    rootDir: process.cwd(),
    identifyDatabase,
    readLocalLineage: readLocalMigrationLineage,
    readAppliedLineage: readAppliedMigrationLineage,
    readCatalog: readSchemaCatalog,
  });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

const entrypoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (entrypoint === import.meta.url) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Migration lineage check failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
