import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import { describe, expect, it } from "vitest";
import { isDedicatedTestDatabase } from "@/server/db/test-database-safety";
import { createDrizzleCustomerServiceRepository } from "@/server/customer-service/repositories/drizzle-customer-service-repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(testDatabaseUrl)
  && isDedicatedTestDatabase(testDatabaseUrl, process.env.DATABASE_URL);

function migrationSubsetThrough0052() {
  const source = resolve("drizzle");
  const target = mkdtempSync(join(tmpdir(), "rnr-task15-upgrade-"));
  mkdirSync(join(target, "meta"));
  const journal = JSON.parse(readFileSync(join(source, "meta/_journal.json"), "utf8")) as {
    version: string;
    dialect: string;
    entries: ReadonlyArray<Readonly<{ idx: number; tag: string }>>;
  };
  const entries = journal.entries.filter((entry) => entry.idx <= 52);
  for (const entry of entries) cpSync(join(source, `${entry.tag}.sql`), join(target, `${entry.tag}.sql`));
  writeFileSync(join(target, "meta/_journal.json"), JSON.stringify({
    version: journal.version,
    dialect: journal.dialect,
    entries,
  }));
  return target;
}

describe.runIf(enabled)("Task 15 migration upgrade", () => {
  it("upgrades legacy seven-day rate data without touching the seven-day session or conversation", async () => {
    const databaseName = `rnr_task15_upgrade_test_${randomUUID().replaceAll("-", "")}`;
    const adminUrl = new URL(testDatabaseUrl!);
    adminUrl.pathname = "/postgres";
    const upgradeUrl = new URL(testDatabaseUrl!);
    upgradeUrl.pathname = `/${databaseName}`;
    const admin = new Client({ connectionString: adminUrl.href });
    const subset = migrationSubsetThrough0052();
    let pool: Pool | null = null;

    await admin.connect();
    try {
      await admin.query(`create database "${databaseName}"`);
      pool = new Pool({ connectionString: upgradeUrl.href, max: 2 });
      const database = drizzle(pool);
      await migrate(database, { migrationsFolder: subset });

      const legacyConversationHash = "a1".repeat(32);
      const legacySessionHash = "a2".repeat(32);
      const legacyBucketHash = "a3".repeat(32);
      const compliantBucketHash = "a4".repeat(32);
      const now = new Date("2026-08-22T00:00:00.000Z");
      const [legacyConversation] = await pool.query<{ id: string }>(
        "insert into customer_service_conversations (channel, external_key_hash) values ('website', $1) returning id",
        [legacyConversationHash],
      ).then((result) => result.rows);
      await pool.query(
        "insert into customer_service_web_sessions (conversation_id, session_token_hash, expires_at, last_seen_at) values ($1, $2, $3, $4)",
        [legacyConversation.id, legacySessionHash, new Date(now.getTime() + 7 * 86_400_000), now],
      );
      await pool.query(
        "insert into customer_service_rate_limit_buckets (bucket_kind, bucket_key_hash, window_started_at, expires_at, request_count) values ('session_total', $1, $2, $3, 1)",
        [legacyBucketHash, now, new Date(now.getTime() + 7 * 86_400_000)],
      );
      await pool.query(
        "insert into customer_service_rate_limit_buckets (bucket_kind, bucket_key_hash, window_started_at, expires_at, request_count) values ('session_total', $1, $2, $3, 1)",
        [compliantBucketHash, now, new Date(now.getTime() + 86_400_000)],
      );

      await migrate(database, { migrationsFolder: resolve("drizzle") });

      const legacyRateData = await pool.query<{ bucket_key_hash: string }>(
        "select bucket_key_hash from customer_service_rate_limit_buckets where bucket_key_hash = any($1::text[]) order by bucket_key_hash",
        [[legacyBucketHash, compliantBucketHash]],
      );
      expect(legacyRateData.rows).toEqual([{ bucket_key_hash: compliantBucketHash }]);
      await expect(pool.query(
        "insert into customer_service_rate_limit_buckets (bucket_kind, bucket_key_hash, window_started_at, expires_at, request_count) values ('session_total', $1, $2, $3, 1)",
        ["a5".repeat(32), now, new Date(now.getTime() + 86_400_001)],
      )).rejects.toMatchObject({ code: "23514" });
      await expect(pool.query<{ convalidated: boolean }>(
        "select convalidated from pg_constraint where conname = 'customer_service_rate_limit_buckets_window_bounded'",
      )).resolves.toMatchObject({ rows: [{ convalidated: true }] });
      await expect(pool.query(
        "select sessions.id from customer_service_web_sessions sessions join customer_service_conversations conversations on conversations.id = sessions.conversation_id where conversations.id = $1 and sessions.session_token_hash = $2",
        [legacyConversation.id, legacySessionHash],
      )).resolves.toMatchObject({ rowCount: 1 });

      const repository = createDrizzleCustomerServiceRepository(database, {
        reviewSelectorSecret: "task15-upgrade-review-selector-secret-at-least-32-bytes",
      });
      const runtimeResult = await repository.ingestConversationEvent({
        channel: "website",
        role: "customer",
        externalConversationKeyHash: "b1".repeat(32),
        externalMessageKeyHash: "b2".repeat(32),
        text: "Can you help with a custom banner?",
        attachments: [],
        imageJob: null,
        productContext: null,
        debounceMs: 2_000,
        receivedAt: now,
        websiteRateLimit: {
          sessionKeyHash: "b1".repeat(32),
          networkKeyHash: "b3".repeat(32),
          sessionExpiresAt: new Date(now.getTime() + 7 * 86_400_000),
          isNewSession: true,
        },
      });
      expect(runtimeResult).toMatchObject({ status: "turn_pending" });
      await expect(pool.query(
        "select 1 from customer_service_rate_limit_buckets where expires_at > window_started_at + interval '24 hours'",
      )).resolves.toMatchObject({ rowCount: 0 });
    } finally {
      if (pool) await pool.end();
      await admin.query(
        "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
        [databaseName],
      );
      await admin.query(`drop database if exists "${databaseName}"`);
      await admin.end();
      rmSync(subset, { recursive: true, force: true });
    }
  }, 120_000);
});
