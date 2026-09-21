import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { allocateOrderNumber } from "./order-number";

if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required");
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const database = drizzle(pool);
const migration = readFileSync("drizzle/0069_transactional_business_numbers.sql", "utf8");
afterAll(() => pool.end());

async function withHistoricalNamespace(run: (schema: string, query: (sql: string) => Promise<unknown>) => Promise<void>) {
  const schema = `number_test_${randomUUID().replaceAll("-", "")}`;
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`create schema ${schema}`);
    await client.query(`set local search_path = ${schema}`);
    await client.query(`
      create sequence ${schema}.rnr_order_number_seq;
      create table ${schema}.orders (order_number text);
      create table ${schema}.production_jobs (job_number text, web_order_number text);
      create table ${schema}.invoices (invoice_number text, reference text, web_order_number text);
      create table ${schema}.order_system_migration_journal (source_ref_no text);
      create table ${schema}.admin_audit_logs (before_summary jsonb, after_summary jsonb);
      create table ${schema}.internal_notification_outbox (resource_reference text);
    `);
    await run(schema, async (statement) => (await client.query(statement)).rows);
  } finally {
    await client.query("rollback");
    client.release();
  }
}

const scopedMigration = (schema: string) => migration.replaceAll("public.", `${schema}.`);

describe("transaction-safe business counter", () => {
  it("rolls back allocations and returns the same next number on retry", async () => {
    const read = async () => BigInt((await pool.query("select current_value from business_number_counter where key='order_job'")).rows[0].current_value);
    const before = await read();
    await expect(database.transaction(async (transaction) => {
      expect(await allocateOrderNumber(transaction)).toBe((before + BigInt(1)).toString().padStart(5, "0"));
      throw new Error("rollback");
    })).rejects.toThrow("rollback");
    expect(await read()).toBe(before);
    await expect(database.transaction((transaction) => allocateOrderNumber(transaction))).resolves.toBe((before + BigInt(1)).toString().padStart(5, "0"));
  });

  it("serializes concurrent allocations into a unique contiguous range", async () => {
    const before = BigInt((await pool.query("select current_value from business_number_counter where key='order_job'")).rows[0].current_value);
    const values = await Promise.all(Array.from({ length: 20 }, () => database.transaction((transaction) => allocateOrderNumber(transaction))));
    expect(values.map(BigInt).sort((a, b) => a < b ? -1 : 1)).toEqual(Array.from({ length: 20 }, (_, index) => before + BigInt(index + 1)));
  });

  it("fails closed when the counter row is missing", async () => {
    await expect(database.transaction(async (transaction) => {
      await transaction.execute(sql`delete from business_number_counter where key='order_job'`);
      await allocateOrderNumber(transaction);
    })).rejects.toThrow("Order number allocation failed");
  });

  it("seeds from the untouched sequence even when no numeric records exist", async () => {
    await withHistoricalNamespace(async (schema, query) => {
      await query(scopedMigration(schema));
      expect(await query("select current_value::text from business_number_counter")).toEqual([{ current_value: "1" }]);
      expect(await query("select last_value::text, is_called from rnr_order_number_seq_retired")).toEqual([{ last_value: "1", is_called: false }]);
      expect(await query(`select to_regclass('${schema}.rnr_order_number_seq') as active`)).toEqual([{ active: null }]);
    });
  });

  it.each([
    ["sequence-only reservations", "select setval('rnr_order_number_seq', 84000)", "84000"],
    ["order", "insert into orders values ('85000')", "85000"],
    ["manual job", "insert into production_jobs values ('86000', '')", "86000"],
    ["invoice number", "insert into invoices values ('INV-87000', '', '')", "87000"],
    ["invoice reference", "insert into invoices values ('INV-LEGACY', '88000', '')", "88000"],
    ["migration history", "insert into order_system_migration_journal values ('89000')", "89000"],
    ["deleted manual audit", `insert into admin_audit_logs values ('{"jobNumber":"90000"}', '{}')`, "90000"],
    ["invoice audit", `insert into admin_audit_logs values ('{}', '{"invoiceNumber":"INV-91000"}')`, "91000"],
    ["notification history", "insert into internal_notification_outbox values ('92000')", "92000"],
  ])("preserves %s in the SAFE FLOOR and never decreases an existing counter", async (_label, seed, floor) => {
    await withHistoricalNamespace(async (schema, query) => {
      await query(seed);
      await query("insert into orders values ('RNR-PENDING-NONNUMERIC')");
      await query(scopedMigration(schema));
      expect(await query("select current_value::text from business_number_counter")).toEqual([{ current_value: floor }]);
      await query("update business_number_counter set current_value=current_value+1 where key='order_job'");
      await query(scopedMigration(schema));
      expect(await query("select current_value::text from business_number_counter")).toEqual([{ current_value: String(BigInt(floor) + BigInt(1)) }]);
    });
  });
});
