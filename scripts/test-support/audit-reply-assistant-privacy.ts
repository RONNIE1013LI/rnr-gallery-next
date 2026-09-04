import { createHash, randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import { isDedicatedTestDatabase } from "../../src/server/db/test-database-safety";
import { hasForbiddenDatabaseImport } from "./audit-reply-assistant-privacy-static";

const TABLES = [
  "customer_service_pilot_runs",
  "customer_service_conversations",
  "customer_service_messages",
  "customer_service_ai_attempts",
  "customer_service_feedback_events",
  "customer_service_budget_state",
  "customer_service_attachments",
  "customer_service_image_analysis_attempts",
  "customer_service_image_analysis_inputs",
  "customer_service_retention_holds",
  "customer_service_website_metric_events",
] as const;

type TableName = typeof TABLES[number];

const PHASE_2_META_RUNTIME_FILES = [
  "src/server/rnr-ai/meta/orchestrator.ts",
  "src/server/rnr-ai/meta/runtime.ts",
  "src/server/rnr-ai/meta/backlog-reconciler.ts",
  "src/server/rnr-ai/meta/reply-sender.ts",
] as const;

function auditPhase2StaticPrivacy() {
  const sources = PHASE_2_META_RUNTIME_FILES.map((path) => ({
    path,
    source: readFileSync(resolve(process.cwd(), path), "utf8"),
  }));
  const databaseImports = sources
    .filter(({ source }) => hasForbiddenDatabaseImport(source))
    .map(({ path }) => path);
  const logging = sources
    .filter(({ source }) => /\b(?:console|logger)\.(?:log|info|warn|error|debug)\s*\(/.test(source))
    .map(({ path }) => path);
  const graphPostFiles = sources
    .filter(({ source }) => /graph\.facebook\.com[\s\S]{0,240}\/messages/.test(source))
    .map(({ path }) => path);
  if (
    databaseImports.length > 0
    || logging.length > 0
    || graphPostFiles.length !== 1
    || graphPostFiles[0] !== "src/server/rnr-ai/meta/reply-sender.ts"
  ) throw new Error("phase_2_static_privacy_boundary_failed");
  return Object.freeze({
    filesInspected: sources.length,
    databaseImports: 0,
    loggingCalls: 0,
    graphPostFiles,
  });
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function databaseName(url: string) {
  return new URL(url).pathname.replace(/^\//, "");
}

async function main() {
  const phase2StaticPrivacy = auditPhase2StaticPrivacy();
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  const safetyDatabaseUrl = process.env.DATABASE_URL;
  if (
    !testDatabaseUrl
    || !isDedicatedTestDatabase(testDatabaseUrl, safetyDatabaseUrl)
  ) {
    throw new Error("privacy_audit_database_boundary_invalid");
  }

  const marker = randomUUID();
  const ids = {
    pilot: randomUUID(),
    conversation: randomUUID(),
    message: randomUUID(),
    aiAttempt: randomUUID(),
    feedback: randomUUID(),
    attachment: randomUUID(),
    imageAttempt: randomUUID(),
    retentionHold: randomUUID(),
    websiteMetricEvent: randomUUID(),
  };
  const scopeDigits = randomInt(100_000_000).toString().padStart(8, "0");
  const budgetScope = `daily:${scopeDigits.slice(0, 4)}-${scopeDigits.slice(4, 6)}-${scopeDigits.slice(6)}`;
  const conversationHash = hash(`${marker}:conversation`);
  const messageHash = hash(`${marker}:message`);
  const attachmentHash = hash(`${marker}:attachment`);
  const storageKey = `reply-assistant-audit/${hash(`${marker}:storage`)}.png`;
  const storageKeyHash = hash(storageKey);
  const imageHash = hash(`${marker}:image-bytes`);
  const client = new Client({ connectionString: testDatabaseUrl });
  let transactionOpen = false;

  try {
    await client.connect();
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout = '10s'");

    await client.query(
      `INSERT INTO customer_service_pilot_runs
        (id, name, channel, message_limit, next_sequence, status)
       VALUES ($1, $2, 'facebook', 1, 2, 'disabled')`,
      [ids.pilot, `task12-privacy-audit-${hash(marker).slice(0, 12)}`],
    );
    await client.query(
      `INSERT INTO customer_service_conversations
        (id, channel, external_key_hash)
       VALUES ($1, 'facebook', $2)`,
      [ids.conversation, conversationHash],
    );
    await client.query(
      `INSERT INTO customer_service_messages
        (id, conversation_id, channel, external_message_key_hash, direction, body,
         customer_text, received_at, ingest_status, pilot_run_id, pilot_sequence)
       VALUES ($1, $2, 'facebook', $3, 'incoming', $4, $4, now(), 'draft_ready', $5, 1)`,
      [ids.message, ids.conversation, messageHash, "Could you review this representative image?", ids.pilot],
    );
    await client.query(
      `INSERT INTO customer_service_attachments
        (id, message_id, conversation_id, external_attachment_key_hash, ordinal, kind,
         status, mime_type_hint, verified_mime_type, width, height, byte_size,
         private_storage_key, sha256, delete_due_at)
       VALUES ($1, $2, $3, $4, 0, 'image', 'stored', 'image/png', 'image/png',
         1, 1, 68, $5, $6, now() + interval '1 hour')`,
      [ids.attachment, ids.message, ids.conversation, attachmentHash, storageKey, imageHash],
    );
    await client.query(
      `INSERT INTO customer_service_image_analysis_attempts
        (id, message_id, conversation_id, attempt_number, status, provider_called,
         provider, model, schema_version, analysis_result, validator_codes,
         input_tokens, cached_input_tokens, output_tokens, estimated_cost_microusd,
         reserved_cost_microusd, latency_ms, completed_at)
       VALUES ($1, $2, $3, 1, 'analyzed', true, 'mock', 'privacy-audit-image', '1',
         $4::jsonb, '[]'::jsonb, 10, 2, 4, 25, 0, 5, now())`,
      [
        ids.imageAttempt,
        ids.message,
        ids.conversation,
        JSON.stringify({
          schemaVersion: "1",
          overallStatus: "assessed",
          images: [],
          comparison: null,
          recommendationCodes: [],
          safeSummary: "Representative safe image assessment.",
        }),
      ],
    );
    await client.query(
      `INSERT INTO customer_service_image_analysis_inputs
        (analysis_attempt_id, attachment_id, conversation_id, ordinal,
         external_attachment_key_hash, cleanup_status, verified_mime_type,
         width, height, byte_size, sha256, private_storage_key,
         private_storage_key_hash, delete_due_at)
       VALUES ($1, $2, $3, 0, $4, 'stored', 'image/png', 1, 1, 68,
         $5, $6, $7, now() + interval '1 hour')`,
      [
        ids.imageAttempt,
        ids.attachment,
        ids.conversation,
        attachmentHash,
        imageHash,
        storageKey,
        storageKeyHash,
      ],
    );
    await client.query(
      `INSERT INTO customer_service_ai_attempts
        (id, message_id, attempt_number, trigger, intent, risk_level, gate_result,
         gate_reasons, knowledge_sources, knowledge_version, status, provider_called,
         provider, model, draft_text, validator_codes, input_tokens,
         cached_input_tokens, output_tokens, estimated_cost_microusd,
         reserved_cost_microusd, latency_ms, completed_at)
       VALUES ($1, $2, 1, 'manual_generate', 'image_quality', 'low', 'allowed',
         '[]'::jsonb, $3::jsonb, 'privacy-audit-v1', 'draft_ready', true,
         'mock', 'privacy-audit-text', $4, '[]'::jsonb, 20, 5, 8, 40, 0, 7, now())`,
      [
        ids.aiAttempt,
        ids.message,
        JSON.stringify(["privacy-audit-safe-knowledge"]),
        "Thanks for the image. A human can review the safe assessment before replying.",
      ],
    );
    await client.query(
      `INSERT INTO customer_service_feedback_events
        (id, attempt_id, actor_user_id, action, human_final_text, idempotency_key)
       VALUES ($1, $2, null, 'accepted_unchanged', $3, $4)`,
      [
        ids.feedback,
        ids.aiAttempt,
        "Thanks for the image. We will review it before replying.",
        hash(`${marker}:feedback`),
      ],
    );
    await client.query(
      `INSERT INTO customer_service_budget_state
        (scope_key, spent_microusd, reserved_microusd)
       VALUES ($1, 65, 0)`,
      [budgetScope],
    );
    await client.query(
      `INSERT INTO customer_service_retention_holds
        (id, conversation_id, reason, reference_hash)
       VALUES ($1, $2, 'legal', $3)`,
      [ids.retentionHold, ids.conversation, hash(`${marker}:retention-hold`)],
    );
    await client.query(
      `INSERT INTO customer_service_website_metric_events
        (id, event_type, event_key_hash, occurred_at, expires_at)
       VALUES ($1, 'rate_block', $2, now(), now() + interval '24 hours')`,
      [ids.websiteMetricEvent, hash(`${marker}:rate-block`)],
    );

    const credentialPrefix = ["s", "k"].join("");
    const longLivedMetaPrefix = ["E", "AA"].join("");
    const forbiddenTextPattern = [
      "https?://",
      "scontent\\.",
      "(?:sender|page)[-_:][A-Za-z0-9]",
    ].join("|");
    const forbiddenCredentialPattern = [
      `${credentialPrefix}-[A-Za-z0-9_-]{20,}`,
      `${longLivedMetaPrefix}[A-Za-z0-9]{20,}`,
    ].join("|");
    const rowsInspected = {} as Record<TableName, number>;
    let forbiddenPatternRows = 0;

    for (const table of TABLES) {
      const result = await client.query<{ total: number; forbidden: number }>(
        `SELECT count(*)::int AS total,
                count(*) FILTER (
                  WHERE row_to_json(t)::text ~* $1
                     OR row_to_json(t)::text ~ $2
                )::int AS forbidden
           FROM ${table} AS t`,
        [forbiddenTextPattern, forbiddenCredentialPattern],
      );
      rowsInspected[table] = result.rows[0]?.total ?? 0;
      forbiddenPatternRows += result.rows[0]?.forbidden ?? 0;
    }

    const forbiddenColumnResult = await client.query<{ total: number }>(
      `SELECT count(*)::int AS total
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
          AND (
            data_type = 'bytea'
            OR column_name ~* '(^|_)(raw|source|attachment|remote)_?url($|_)'
            OR column_name ~* '(^|_)(sender|page)(_?(id|key))?($|_)'
            OR column_name ~* '(secret|api_key|access_token|verify_token)'
            OR column_name IN (
              'external_key',
              'external_message_key',
              'external_attachment_key',
              'conversation_key'
            )
          )`,
      [TABLES],
    );
    const forbiddenColumns = forbiddenColumnResult.rows[0]?.total ?? 0;

    const scopeResult = await client.query<{ total: number }>(
      `SELECT (
          (SELECT count(*) FROM customer_service_messages WHERE id = $1 AND conversation_id <> $2)
          + (SELECT count(*) FROM customer_service_attachments WHERE id = $3 AND conversation_id <> $2)
          + (SELECT count(*) FROM customer_service_image_analysis_attempts WHERE id = $4 AND conversation_id <> $2)
          + (SELECT count(*) FROM customer_service_image_analysis_inputs WHERE analysis_attempt_id = $4 AND conversation_id <> $2)
        )::int AS total`,
      [ids.message, ids.conversation, ids.attachment, ids.imageAttempt],
    );
    const conversationScopeViolations = scopeResult.rows[0]?.total ?? 0;
    const totalRowsInspected = Object.values(rowsInspected).reduce((sum, count) => sum + count, 0);

    if (
      Object.values(rowsInspected).some((count) => count < 1)
      || forbiddenPatternRows !== 0
      || forbiddenColumns !== 0
      || conversationScopeViolations !== 0
    ) {
      throw new Error("privacy_audit_assertion_failed");
    }

    await client.query("ROLLBACK");
    transactionOpen = false;

    const residualChecks = [
      ["customer_service_pilot_runs", "id", ids.pilot],
      ["customer_service_conversations", "id", ids.conversation],
      ["customer_service_messages", "id", ids.message],
      ["customer_service_ai_attempts", "id", ids.aiAttempt],
      ["customer_service_feedback_events", "id", ids.feedback],
      ["customer_service_budget_state", "scope_key", budgetScope],
      ["customer_service_attachments", "id", ids.attachment],
      ["customer_service_image_analysis_attempts", "id", ids.imageAttempt],
      ["customer_service_image_analysis_inputs", "analysis_attempt_id", ids.imageAttempt],
      ["customer_service_retention_holds", "id", ids.retentionHold],
      ["customer_service_website_metric_events", "id", ids.websiteMetricEvent],
    ] as const;
    let residualRowsAfterRollback = 0;
    for (const [table, column, value] of residualChecks) {
      const result = await client.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM ${table} WHERE ${column} = $1`,
        [value],
      );
      residualRowsAfterRollback += result.rows[0]?.total ?? 0;
    }
    if (residualRowsAfterRollback !== 0) throw new Error("privacy_audit_rollback_failed");

    process.stdout.write(`${JSON.stringify({
      status: "PASS",
      database: databaseName(testDatabaseUrl),
      transaction: "rolled_back",
      tablesInspected: TABLES.length,
      rowsInspected,
      totalRowsInspected,
      forbiddenPatternRows,
      forbiddenColumns,
      conversationScopeViolations,
      residualRowsAfterRollback,
      phase2StaticPrivacy,
    }, null, 2)}\n`);
  } finally {
    if (transactionOpen) await client.query("ROLLBACK");
    await client.end();
  }
}

void main().catch((error: unknown) => {
  const code = typeof error === "object" && error && "code" in error
    ? String(error.code)
    : "audit_failed";
  process.stderr.write(`reply_assistant_privacy_audit_failed code=${code}\n`);
  process.exitCode = 1;
});
