import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  createWebsiteAnalyticsV2Backfill,
  WEBSITE_ANALYTICS_V2_BACKFILL_SOURCES,
  type WebsiteAnalyticsV2BackfillResult,
  type WebsiteAnalyticsV2BackfillSource,
} from "../src/server/analytics/website-analytics-v2-backfill";
import { identifyDatabase as identifyPostgresDatabase } from "./migrate-database";
import {
  selectMigrationTarget,
  verifyDatabaseIdentity,
  type DatabaseIdentity,
  type MigrationEnvironment,
} from "./migration-safety";

type EnvironmentValues = Readonly<Record<string, string | undefined>>;

export type WebsiteAnalyticsV2BackfillArguments = Readonly<{
  environment: MigrationEnvironment;
  dryRun: boolean;
  batchSize: number;
  sources?: readonly WebsiteAnalyticsV2BackfillSource[];
  fromOccurredAt?: Date;
  confirmProduction: boolean;
  expectedDatabase?: string;
  expectedHostFingerprint?: string;
}>;

type ExecuteInput = Readonly<{
  dryRun: boolean;
  batchSize: number;
  sources?: readonly WebsiteAnalyticsV2BackfillSource[];
  fromOccurredAt?: Date;
}>;

type RunCommandInput = Readonly<{
  args: readonly string[];
  env: EnvironmentValues;
  identifyDatabase: (url: string, hostname: string) => Promise<DatabaseIdentity>;
  execute: (url: string, input: ExecuteInput) => Promise<WebsiteAnalyticsV2BackfillResult>;
  writeSafeOutput: (output: unknown) => void;
}>;

function takeValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseWebsiteAnalyticsV2BackfillArguments(
  args: readonly string[],
): WebsiteAnalyticsV2BackfillArguments {
  let environment: MigrationEnvironment | undefined;
  let dryRun = false;
  let batchSize = 100;
  let confirmProduction = false;
  let expectedDatabase: string | undefined;
  let expectedHostFingerprint: string | undefined;
  let fromOccurredAt: Date | undefined;
  const sources: WebsiteAnalyticsV2BackfillSource[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--environment") {
      const value = takeValue(args, index, argument);
      if (value !== "test" && value !== "production") {
        throw new Error("Analytics backfill environment must be test or production");
      }
      environment = value;
      index += 1;
    } else if (argument === "--dry-run") {
      dryRun = true;
    } else if (argument === "--batch-size") {
      const value = Number(takeValue(args, index, argument));
      if (!Number.isSafeInteger(value) || value < 1 || value > 500) {
        throw new Error("Analytics backfill batch size must be between 1 and 500");
      }
      batchSize = value;
      index += 1;
    } else if (argument === "--source") {
      const value = takeValue(args, index, argument);
      if (!(WEBSITE_ANALYTICS_V2_BACKFILL_SOURCES as readonly string[]).includes(value)) {
        throw new Error("Analytics backfill source is invalid");
      }
      sources.push(value as WebsiteAnalyticsV2BackfillSource);
      index += 1;
    } else if (argument === "--from") {
      const value = takeValue(args, index, argument);
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
        throw new Error("Analytics backfill --from must be an ISO UTC timestamp");
      }
      fromOccurredAt = parsed;
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
      throw new Error(`Unknown analytics backfill argument: ${argument}`);
    }
  }
  if (!environment) throw new Error("Analytics backfill environment is required");
  if (new Set(sources).size !== sources.length) {
    throw new Error("Analytics backfill sources must not be duplicated");
  }
  return Object.freeze({
    environment,
    dryRun,
    batchSize,
    ...(sources.length > 0 ? { sources: Object.freeze(sources) } : {}),
    ...(fromOccurredAt ? { fromOccurredAt } : {}),
    confirmProduction,
    ...(expectedDatabase ? { expectedDatabase } : {}),
    ...(expectedHostFingerprint ? { expectedHostFingerprint } : {}),
  });
}

function safeOutput(
  environment: MigrationEnvironment,
  result: WebsiteAnalyticsV2BackfillResult,
) {
  return Object.freeze({
    environment,
    dryRun: result.dryRun,
    totals: {
      scanned: result.totals.scanned,
      created: result.totals.created,
      wouldCreate: result.totals.wouldCreate,
      unchanged: result.totals.unchanged,
      skipped: result.totals.skipped,
      failed: result.totals.failed,
    },
    sources: result.sources.map((source) => ({
      source: source.source,
      scanned: source.scanned,
      created: source.created,
      wouldCreate: source.wouldCreate,
      unchanged: source.unchanged,
      skipped: source.skipped,
      failed: source.failed,
      cursor: source.cursor
        ? { occurredAt: source.cursor.occurredAt, id: source.cursor.id }
        : null,
      complete: source.complete,
      busy: source.busy,
    })),
    limitations: [...result.limitations],
  });
}

export async function runWebsiteAnalyticsV2BackfillCommand(input: RunCommandInput) {
  const args = parseWebsiteAnalyticsV2BackfillArguments(input.args);
  const target = selectMigrationTarget({
    environment: args.environment,
    confirmProduction: args.confirmProduction,
    expectedDatabase: args.expectedDatabase,
    expectedHostFingerprint: args.expectedHostFingerprint,
    env: input.env,
  });
  const identity = await input.identifyDatabase(target.url, target.hostname);
  verifyDatabaseIdentity({
    environment: target.environment,
    expectedDatabase: target.expectedDatabase,
    expectedHostFingerprint: target.expectedHostFingerprint,
  }, identity);
  const result = await input.execute(target.url, {
    dryRun: args.dryRun,
    batchSize: args.batchSize,
    ...(args.sources ? { sources: args.sources } : {}),
    ...(args.fromOccurredAt ? { fromOccurredAt: args.fromOccurredAt } : {}),
  });
  const output = safeOutput(args.environment, result);
  input.writeSafeOutput(output);
  return output;
}

async function execute(url: string, input: ExecuteInput) {
  const pool = new Pool({ connectionString: url, max: 2 });
  try {
    return await createWebsiteAnalyticsV2Backfill(drizzle(pool)).run({
      ...input,
      stateKeyPrefix: "website-analytics-v2-cli",
      historical: true,
    });
  } finally {
    await pool.end();
  }
}

async function main() {
  await runWebsiteAnalyticsV2BackfillCommand({
    args: process.argv.slice(2),
    env: process.env,
    identifyDatabase: identifyPostgresDatabase,
    execute,
    writeSafeOutput(output) {
      process.stdout.write(`${JSON.stringify(output)}\n`);
    },
  });
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entrypoint === import.meta.url) {
  main().catch(() => {
    process.stderr.write("Website Analytics V2 backfill failed\n");
    process.exitCode = 1;
  });
}
