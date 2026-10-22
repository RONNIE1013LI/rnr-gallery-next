// Disposable local PostgreSQL snapshot validation. Does not read .env or execute formal migrations.
import { readFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { generateDrizzleJson, generateMigration, pushSchema } from "drizzle-kit/api";
import * as schema from "../src/server/db/schema";
const docker = "/usr/local/bin/docker";
const name = "rnr-wise-preflight-20261022";
const applicationName = "rnr_gallery_test_release_gate_31578895_wisepreflight_app";
const databaseName = "rnr_gallery_test_release_gate_31578895_wisepreflight_integration";
function command(args: string[]) { return execFileSync(docker, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 }).trim(); }
async function main() {
  if (command(["inspect", "--format", '{{index .Config.Labels "codex.task"}}', name]) !== "wise-payid-preflight") throw new Error("Container ownership mismatch");
  const mapped = command(["port", name, "5432/tcp"]);
  if (!/^127\.0\.0\.1:\d+$/.test(mapped)) throw new Error("Test database must be loopback only");
  // Docker may return before PostgreSQL accepts connections.
  let ready = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    try { command(["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"]); ready = true; break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  if (!ready) { command(["stop", name]); throw new Error("Test PostgreSQL not ready"); }
  const adminUrl = `postgresql://postgres@${mapped}/postgres`;
  const admin = new pg.Pool({ connectionString: adminUrl });
  let pool: pg.Pool | undefined;
  try {
    await admin.query("create role rnr_app_runtime login");
    await admin.query(`create database ${databaseName}`);
    await admin.query(`create database ${applicationName}`);
    const url = `postgresql://postgres@${mapped}/${databaseName}`;
    pool = new pg.Pool({ connectionString: url });
    const tables = await pool.query("select count(*)::int as count from information_schema.tables where table_schema='public'");
    if (tables.rows[0].count !== 0) throw new Error("Snapshot target must be empty");
    const migrationMode = process.argv.includes("--migration");
    const baseline = migrationMode ? await generateMigration(generateDrizzleJson({}), JSON.parse(readFileSync("drizzle/meta/0072_snapshot.json", "utf8"))) : [];
    const delta = migrationMode ? readFileSync("drizzle/0073_wise_payid_aud.sql", "utf8").split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean) : [];
    const snapshotPlan = migrationMode ? undefined : await pushSchema(schema, drizzle(pool));
    const plan = snapshotPlan ?? { hasDataLoss: false, warnings: [], statementsToExecute: [...baseline, ...delta], async apply() {
      for (const statement of baseline) await pool!.query(statement);
      await pool!.query("grant usage on schema public to rnr_app_runtime");
      await pool!.query("grant select,insert,update,delete on all tables in schema public to rnr_app_runtime");
      await pool!.query("alter default privileges grant select,insert,update,delete on tables to rnr_app_runtime");
      await pool!.query("begin");
      for (const statement of delta) await pool!.query(statement);
      await pool!.query("rollback");
      const afterRollback = await pool!.query("select count(*)::int as count from pg_tables where schemaname='public' and tablename like 'wise_payid_%'");
      if (afterRollback.rows[0].count !== 0) throw new Error("Migration rollback failed");
      await pool!.query("begin");
      for (const statement of delta) await pool!.query(statement);
      await pool!.query("commit");
      const acl = await pool!.query("select has_table_privilege('rnr_app_runtime','wise_payid_audit','INSERT') as audit_insert,has_table_privilege('rnr_app_runtime','wise_payid_audit','UPDATE') as audit_update,has_table_privilege('rnr_app_runtime','wise_payid_audit','DELETE') as audit_delete,has_table_privilege('rnr_app_runtime','wise_payid_receipts','UPDATE') as receipt_update");
      if (!acl.rows[0].audit_insert || acl.rows[0].audit_update || acl.rows[0].audit_delete || !acl.rows[0].receipt_update) throw new Error("Wise runtime ACL invalid");
      console.log(JSON.stringify({runtimeAcl: "PASS",auditAppendOnly:true}));
      console.log(JSON.stringify({ migrationUpgrade: "PASS", rollback: "PASS", productionWritten: false }));
    } };
    if (plan.hasDataLoss || plan.warnings.length) throw new Error("Unexpected schema warning");
    console.log(JSON.stringify({ stage: "snapshot_plan", statements: plan.statementsToExecute.length, hasDataLoss: false, formalMigrationExecuted: migrationMode }));
    await plan.apply();
    await pool.query("insert into business_number_counter(key,current_value) values('order_job',10000)");
    // drizzle-kit 0.31.10 drops params in pushSchema's non-empty introspection adapter.
    // Keep the dependency unchanged; inspect the resulting catalog directly instead.
    const catalog = await pool.query("select tablename from pg_tables where schemaname='public' and tablename like 'wise_payid_%' order by tablename");
    if (catalog.rows.length !== 4) throw new Error("Incomplete Wise snapshot");
    console.log(JSON.stringify({ stage: "snapshot_catalog", wiseTables: catalog.rows.length, migrationJournalWritten: false }));
    const appUrl = `postgresql://postgres@${mapped}/${applicationName}`;
    const app = new pg.Pool({ connectionString: appUrl });
    try {
      for (const statement of plan.statementsToExecute) await app.query(statement);
      await app.query("insert into business_number_counter(key,current_value) values('order_job',10000)");
    } finally { await app.end(); }
    const identity = JSON.parse(readFileSync("/tmp/rnr-wise-production-identity.json", "utf8")) as { database: string; hostFingerprint: string };
    if (!identity.database || !/^[0-9a-f]{64}$/.test(identity.hostFingerprint)) throw new Error("Verified Production identity metadata required");
    const safeEnv: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG,
      NODE_ENV: "test", TEST_DATABASE_URL: url, DATABASE_URL: appUrl, EXPECTED_PRODUCTION_DATABASE: identity.database, EXPECTED_PRODUCTION_HOST_FINGERPRINT: identity.hostFingerprint, ENABLE_WISE_PAYID: "false", WISE_PAYID_AUTOMATCH_VERIFIED: "false" };
    const tests = process.argv.includes("--wise-only") ? ["src/server/payments/wise-payid-repository.integration.test.ts"] : ["src/server/payments/wise-payid-repository.integration.test.ts", "src/server/payments/drizzle-payment-repository.integration.test.ts",
      "src/server/payments/flik-repository.integration.test.ts", "src/server/payment-requests/drizzle-payment-request-repository.integration.test.ts"];
    const code = await new Promise<number>((resolve, reject) => {
      const child = spawn(process.execPath, ["node_modules/vitest/vitest.mjs", "run", ...tests], { cwd: process.cwd(), env: safeEnv, stdio: "inherit" });
      child.once("error", reject); child.once("exit", (value) => resolve(value ?? 1));
    });
    process.exitCode = code;
    if (migrationMode && code === 0) {
      const runtimeEnv = { ...safeEnv, TEST_DATABASE_URL: url.replace("postgres@", "rnr_app_runtime@") };
      const runtimeCode = await new Promise<number>((resolve, reject) => {
        const child = spawn(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "src/server/payments/wise-payid-repository.integration.test.ts", "-t", "automatically processes a JSON statement"], { cwd: process.cwd(), env: runtimeEnv, stdio: "inherit" });
        child.once("error", reject); child.once("exit", (value) => resolve(value ?? 1));
      });
      process.exitCode = runtimeCode;
    }
  } finally {
    await pool?.end();
    await admin.query(`drop database if exists ${databaseName} with (force)`);
    await admin.query(`drop database if exists ${applicationName} with (force)`);
    await admin.end();
    command(["stop", name]);
    console.log(JSON.stringify({ stage: "cleanup", disposableDatabaseRemoved: true, ownedContainerRemoved: true }));
  }
}
main().catch(() => { console.error("Isolated Wise database verification failed; inspect sanitized test diagnostics."); process.exitCode = 1; });
