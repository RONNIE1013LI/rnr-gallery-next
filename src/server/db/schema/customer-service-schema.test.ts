import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import {
  customerServiceAiAttempts,
  customerServiceAttachments,
  customerServiceBudgetState,
  customerServiceConversations,
  customerServiceCaseMemories,
  customerServiceCaseRetrievals,
  customerServiceFeedbackEvents,
  customerServiceHumanReplyMatches,
  customerServiceHumanReplyMatchEvents,
  customerServiceImageAnalysisAttempts,
  customerServiceImageAnalysisInputs,
  customerServiceImageJobs,
  customerServiceMessages,
  customerServicePilotRuns,
  customerServiceLearningCandidates,
  customerServiceConversationEvents,
} from "./index";

const tables = [
  customerServicePilotRuns,
  customerServiceConversations,
  customerServiceMessages,
  customerServiceAiAttempts,
  customerServiceFeedbackEvents,
  customerServiceBudgetState,
  customerServiceAttachments,
  customerServiceImageAnalysisAttempts,
  customerServiceImageAnalysisInputs,
  customerServiceImageJobs,
];

const continuousLearningTables = [
  customerServiceHumanReplyMatches,
  customerServiceHumanReplyMatchEvents,
  customerServiceCaseMemories,
  customerServiceCaseRetrievals,
  customerServiceLearningCandidates,
];

describe("customer service schema contract", () => {
  it("creates the final image-attempt schema without legacy-state mutation", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle/0030_reply_assistant_production.sql"),
      "utf8",
    );

    expect(migration).toContain("CREATE TABLE \"customer_service_image_analysis_attempts\"");
    expect(migration).toContain("\"reserved_cost_microusd\" bigint DEFAULT 0 NOT NULL");
    expect(migration).toContain("\"budget_daily_scope_key\" text");
    expect(migration).not.toContain("customer_service_legacy_provider_pending_image_attempts");
  });

  it("defines the ten additive reply assistant tables", () => {
    expect(tables.map(getTableName)).toEqual([
      "customer_service_pilot_runs",
      "customer_service_conversations",
      "customer_service_messages",
      "customer_service_ai_attempts",
      "customer_service_feedback_events",
      "customer_service_budget_state",
      "customer_service_attachments",
      "customer_service_image_analysis_attempts",
      "customer_service_image_analysis_inputs",
      "customer_service_image_jobs",
    ]);
  });

  it("defines the five additive continuous-learning tables", () => {
    expect(continuousLearningTables.map(getTableName)).toEqual([
      "customer_service_human_reply_matches",
      "customer_service_human_reply_match_events",
      "customer_service_case_memories",
      "customer_service_case_retrievals",
      "customer_service_learning_candidates",
    ]);
  });

  it("extends conversation events with explicit sanitized timeline metadata", () => {
    expect(getTableColumns(customerServiceConversationEvents)).toEqual(expect.objectContaining({
      eventType: expect.anything(),
      bodyHash: expect.anything(),
      redactionCodes: expect.anything(),
      replyToExternalMessageKeyHash: expect.anything(),
      learningEligible: expect.anything(),
    }));
  });

  it("keeps case memories non-retrievable until an explicit decision", () => {
    const columns = getTableColumns(customerServiceCaseMemories);

    expect(columns.eligibilityStatus.default).toBe("pending_review");
    expect(columns.approvedByUserId.notNull).toBe(false);
    expect(columns.decidedAt.notNull).toBe(false);
  });

  it("keeps continuous-learning storage free of external identity and private contact fields", () => {
    const names = continuousLearningTables.flatMap((table) => (
      getTableConfig(table).columns.map((column) => column.name)
    ));

    expect(names).not.toEqual(expect.arrayContaining([
      "sender_id",
      "conversation_external_id",
      "psid",
      "email",
      "phone",
      "street_address",
      "bank_account",
      "raw_payload",
    ]));
  });

  it("uses a forward-only continuous-learning migration", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle/0032_reply_assistant_continuous_learning.sql"),
      "utf8",
    );

    expect(migration).toContain("CREATE TABLE \"customer_service_human_reply_matches\"");
    expect(migration).toContain("CREATE TABLE \"customer_service_case_memories\"");
    expect(migration).toContain("ADD COLUMN \"event_type\"");
    expect(migration).not.toMatch(/^\s*(?:DROP\s+(?:TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM)/im);
  });

  it("persists image metadata without raw source URLs", () => {
    const attachmentColumns = getTableColumns(customerServiceAttachments);

    expect(attachmentColumns).toEqual(expect.objectContaining({
      externalAttachmentKeyHash: expect.anything(),
      normalizedKind: expect.anything(),
      mimeTypeHint: expect.anything(),
      verifiedMimeType: expect.anything(),
      privateStorageKey: expect.anything(),
      sha256: expect.anything(),
    }));
    expect(Object.keys(attachmentColumns)).not.toContain("sourceUrl");
    expect(Object.keys(attachmentColumns)).not.toContain("rawBytes");
  });

  it("keeps image analysis inputs attributable through restrictive foreign keys", () => {
    const foreignKeys = [
      ...getTableConfig(customerServiceAttachments).foreignKeys,
      ...getTableConfig(customerServiceImageAnalysisAttempts).foreignKeys,
      ...getTableConfig(customerServiceImageAnalysisInputs).foreignKeys,
    ];

    expect(foreignKeys).toHaveLength(4);
    expect(foreignKeys.map((foreignKey) => foreignKey.onDelete)).toEqual([
      "restrict",
      "restrict",
      "restrict",
      "restrict",
    ]);
  });

  it("owns image reservations and temporary-object cleanup on exact attempts", () => {
    const attemptColumns = getTableColumns(customerServiceImageAnalysisAttempts);
    const inputColumns = getTableColumns(customerServiceImageAnalysisInputs);

    expect(attemptColumns).toEqual(expect.objectContaining({
      reservedCostMicrousd: expect.anything(),
      budgetDailyScopeKey: expect.anything(),
    }));
    expect(inputColumns).toEqual(expect.objectContaining({
      externalAttachmentKeyHash: expect.anything(),
      cleanupStatus: expect.anything(),
      privateStorageKey: expect.anything(),
      privateStorageKeyHash: expect.anything(),
      deleteDueAt: expect.anything(),
      deletedAt: expect.anything(),
      cleanupClaimToken: expect.anything(),
      cleanupClaimedAt: expect.anything(),
    }));
    expect(inputColumns.externalAttachmentKeyHash.notNull).toBe(true);
    expect(inputColumns.cleanupStatus.notNull).toBe(true);
  });

  it("persists durable staged jobs without a raw source column", () => {
    const columns = getTableColumns(customerServiceImageJobs);

    expect(columns).toEqual(expect.objectContaining({
      messageId: expect.anything(),
      stage: expect.anything(),
      status: expect.anything(),
      sourceCiphertext: expect.anything(),
      sourceExpiresAt: expect.anything(),
      leaseToken: expect.anything(),
      leaseExpiresAt: expect.anything(),
      reservedCostMicrousd: expect.anything(),
      budgetSettledAt: expect.anything(),
    }));
    expect(Object.keys(columns)).not.toEqual(expect.arrayContaining([
      "sourceUrl",
      "sourceRef",
      "rawBytes",
      "senderId",
    ]));
  });

  it("adds the final reply-assistant schema with forward-only statements", () => {
    const migration = readFileSync(resolve(process.cwd(), "drizzle/0030_reply_assistant_production.sql"), "utf8");

    expect(migration).toContain("CREATE TABLE \"customer_service_image_jobs\"");
    expect(migration).toContain("CREATE TABLE \"customer_service_messages\"");
    expect(migration.match(/CREATE TABLE \"customer_service_/g)).toHaveLength(10);
    expect(migration).not.toMatch(/^\s*(?:DROP\s+(?:TABLE|COLUMN|CONSTRAINT)|TRUNCATE|DELETE\s+FROM|UPDATE\s+|INSERT\s+INTO)/im);
  });

  it("keys image analysis inputs to the same conversation as their parents", () => {
    const messageConfig = getTableConfig(customerServiceMessages);
    const attachmentConfig = getTableConfig(customerServiceAttachments);
    const attemptConfig = getTableConfig(customerServiceImageAnalysisAttempts);
    const inputConfig = getTableConfig(customerServiceImageAnalysisInputs);

    expect(getTableColumns(customerServiceImageAnalysisInputs).conversationId.notNull).toBe(true);
    expect(Object.keys(getTableColumns(customerServiceImageAnalysisInputs))).not.toContain("messageId");
    expect(messageConfig.uniqueConstraints.map((constraint) => constraint.name)).toContain(
      "customer_service_messages_id_conversation_unique",
    );
    expect(attachmentConfig.uniqueConstraints.map((constraint) => constraint.name)).toContain(
      "customer_service_attachments_id_conversation_unique",
    );
    expect(attemptConfig.uniqueConstraints.map((constraint) => constraint.name)).toContain(
      "customer_service_image_analysis_attempts_id_conversation_unique",
    );
    expect(attachmentConfig.foreignKeys.map((foreignKey) => ({
      columns: foreignKey.reference().columns.map((column) => column.name),
      foreignColumns: foreignKey.reference().foreignColumns.map((column) => column.name),
      onDelete: foreignKey.onDelete,
    }))).toEqual([
      {
        columns: ["message_id", "conversation_id"],
        foreignColumns: ["id", "conversation_id"],
        onDelete: "restrict",
      },
    ]);
    expect(attemptConfig.foreignKeys.map((foreignKey) => ({
      columns: foreignKey.reference().columns.map((column) => column.name),
      foreignColumns: foreignKey.reference().foreignColumns.map((column) => column.name),
      onDelete: foreignKey.onDelete,
    }))).toEqual([
      {
        columns: ["message_id", "conversation_id"],
        foreignColumns: ["id", "conversation_id"],
        onDelete: "restrict",
      },
    ]);
    expect(inputConfig.foreignKeys).toHaveLength(2);
    expect(inputConfig.foreignKeys.map((foreignKey) => ({
      columns: foreignKey.reference().columns.map((column) => column.name),
      foreignColumns: foreignKey.reference().foreignColumns.map((column) => column.name),
      onDelete: foreignKey.onDelete,
    }))).toEqual(expect.arrayContaining([
      {
        columns: ["analysis_attempt_id", "conversation_id"],
        foreignColumns: ["id", "conversation_id"],
        onDelete: "restrict",
      },
      {
        columns: ["attachment_id", "conversation_id"],
        foreignColumns: ["id", "conversation_id"],
        onDelete: "restrict",
      },
    ]));
  });

  it("keeps customer text nullable for image-only messages", () => {
    expect(getTableColumns(customerServiceMessages).customerText.notNull).toBe(false);
  });

  it("stores immutable gate, provider, usage and cost facts", () => {
    const columns = getTableConfig(customerServiceAiAttempts).columns.map((column) => column.name);
    expect(columns).toEqual(expect.arrayContaining([
      "provider_called",
      "knowledge_version",
      "estimated_cost_microusd",
      "latency_ms",
      "gate_result",
      "validator_codes",
    ]));
  });

  it("never stores raw Meta identity, payload or secrets", () => {
    const names = tables.flatMap((table) => getTableConfig(table).columns.map((column) => column.name));
    expect(names).not.toEqual(expect.arrayContaining([
      "psid",
      "sender_id",
      "raw_payload",
      "access_token",
      "secret",
      "page_access_token",
    ]));
  });

  it("has duplicate, pilot and attempt uniqueness constraints", () => {
    expect(getTableConfig(customerServiceMessages).indexes.map((item) => item.config.name)).toEqual(
      expect.arrayContaining([
        "customer_service_messages_channel_external_unique",
        "customer_service_messages_pilot_sequence_unique",
      ]),
    );
    expect(getTableConfig(customerServiceAiAttempts).indexes.map((item) => item.config.name)).toContain(
      "customer_service_ai_attempts_message_number_unique",
    );
  });

  const databaseIt = process.env.TEST_DATABASE_URL ? it : it.skip;

  databaseIt("allows image analysis inputs from earlier messages in the same conversation", async () => {
    const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    await client.query("BEGIN");

    try {
      const conversation = await client.query(
        "insert into customer_service_conversations (channel, external_key_hash) values ('facebook', $1) returning id",
        [`schema-test-conversation-${randomUUID()}`],
      );
      const messageA = await client.query(
        "insert into customer_service_messages (conversation_id, channel, external_message_key_hash, body, received_at) values ($1, 'facebook', $2, 'image A', now()) returning id",
        [conversation.rows[0].id, `schema-test-message-a-${randomUUID()}`],
      );
      const messageB = await client.query(
        "insert into customer_service_messages (conversation_id, channel, external_message_key_hash, body, received_at) values ($1, 'facebook', $2, 'image B', now()) returning id",
        [conversation.rows[0].id, `schema-test-message-b-${randomUUID()}`],
      );
      const attemptA = await client.query(
        "insert into customer_service_image_analysis_attempts (message_id, conversation_id, attempt_number, status, schema_version) values ($1, $2, 1, 'pending', 'v1') returning id",
        [messageA.rows[0].id, conversation.rows[0].id],
      );
      const attachmentHash = `schema-test-attachment-b-${randomUUID()}`;
      const attachmentB = await client.query(
        "insert into customer_service_attachments (message_id, conversation_id, external_attachment_key_hash, ordinal) values ($1, $2, $3, 0) returning id",
        [messageB.rows[0].id, conversation.rows[0].id, attachmentHash],
      );

      const input = await client.query(
        "insert into customer_service_image_analysis_inputs (analysis_attempt_id, attachment_id, conversation_id, ordinal, external_attachment_key_hash) values ($1, $2, $3, 0, $4) returning analysis_attempt_id",
        [attemptA.rows[0].id, attachmentB.rows[0].id, conversation.rows[0].id, attachmentHash],
      );

      expect(input.rowCount).toBe(1);
      expect(input.rows[0].analysis_attempt_id).toBe(attemptA.rows[0].id);
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  });

  databaseIt("rejects an image input that combines parents from different conversations", async () => {
    const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    await client.query("BEGIN");

    try {
      const conversationA = await client.query(
        "insert into customer_service_conversations (channel, external_key_hash) values ('facebook', $1) returning id",
        [`schema-test-conversation-a-${randomUUID()}`],
      );
      const conversationB = await client.query(
        "insert into customer_service_conversations (channel, external_key_hash) values ('facebook', $1) returning id",
        [`schema-test-conversation-b-${randomUUID()}`],
      );
      const messageA = await client.query(
        "insert into customer_service_messages (conversation_id, channel, external_message_key_hash, body, received_at) values ($1, 'facebook', $2, 'image A', now()) returning id",
        [conversationA.rows[0].id, `schema-test-message-a-${randomUUID()}`],
      );
      const messageB = await client.query(
        "insert into customer_service_messages (conversation_id, channel, external_message_key_hash, body, received_at) values ($1, 'facebook', $2, 'image B', now()) returning id",
        [conversationB.rows[0].id, `schema-test-message-b-${randomUUID()}`],
      );
      const attemptA = await client.query(
        "insert into customer_service_image_analysis_attempts (message_id, conversation_id, attempt_number, status, schema_version) values ($1, $2, 1, 'pending', 'v1') returning id",
        [messageA.rows[0].id, conversationA.rows[0].id],
      );
      const attachmentHash = `schema-test-attachment-b-${randomUUID()}`;
      const attachmentB = await client.query(
        "insert into customer_service_attachments (message_id, conversation_id, external_attachment_key_hash, ordinal) values ($1, $2, $3, 0) returning id",
        [messageB.rows[0].id, conversationB.rows[0].id, attachmentHash],
      );

      await expect(client.query(
        "insert into customer_service_image_analysis_inputs (analysis_attempt_id, attachment_id, conversation_id, ordinal, external_attachment_key_hash) values ($1, $2, $3, 0, $4)",
        [attemptA.rows[0].id, attachmentB.rows[0].id, conversationA.rows[0].id, attachmentHash],
      )).rejects.toMatchObject({ code: "23503" });
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  });
});
