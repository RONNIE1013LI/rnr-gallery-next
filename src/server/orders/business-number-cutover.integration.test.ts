import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, expect, it } from "vitest";

if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required");
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const migration = readFileSync("drizzle/0069_transactional_business_numbers.sql", "utf8");
afterAll(() => pool.end());

it("drains in-flight allocation, fences OID and prepared calls, and rolls back cutover permissions", async () => {
  const schema = `cutover_${randomUUID().replaceAll("-", "")}`;
  const owner = await pool.connect();
  const old = await pool.connect();
  const cutter = await pool.connect();
  let migrating: Promise<unknown> | undefined;
  try {
    await owner.query("CREATE ROLE rnr_app_runtime NOLOGIN");
    await owner.query(`CREATE SCHEMA ${schema}; GRANT USAGE ON SCHEMA ${schema} TO rnr_app_runtime;
      CREATE SEQUENCE ${schema}.rnr_order_number_seq CACHE 10;
      GRANT USAGE, SELECT ON SEQUENCE ${schema}.rnr_order_number_seq TO rnr_app_runtime;
      CREATE TABLE ${schema}.orders(order_number text);
      CREATE TABLE ${schema}.production_jobs(job_number text, web_order_number text);
      CREATE TABLE ${schema}.invoices(invoice_number text, reference text, web_order_number text);
      CREATE TABLE ${schema}.order_system_migration_journal(source_ref_no text);
      CREATE TABLE ${schema}.admin_audit_logs(before_summary jsonb, after_summary jsonb);
      CREATE TABLE ${schema}.internal_notification_outbox(resource_reference text);`);
    const oid = (await owner.query(`SELECT '${schema}.rnr_order_number_seq'::regclass::oid AS oid`)).rows[0].oid;
    const sql = migration.replaceAll("public.", `${schema}.`);
    await cutter.query("SET statement_timeout=10000");
    await old.query("SET ROLE rnr_app_runtime");
    await old.query(`PREPARE legacy_number AS SELECT nextval('${schema}.rnr_order_number_seq')`);
    await old.query("BEGIN");
    expect((await old.query("EXECUTE legacy_number")).rows[0].nextval).toBe("1");
    const cutterPid = (await cutter.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    migrating = cutter.query(sql);
    let blocked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      blocked = (await owner.query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted) AS blocked", [cutterPid])).rows[0].blocked;
      if (blocked) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(blocked).toBe(true);
    await old.query("COMMIT");
    await migrating;
    expect((await owner.query(`SELECT current_value::text FROM ${schema}.business_number_counter`)).rows[0].current_value).toBe("10");
    await expect(old.query(`SELECT nextval(${oid}::regclass)`)).rejects.toMatchObject({ code: "42501" });
    await expect(old.query("EXECUTE legacy_number")).rejects.toBeDefined();
    expect((await owner.query(`SELECT last_value::text FROM ${schema}.rnr_order_number_seq_retired`)).rows[0].last_value).toBe("10");
    // Recreate only this disposable test namespace's pre-cutover state.
    await owner.query(`ALTER SEQUENCE ${schema}.rnr_order_number_seq_retired RENAME TO rnr_order_number_seq;
      GRANT USAGE ON SEQUENCE ${schema}.rnr_order_number_seq TO rnr_app_runtime;
      DROP TABLE ${schema}.business_number_counter;`);
    await cutter.query("BEGIN");
    await cutter.query(sql);
    await cutter.query("ROLLBACK");
    expect((await owner.query(`SELECT to_regclass('${schema}.rnr_order_number_seq') IS NOT NULL AS restored,
      has_sequence_privilege('rnr_app_runtime','${schema}.rnr_order_number_seq','USAGE') AS allowed`)).rows[0]).toEqual({ restored: true, allowed: true });
    expect((await old.query(`SELECT nextval(${oid}::regclass) AS number`)).rows[0].number).toBe("2");
  } finally {
    await old.query("ROLLBACK");
    if (migrating) await migrating.catch(() => undefined);
    await cutter.query("ROLLBACK");
    await old.query("RESET ROLE; DEALLOCATE ALL");
    await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await owner.query("DROP ROLE IF EXISTS rnr_app_runtime");
    owner.release(); old.release(); cutter.release();
  }
});
