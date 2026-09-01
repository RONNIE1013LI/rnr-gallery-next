import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { assertIsolatedTestDatabaseUrl } from "../../../../scripts/migration-safety";
import {
  reconcileCustomerServiceConversationIdentities,
} from "../../../../scripts/reconcile-customer-service-conversation-identities";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");
assertIsolatedTestDatabaseUrl(testDatabaseUrl, process.env);

type JournalEntry = Readonly<{ idx: number; tag: string }>;

function migrationEntriesThroughTag(
  entries: readonly JournalEntry[],
  targetTag: string,
) {
  const position = entries.findIndex((entry) => entry.tag === targetTag);
  if (position < 0 || entries.some((entry, index) => (
    index !== position && entry.tag === targetTag
  ))) {
    throw new Error(`Expected migration tag ${targetTag} exactly once`);
  }
  return entries.slice(0, position + 1);
}

function isolatedMigrationFolder(schema: string, throughTag?: string) {
  const source = resolve("drizzle");
  const journal = JSON.parse(readFileSync(join(source, "meta/_journal.json"), "utf8")) as {
    version: string;
    dialect: string;
    entries: readonly JournalEntry[];
  };
  const entries = throughTag
    ? migrationEntriesThroughTag(journal.entries, throughTag)
    : journal.entries;
  const target = mkdtempSync(join(tmpdir(), "rnr-identity-migration-"));
  mkdirSync(join(target, "meta"));
  for (const entry of entries) {
    const migrationSql = readFileSync(join(source, `${entry.tag}.sql`), "utf8")
      .replaceAll('"public".', `"${schema}".`)
      .replace(/\bpublic\./g, `"${schema}".`)
      .replaceAll("'public'", `'${schema}'`);
    writeFileSync(join(target, `${entry.tag}.sql`), migrationSql);
  }
  writeFileSync(join(target, "meta/_journal.json"), JSON.stringify({
    version: journal.version,
    dialect: journal.dialect,
    entries,
  }));
  return target;
}

function hash(byte: string) {
  return byte.repeat(64);
}

describe("customer identity migration", () => {
  it("backfills exact identities without merging conversations and enforces conversation ownership", async () => {
    const schema = `rnr_identity_0062_${randomUUID().replaceAll("-", "")}`;
    const client = new Client({ connectionString: testDatabaseUrl });
    const beforeIdentityMigration = isolatedMigrationFolder(
      schema,
      "0061_website_analytics_internal_traffic",
    );
    const allMigrations = isolatedMigrationFolder(schema);

    await client.connect();
    try {
      await client.query(`create schema "${schema}"`);
      await client.query(`set search_path to "${schema}"`);
      const database = drizzle(client);
      await migrate(database, {
        migrationsFolder: beforeIdentityMigration,
        migrationsSchema: schema,
      });

      const conversationRows = await client.query<{ id: string; external_key_hash: string }>(`
        insert into customer_service_conversations (channel, external_key_hash)
        values
          ('facebook', $1),
          ('website', $2),
          ('website', $3),
          ('website', $4),
          ('website', $5)
        returning id, external_key_hash
      `, [hash("a"), hash("b"), hash("c"), hash("d"), hash("e")]);
      const [facebook, stableA, stableB, fallback, conflicting] = conversationRows.rows;
      const stableVisitor = hash("1");
      await client.query(`
        insert into website_analytics_conversions (
          conversion_type, source_type, source_id, conversation_id,
          occurred_at, local_date, scope, visitor_digest, consent_linked
        ) values
          ('inquiry', 'customer_service_conversation', $1, $2, now(), '2026-09-01', 'website', $3, true),
          ('inquiry', 'customer_service_conversation', $4, $5, now(), '2026-09-01', 'website', $3, true),
          ('inquiry', 'customer_service_conversation', $6, $7, now(), '2026-09-01', 'website', $8, true),
          ('inquiry', 'customer_service_conversation', $9, $7, now(), '2026-09-01', 'website', $10, true)
      `, [
        randomUUID(), stableA.id, stableVisitor,
        randomUUID(), stableB.id,
        randomUUID(), conflicting.id, hash("2"),
        randomUUID(), hash("3"),
      ]);

      await migrate(database, {
        migrationsFolder: allMigrations,
        migrationsSchema: schema,
      });

      const backfill = await client.query<{
        conversation_id: string;
        channel: string;
        identity_kind: string;
        identity_key_hash: string;
      }>(`
        select conversation_id, channel, identity_kind, identity_key_hash
        from customer_service_conversation_identities
      `);
      expect(backfill.rowCount).toBe(5);
      expect(backfill.rows).toEqual(expect.arrayContaining([
        {
          conversation_id: facebook.id,
          channel: "facebook",
          identity_kind: "facebook_psid",
          identity_key_hash: facebook.external_key_hash,
        },
        {
          conversation_id: stableA.id,
          channel: "website",
          identity_kind: "website_stable_visitor",
          identity_key_hash: stableVisitor,
        },
        {
          conversation_id: stableB.id,
          channel: "website",
          identity_kind: "website_stable_visitor",
          identity_key_hash: stableVisitor,
        },
        {
          conversation_id: fallback.id,
          channel: "website",
          identity_kind: "website_conversation",
          identity_key_hash: fallback.external_key_hash,
        },
        {
          conversation_id: conflicting.id,
          channel: "website",
          identity_kind: "website_conversation",
          identity_key_hash: conflicting.external_key_hash,
        },
      ]));

      const lateConversations = await client.query<{ id: string; external_key_hash: string }>(`
        insert into customer_service_conversations (channel, external_key_hash)
        values ('facebook', $1), ('website', $2), ('website', $3)
        returning id, external_key_hash
      `, [hash("4"), hash("5"), hash("6")]);
      const [lateFacebook, lateStable, lateConflicting] = lateConversations.rows;
      await client.query(`
        insert into website_analytics_conversions (
          conversion_type, source_type, source_id, conversation_id,
          occurred_at, local_date, scope, visitor_digest, consent_linked
        ) values
          ('inquiry', 'customer_service_conversation', $1, $2, now(), '2026-09-01', 'website', $3, true),
          ('inquiry', 'customer_service_conversation', $4, $5, now(), '2026-09-01', 'website', $6, true),
          ('inquiry', 'customer_service_conversation', $7, $5, now(), '2026-09-01', 'website', $8, true)
      `, [
        randomUUID(), lateStable.id, hash("7"),
        randomUUID(), lateConflicting.id, hash("8"),
        randomUUID(), hash("9"),
      ]);
      await expect(reconcileCustomerServiceConversationIdentities(client)).resolves.toEqual({
        insertedCount: 3,
        missingCount: 0,
      });
      const lateLinks = await client.query<{
        conversation_id: string;
        identity_kind: string;
        identity_key_hash: string;
      }>(`
        select conversation_id, identity_kind, identity_key_hash
        from customer_service_conversation_identities
        where conversation_id = any($1::uuid[])
      `, [lateConversations.rows.map((row) => row.id)]);
      expect(lateLinks.rowCount).toBe(3);
      expect(lateLinks.rows).toEqual(expect.arrayContaining([
        {
          conversation_id: lateFacebook.id,
          identity_kind: "facebook_psid",
          identity_key_hash: lateFacebook.external_key_hash,
        },
        {
          conversation_id: lateStable.id,
          identity_kind: "website_stable_visitor",
          identity_key_hash: hash("7"),
        },
        {
          conversation_id: lateConflicting.id,
          identity_kind: "website_conversation",
          identity_key_hash: lateConflicting.external_key_hash,
        },
      ]));
      const missing = await client.query<{ count: number }>(`
        select count(*)::int as count
        from customer_service_conversations conversations
        left join customer_service_conversation_identities identities
          on identities.conversation_id = conversations.id
        where identities.conversation_id is null
      `);
      expect(missing.rows[0]?.count).toBe(0);

      const additional = await client.query<{ id: string }>(`
        insert into customer_service_conversations (channel, external_key_hash)
        values ('website', $1), ('website', $2), ('website', $3), ('facebook', $4)
        returning id
      `, [hash("f"), hash("0"), hash("1"), hash("2")]);
      const sharedIdentityHash = hash("9");
      await expect(client.query(`
        insert into customer_service_conversation_identities (
          conversation_id, channel, identity_kind, identity_key_hash
        ) values
          ($1, 'website', 'website_stable_visitor', $3),
          ($2, 'website', 'website_stable_visitor', $3)
      `, [additional.rows[0].id, additional.rows[1].id, sharedIdentityHash]))
        .resolves.toMatchObject({ rowCount: 2 });
      await expect(client.query(`
        insert into customer_service_conversation_identities (
          conversation_id, channel, identity_kind, identity_key_hash
        ) values ($1, 'facebook', 'facebook_psid', $2)
      `, [additional.rows[2].id, hash("0")])).rejects.toMatchObject({ code: "23503" });
      await expect(client.query(`
        insert into customer_service_conversation_identities (
          conversation_id, channel, identity_kind, identity_key_hash
        ) values ($1, 'website', 'facebook_psid', $2)
      `, [additional.rows[2].id, hash("0")])).rejects.toMatchObject({ code: "23514" });
      await expect(client.query(`
        insert into customer_service_conversation_identities (
          conversation_id, channel, identity_kind, identity_key_hash
        ) values ($1, 'facebook', 'website_conversation', $2)
      `, [additional.rows[3].id, hash("0")])).rejects.toMatchObject({ code: "23514" });
    } finally {
      await client.query("set search_path to public");
      await client.query(`drop schema if exists "${schema}" cascade`);
      await client.end();
      rmSync(beforeIdentityMigration, { recursive: true, force: true });
      rmSync(allMigrations, { recursive: true, force: true });
    }
  }, 120_000);
});
