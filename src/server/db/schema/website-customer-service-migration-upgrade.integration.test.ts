import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { isDedicatedTestDatabase } from "@/server/db/test-database-safety";
import { createDrizzleCustomerServiceRepository } from "@/server/customer-service/repositories/drizzle-customer-service-repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(testDatabaseUrl)
  && isDedicatedTestDatabase(testDatabaseUrl, process.env.DATABASE_URL);

describe("migrationEntriesThroughTag", () => {
  it("stops at the exact 0052 tag even when reconciled journal indexes have drifted", () => {
    const entries = [
      { idx: 49, tag: "0051_dusty_annihilus" },
      { idx: 50, tag: "0052_next_human_robot" },
      { idx: 51, tag: "0053_ambiguous_otto_octavius" },
      { idx: 52, tag: "0054_order_system_historical_migration" },
    ] as const;

    expect(migrationEntriesThroughTag(entries, "0052_next_human_robot").map((entry) => entry.tag))
      .toEqual(["0051_dusty_annihilus", "0052_next_human_robot"]);
  });

  it.each([
    {
      name: "missing",
      entries: [{ idx: 49, tag: "0051_dusty_annihilus" }],
    },
    {
      name: "duplicated",
      entries: [
        { idx: 50, tag: "0052_next_human_robot" },
        { idx: 99, tag: "0052_next_human_robot" },
      ],
    },
  ])("fails closed when the target tag is $name", ({ entries }) => {
    expect(() => migrationEntriesThroughTag(entries, "0052_next_human_robot"))
      .toThrow(/exactly once/);
  });
});

function migrationEntriesThroughTag<T extends Readonly<{ tag: string }>>(
  entries: ReadonlyArray<T>,
  targetTag: string,
) {
  const targetPositions = entries.flatMap((entry, position) => (
    entry.tag === targetTag ? [position] : []
  ));
  if (targetPositions.length !== 1) {
    throw new Error(`Expected migration tag ${targetTag} exactly once, found ${targetPositions.length}`);
  }
  return entries.slice(0, targetPositions[0] + 1);
}

function isolatedMigrationFolder(schema: string, throughTag?: string) {
  const source = resolve("drizzle");
  const journal = JSON.parse(readFileSync(join(source, "meta/_journal.json"), "utf8")) as {
    version: string;
    dialect: string;
    entries: ReadonlyArray<Readonly<{ idx: number; tag: string }>>;
  };
  const entries = throughTag
    ? migrationEntriesThroughTag(journal.entries, throughTag)
    : journal.entries;
  const target = mkdtempSync(join(tmpdir(), "rnr-task15-upgrade-"));
  mkdirSync(join(target, "meta"));
  for (const entry of entries) {
    const sql = readFileSync(join(source, `${entry.tag}.sql`), "utf8")
      .replaceAll('"public".', `"${schema}".`)
      .replace(/\bpublic\./g, `"${schema}".`)
      .replaceAll("'public'", `'${schema}'`);
    writeFileSync(join(target, `${entry.tag}.sql`), sql);
  }
  writeFileSync(join(target, "meta/_journal.json"), JSON.stringify({
    version: journal.version,
    dialect: journal.dialect,
    entries,
  }));
  return target;
}

describe.runIf(enabled)("Task 15 migration upgrade", () => {
  it("upgrades legacy seven-day rate data without touching the seven-day session or conversation", async () => {
    const schema = `rnr_task15_upgrade_test_${randomUUID().replaceAll("-", "")}`;
    const client = new Client({ connectionString: testDatabaseUrl! });
    const subset = isolatedMigrationFolder(schema, "0052_next_human_robot");
    const full = isolatedMigrationFolder(schema);

    await client.connect();
    try {
      await client.query(`create schema "${schema}"`);
      await client.query(`set search_path to "${schema}"`);
      const database = drizzle(client) as unknown as
        Parameters<typeof createDrizzleCustomerServiceRepository>[0];
      await migrate(database, { migrationsFolder: subset, migrationsSchema: schema });

      const legacyConversationHash = "a1".repeat(32);
      const legacySessionHash = "a2".repeat(32);
      const legacyBucketHash = "a3".repeat(32);
      const compliantBucketHash = "a4".repeat(32);
      const now = new Date("2026-08-22T00:00:00.000Z");
      const [legacyConversation] = await client.query<{ id: string }>(
        "insert into customer_service_conversations (channel, external_key_hash) values ('website', $1) returning id",
        [legacyConversationHash],
      ).then((result) => result.rows);
      await client.query(
        "insert into customer_service_web_sessions (conversation_id, session_token_hash, expires_at, last_seen_at, created_at) values ($1, $2, $3, $4, $4)",
        [legacyConversation.id, legacySessionHash, new Date(now.getTime() + 7 * 86_400_000), now],
      );
      await client.query(
        "insert into customer_service_rate_limit_buckets (bucket_kind, bucket_key_hash, window_started_at, expires_at, request_count) values ('session_total', $1, $2, $3, 1)",
        [legacyBucketHash, now, new Date(now.getTime() + 7 * 86_400_000)],
      );
      await client.query(
        "insert into customer_service_rate_limit_buckets (bucket_kind, bucket_key_hash, window_started_at, expires_at, request_count) values ('session_total', $1, $2, $3, 1)",
        [compliantBucketHash, now, new Date(now.getTime() + 86_400_000)],
      );

      await migrate(database, { migrationsFolder: full, migrationsSchema: schema });

      const legacyRateData = await client.query<{ bucket_key_hash: string }>(
        "select bucket_key_hash from customer_service_rate_limit_buckets where bucket_key_hash = any($1::text[]) order by bucket_key_hash",
        [[legacyBucketHash, compliantBucketHash]],
      );
      expect(legacyRateData.rows).toEqual([{ bucket_key_hash: compliantBucketHash }]);
      await expect(client.query(
        "insert into customer_service_rate_limit_buckets (bucket_kind, bucket_key_hash, window_started_at, expires_at, request_count) values ('session_total', $1, $2, $3, 1)",
        ["a5".repeat(32), now, new Date(now.getTime() + 86_400_001)],
      )).rejects.toMatchObject({ code: "23514" });
      await expect(client.query<{ convalidated: boolean }>(
        "select convalidated from pg_constraint where conname = 'customer_service_rate_limit_buckets_window_bounded' and connamespace = $1::regnamespace",
        [schema],
      )).resolves.toMatchObject({ rows: [{ convalidated: true }] });
      await expect(client.query(
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
      await expect(client.query(
        "select 1 from customer_service_rate_limit_buckets where expires_at > window_started_at + interval '24 hours'",
      )).resolves.toMatchObject({ rowCount: 0 });
    } finally {
      await client.query("set search_path to public");
      await client.query(`drop schema if exists "${schema}" cascade`);
      await client.end();
      rmSync(subset, { recursive: true, force: true });
      rmSync(full, { recursive: true, force: true });
    }
  }, 120_000);
});
