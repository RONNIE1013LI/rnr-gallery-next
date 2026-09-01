import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "pg";
import {
  identifyDatabase,
  parseMigrationArguments,
  verifyMigrationLineage,
} from "./migrate-database";
import {
  selectMigrationTarget,
  verifyDatabaseIdentity,
} from "./migration-safety";

export type CustomerIdentityReconciliationSummary = Readonly<{
  insertedCount: number;
  missingCount: number;
}>;

export async function reconcileCustomerServiceConversationIdentities(
  client: Pick<Client, "query">,
): Promise<CustomerIdentityReconciliationSummary> {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    await client.query("LOCK TABLE customer_service_conversations IN SHARE MODE");
    const inserted = await client.query<{ inserted_count: number }>(`
      WITH website_identity_evidence AS (
        SELECT
          conversation_id,
          min(visitor_digest) AS identity_key_hash
        FROM website_analytics_conversions
        WHERE conversion_type = 'inquiry'
          AND source_type = 'customer_service_conversation'
          AND consent_linked = true
          AND visitor_digest IS NOT NULL
        GROUP BY conversation_id
        HAVING count(DISTINCT visitor_digest) = 1
      ), inserted AS (
        INSERT INTO customer_service_conversation_identities (
          conversation_id,
          channel,
          identity_kind,
          identity_key_hash,
          created_at,
          updated_at
        )
        SELECT
          conversations.id,
          conversations.channel,
          CASE
            WHEN conversations.channel = 'facebook' THEN 'facebook_psid'
            WHEN evidence.identity_key_hash IS NOT NULL THEN 'website_stable_visitor'
            ELSE 'website_conversation'
          END,
          CASE
            WHEN conversations.channel = 'website'
              AND evidence.identity_key_hash IS NOT NULL
              THEN evidence.identity_key_hash
            ELSE conversations.external_key_hash
          END,
          conversations.created_at,
          conversations.updated_at
        FROM customer_service_conversations AS conversations
        LEFT JOIN website_identity_evidence AS evidence
          ON conversations.channel = 'website'
          AND evidence.conversation_id = conversations.id
        LEFT JOIN customer_service_conversation_identities AS identities
          ON identities.conversation_id = conversations.id
        WHERE identities.conversation_id IS NULL
        ON CONFLICT (conversation_id) DO NOTHING
        RETURNING conversation_id
      )
      SELECT count(*)::int AS inserted_count FROM inserted
    `);
    const missing = await client.query<{ missing_count: number }>(`
      SELECT count(*)::int AS missing_count
      FROM customer_service_conversations AS conversations
      LEFT JOIN customer_service_conversation_identities AS identities
        ON identities.conversation_id = conversations.id
      WHERE identities.conversation_id IS NULL
    `);
    const summary = Object.freeze({
      insertedCount: inserted.rows[0]?.inserted_count ?? 0,
      missingCount: missing.rows[0]?.missing_count ?? 0,
    });
    if (summary.missingCount !== 0) {
      throw new Error("customer_service_conversation_identity_reconciliation_incomplete");
    }
    await client.query("COMMIT");
    return summary;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  const args = parseMigrationArguments(process.argv.slice(2));
  const target = selectMigrationTarget({ ...args, env: process.env });
  const actual = await identifyDatabase(target.url, target.hostname);
  const safeIdentity = verifyDatabaseIdentity({
    environment: target.environment,
    expectedDatabase: target.expectedDatabase,
    expectedHostFingerprint: target.expectedHostFingerprint,
  }, actual);
  await verifyMigrationLineage(target.url);

  const client = new Client({ connectionString: target.url });
  try {
    await client.connect();
    const summary = await reconcileCustomerServiceConversationIdentities(client);
    process.stdout.write(`${JSON.stringify({ ...safeIdentity, ...summary })}\n`);
  } finally {
    await client.end();
  }
}

const entrypoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (entrypoint === import.meta.url) {
  main().catch((error: unknown) => {
    const message = error instanceof Error
      ? error.message
      : "Customer identity reconciliation failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
