import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
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
});
