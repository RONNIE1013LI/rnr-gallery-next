import { randomUUID } from "node:crypto";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import {
  customerServiceAiAttempts,
  customerServiceAttachments,
  customerServiceBudgetState,
  customerServiceConversations,
  customerServiceFeedbackEvents,
  customerServiceImageAnalysisAttempts,
  customerServiceImageAnalysisInputs,
  customerServiceMessages,
  customerServicePilotRuns,
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
];

describe("customer service schema contract", () => {
  it("defines the nine additive reply assistant tables", () => {
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
    ]);
  });

  it("persists image metadata without raw source URLs", () => {
    const attachmentColumns = getTableColumns(customerServiceAttachments);

    expect(attachmentColumns).toEqual(expect.objectContaining({
      externalAttachmentKeyHash: expect.anything(),
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

  it("keys each image analysis input to the same message as its parents", () => {
    const attachmentConfig = getTableConfig(customerServiceAttachments);
    const attemptConfig = getTableConfig(customerServiceImageAnalysisAttempts);
    const inputConfig = getTableConfig(customerServiceImageAnalysisInputs);

    expect(getTableColumns(customerServiceImageAnalysisInputs).messageId.notNull).toBe(true);
    expect(attachmentConfig.uniqueConstraints.map((constraint) => constraint.name)).toContain(
      "customer_service_attachments_id_message_unique",
    );
    expect(attemptConfig.uniqueConstraints.map((constraint) => constraint.name)).toContain(
      "customer_service_image_analysis_attempts_id_message_unique",
    );
    expect(inputConfig.foreignKeys).toHaveLength(2);
    expect(inputConfig.foreignKeys.map((foreignKey) => ({
      columns: foreignKey.reference().columns.map((column) => column.name),
      foreignColumns: foreignKey.reference().foreignColumns.map((column) => column.name),
      onDelete: foreignKey.onDelete,
    }))).toEqual(expect.arrayContaining([
      {
        columns: ["analysis_attempt_id", "message_id"],
        foreignColumns: ["id", "message_id"],
        onDelete: "restrict",
      },
      {
        columns: ["attachment_id", "message_id"],
        foreignColumns: ["id", "message_id"],
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

  databaseIt("rejects an image input that combines parents from different messages", async () => {
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
        "insert into customer_service_image_analysis_attempts (message_id, attempt_number, status, schema_version) values ($1, 1, 'pending', 'v1') returning id",
        [messageA.rows[0].id],
      );
      const attachmentB = await client.query(
        "insert into customer_service_attachments (message_id, external_attachment_key_hash, ordinal) values ($1, $2, 0) returning id",
        [messageB.rows[0].id, `schema-test-attachment-b-${randomUUID()}`],
      );

      await expect(client.query(
        "insert into customer_service_image_analysis_inputs (analysis_attempt_id, attachment_id, message_id, ordinal) values ($1, $2, $3, 0)",
        [attemptA.rows[0].id, attachmentB.rows[0].id, messageA.rows[0].id],
      )).rejects.toMatchObject({ code: "23503" });
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  });
});
