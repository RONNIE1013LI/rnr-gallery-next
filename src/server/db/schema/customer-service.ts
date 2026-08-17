import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

const updatedTimestamp = () => timestamp("updated_at", { withTimezone: true })
  .defaultNow()
  .$onUpdate(() => /* @__PURE__ */ new Date())
  .notNull();

export const customerServicePilotRuns = pgTable(
  "customer_service_pilot_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    channel: text("channel").$type<"facebook" | "website">().notNull(),
    messageLimit: integer("message_limit").notNull(),
    nextSequence: integer("next_sequence").default(1).notNull(),
    status: text("status").$type<"disabled" | "active" | "completed" | "stopped">().default("disabled").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: updatedTimestamp(),
  },
  (table) => [
    uniqueIndex("customer_service_pilot_runs_name_unique").on(table.name),
    uniqueIndex("customer_service_pilot_runs_active_channel_unique")
      .on(table.channel)
      .where(sql`${table.status} = 'active'`),
    check("customer_service_pilot_runs_channel_valid", sql`${table.channel} in ('facebook', 'website')`),
    check("customer_service_pilot_runs_status_valid", sql`${table.status} in ('disabled', 'active', 'completed', 'stopped')`),
    check("customer_service_pilot_runs_limits_valid", sql`${table.messageLimit} > 0 and ${table.nextSequence} > 0`),
    check(
      "customer_service_pilot_runs_completion_valid",
      sql`(${table.status} = 'completed' and ${table.completedAt} is not null) or (${table.status} <> 'completed' and ${table.completedAt} is null)`,
    ),
  ],
);

export const customerServiceConversations = pgTable(
  "customer_service_conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    channel: text("channel").$type<"facebook" | "website">().notNull(),
    externalKeyHash: text("external_key_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: updatedTimestamp(),
  },
  (table) => [
    uniqueIndex("customer_service_conversations_channel_external_unique")
      .on(table.channel, table.externalKeyHash),
    check("customer_service_conversations_channel_valid", sql`${table.channel} in ('facebook', 'website')`),
    check("customer_service_conversations_external_hash_valid", sql`length(trim(${table.externalKeyHash})) > 0`),
  ],
);

export const customerServiceMessages = pgTable(
  "customer_service_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id").notNull().references(() => customerServiceConversations.id, { onDelete: "restrict" }),
    channel: text("channel").$type<"facebook" | "website">().notNull(),
    externalMessageKeyHash: text("external_message_key_hash").notNull(),
    direction: text("direction").$type<"incoming">().default("incoming").notNull(),
    body: text("body").notNull(),
    customerText: text("customer_text"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    ingestStatus: text("ingest_status")
      .$type<"received" | "processing" | "draft_ready" | "blocked" | "provider_error" | "output_blocked">()
      .default("received")
      .notNull(),
    pilotRunId: uuid("pilot_run_id").references(() => customerServicePilotRuns.id, { onDelete: "restrict" }),
    pilotSequence: integer("pilot_sequence"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: updatedTimestamp(),
  },
  (table) => [
    uniqueIndex("customer_service_messages_channel_external_unique")
      .on(table.channel, table.externalMessageKeyHash),
    uniqueIndex("customer_service_messages_pilot_sequence_unique")
      .on(table.pilotRunId, table.pilotSequence)
      .where(sql`${table.pilotRunId} is not null and ${table.pilotSequence} is not null`),
    index("customer_service_messages_conversation_received_idx").on(table.conversationId, table.receivedAt),
    index("customer_service_messages_created_idx").on(table.createdAt),
    check("customer_service_messages_channel_valid", sql`${table.channel} in ('facebook', 'website')`),
    check("customer_service_messages_direction_valid", sql`${table.direction} = 'incoming'`),
    check("customer_service_messages_body_valid", sql`length(trim(${table.body})) > 0`),
    check("customer_service_messages_external_hash_valid", sql`length(trim(${table.externalMessageKeyHash})) > 0`),
    check(
      "customer_service_messages_ingest_status_valid",
      sql`${table.ingestStatus} in ('received', 'processing', 'draft_ready', 'blocked', 'provider_error', 'output_blocked')`,
    ),
    check(
      "customer_service_messages_pilot_pair_valid",
      sql`(${table.pilotRunId} is null and ${table.pilotSequence} is null) or (${table.pilotRunId} is not null and ${table.pilotSequence} is not null and ${table.pilotSequence} > 0)`,
    ),
  ],
);

export const customerServiceAiAttempts = pgTable(
  "customer_service_ai_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    messageId: uuid("message_id").notNull().references(() => customerServiceMessages.id, { onDelete: "restrict" }),
    attemptNumber: integer("attempt_number").notNull(),
    trigger: text("trigger").$type<"webhook_after" | "manual_generate" | "manual_regenerate">().notNull(),
    intent: text("intent").notNull(),
    riskLevel: text("risk_level").$type<"low" | "medium" | "high">().notNull(),
    gateResult: text("gate_result").$type<"allowed" | "high_risk" | "unresolved" | "realtime_required" | "pilot_limit" | "budget_blocked">().notNull(),
    gateReasons: jsonb("gate_reasons").$type<readonly string[]>().default([]).notNull(),
    knowledgeSources: jsonb("knowledge_sources").$type<readonly string[]>().default([]).notNull(),
    knowledgeVersion: text("knowledge_version").notNull(),
    status: text("status").$type<"pending" | "gate_blocked" | "provider_pending" | "draft_ready" | "output_blocked" | "provider_error" | "budget_blocked" | "abandoned">().notNull(),
    providerCalled: boolean("provider_called").default(false).notNull(),
    provider: text("provider").$type<"mock" | "openai">(),
    model: text("model"),
    draftText: text("draft_text"),
    rejectedOutputHash: text("rejected_output_hash"),
    validatorCodes: jsonb("validator_codes").$type<readonly string[]>().default([]).notNull(),
    inputTokens: integer("input_tokens"),
    cachedInputTokens: integer("cached_input_tokens"),
    outputTokens: integer("output_tokens"),
    estimatedCostMicrousd: bigint("estimated_cost_microusd", { mode: "number" }),
    reservedCostMicrousd: bigint("reserved_cost_microusd", { mode: "number" }).default(0).notNull(),
    latencyMs: integer("latency_ms"),
    providerErrorCode: text("provider_error_code"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("customer_service_ai_attempts_message_number_unique").on(table.messageId, table.attemptNumber),
    index("customer_service_ai_attempts_message_started_idx").on(table.messageId, table.startedAt),
    index("customer_service_ai_attempts_status_started_idx").on(table.status, table.startedAt),
    check("customer_service_ai_attempts_number_valid", sql`${table.attemptNumber} > 0`),
    check("customer_service_ai_attempts_risk_valid", sql`${table.riskLevel} in ('low', 'medium', 'high')`),
    check("customer_service_ai_attempts_trigger_valid", sql`${table.trigger} in ('webhook_after', 'manual_generate', 'manual_regenerate')`),
    check("customer_service_ai_attempts_gate_valid", sql`${table.gateResult} in ('allowed', 'high_risk', 'unresolved', 'realtime_required', 'pilot_limit', 'budget_blocked')`),
    check("customer_service_ai_attempts_status_valid", sql`${table.status} in ('pending', 'gate_blocked', 'provider_pending', 'draft_ready', 'output_blocked', 'provider_error', 'budget_blocked', 'abandoned')`),
    check("customer_service_ai_attempts_usage_valid", sql`coalesce(${table.inputTokens}, 0) >= 0 and coalesce(${table.cachedInputTokens}, 0) >= 0 and coalesce(${table.outputTokens}, 0) >= 0 and coalesce(${table.estimatedCostMicrousd}, 0) >= 0 and ${table.reservedCostMicrousd} >= 0 and coalesce(${table.latencyMs}, 0) >= 0`),
    check("customer_service_ai_attempts_gate_block_valid", sql`${table.status} <> 'gate_blocked' or (${table.providerCalled} = false and ${table.provider} is null and ${table.model} is null and ${table.draftText} is null)`),
    check("customer_service_ai_attempts_draft_ready_valid", sql`${table.status} <> 'draft_ready' or (${table.providerCalled} = true and length(trim(${table.draftText})) > 0 and ${table.completedAt} is not null)`),
    check("customer_service_ai_attempts_output_block_valid", sql`${table.status} <> 'output_blocked' or (${table.providerCalled} = true and ${table.draftText} is null and ${table.rejectedOutputHash} is not null and jsonb_array_length(${table.validatorCodes}) > 0)`),
    check("customer_service_ai_attempts_terminal_valid", sql`${table.status} in ('pending', 'provider_pending') or ${table.completedAt} is not null`),
  ],
);

export const customerServiceFeedbackEvents = pgTable(
  "customer_service_feedback_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    attemptId: uuid("attempt_id").notNull().references(() => customerServiceAiAttempts.id, { onDelete: "restrict" }),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").$type<"accepted_unchanged" | "edited" | "rejected" | "copied" | "sent_confirmed">().notNull(),
    humanFinalText: text("human_final_text"),
    reasonCode: text("reason_code"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("customer_service_feedback_events_idempotency_unique")
      .on(table.attemptId, table.actorUserId, table.action, table.idempotencyKey),
    index("customer_service_feedback_events_attempt_created_idx").on(table.attemptId, table.createdAt),
    check("customer_service_feedback_events_action_valid", sql`${table.action} in ('accepted_unchanged', 'edited', 'rejected', 'copied', 'sent_confirmed')`),
    check("customer_service_feedback_events_key_valid", sql`length(trim(${table.idempotencyKey})) > 0`),
    check("customer_service_feedback_events_content_valid", sql`(${table.action} = 'rejected' and ${table.humanFinalText} is null and ${table.reasonCode} is not null) or (${table.action} <> 'rejected' and length(trim(${table.humanFinalText})) > 0)`),
  ],
);

export const customerServiceBudgetState = pgTable(
  "customer_service_budget_state",
  {
    scopeKey: text("scope_key").primaryKey(),
    spentMicrousd: bigint("spent_microusd", { mode: "number" }).default(0).notNull(),
    reservedMicrousd: bigint("reserved_microusd", { mode: "number" }).default(0).notNull(),
    updatedAt: updatedTimestamp(),
  },
  (table) => [
    check("customer_service_budget_state_scope_valid", sql`${table.scopeKey} = 'total' or ${table.scopeKey} ~ '^daily:[0-9]{4}-[0-9]{2}-[0-9]{2}$'`),
    check("customer_service_budget_state_amounts_valid", sql`${table.spentMicrousd} >= 0 and ${table.reservedMicrousd} >= 0`),
  ],
);

export const customerServiceAttachments = pgTable(
  "customer_service_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    messageId: uuid("message_id").notNull().references(() => customerServiceMessages.id, { onDelete: "restrict" }),
    externalAttachmentKeyHash: text("external_attachment_key_hash").notNull(),
    ordinal: integer("ordinal").notNull(),
    kind: text("kind").$type<"image">().default("image").notNull(),
    status: text("status")
      .$type<"metadata_received" | "stored" | "analyzed" | "rejected" | "failed" | "deleted">()
      .default("metadata_received")
      .notNull(),
    mimeTypeHint: text("mime_type_hint"),
    verifiedMimeType: text("verified_mime_type").$type<"image/jpeg" | "image/png" | "image/webp">(),
    width: integer("width"),
    height: integer("height"),
    byteSize: integer("byte_size"),
    privateStorageKey: text("private_storage_key"),
    sha256: text("sha256"),
    failureCode: text("failure_code"),
    deleteDueAt: timestamp("delete_due_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: updatedTimestamp(),
  },
  (table) => [
    uniqueIndex("customer_service_attachments_message_external_unique")
      .on(table.messageId, table.externalAttachmentKeyHash),
    uniqueIndex("customer_service_attachments_message_ordinal_unique").on(table.messageId, table.ordinal),
    unique("customer_service_attachments_id_message_unique").on(table.id, table.messageId),
    index("customer_service_attachments_status_delete_due_idx").on(table.status, table.deleteDueAt),
    check("customer_service_attachments_external_hash_valid", sql`length(trim(${table.externalAttachmentKeyHash})) > 0`),
    check("customer_service_attachments_ordinal_valid", sql`${table.ordinal} >= 0`),
    check("customer_service_attachments_kind_valid", sql`${table.kind} = 'image'`),
    check("customer_service_attachments_status_valid", sql`${table.status} in ('metadata_received', 'stored', 'analyzed', 'rejected', 'failed', 'deleted')`),
    check("customer_service_attachments_mime_valid", sql`${table.verifiedMimeType} is null or ${table.verifiedMimeType} in ('image/jpeg', 'image/png', 'image/webp')`),
    check("customer_service_attachments_dimensions_valid", sql`coalesce(${table.width}, 0) >= 0 and coalesce(${table.height}, 0) >= 0 and coalesce(${table.byteSize}, 0) >= 0`),
  ],
);

export const customerServiceImageAnalysisAttempts = pgTable(
  "customer_service_image_analysis_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    messageId: uuid("message_id").notNull().references(() => customerServiceMessages.id, { onDelete: "restrict" }),
    attemptNumber: integer("attempt_number").notNull(),
    status: text("status")
      .$type<"pending" | "provider_pending" | "analyzed" | "input_rejected" | "provider_error" | "schema_blocked">()
      .notNull(),
    providerCalled: boolean("provider_called").default(false).notNull(),
    provider: text("provider").$type<"mock" | "openai">(),
    model: text("model"),
    schemaVersion: text("schema_version").notNull(),
    analysisResult: jsonb("analysis_result"),
    validatorCodes: jsonb("validator_codes").$type<readonly string[]>().default([]).notNull(),
    inputTokens: integer("input_tokens"),
    cachedInputTokens: integer("cached_input_tokens"),
    outputTokens: integer("output_tokens"),
    estimatedCostMicrousd: bigint("estimated_cost_microusd", { mode: "number" }),
    latencyMs: integer("latency_ms"),
    providerErrorCode: text("provider_error_code"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("customer_service_image_analysis_attempts_message_number_unique").on(table.messageId, table.attemptNumber),
    unique("customer_service_image_analysis_attempts_id_message_unique").on(table.id, table.messageId),
    index("customer_service_image_analysis_attempts_message_started_idx").on(table.messageId, table.startedAt),
    index("customer_service_image_analysis_attempts_status_started_idx").on(table.status, table.startedAt),
    check("customer_service_image_analysis_attempts_number_valid", sql`${table.attemptNumber} > 0`),
    check("customer_service_image_analysis_attempts_status_valid", sql`${table.status} in ('pending', 'provider_pending', 'analyzed', 'input_rejected', 'provider_error', 'schema_blocked')`),
    check("customer_service_image_analysis_attempts_usage_valid", sql`coalesce(${table.inputTokens}, 0) >= 0 and coalesce(${table.cachedInputTokens}, 0) >= 0 and coalesce(${table.outputTokens}, 0) >= 0 and coalesce(${table.estimatedCostMicrousd}, 0) >= 0 and coalesce(${table.latencyMs}, 0) >= 0`),
    check("customer_service_image_analysis_attempts_terminal_valid", sql`${table.status} in ('pending', 'provider_pending') or ${table.completedAt} is not null`),
  ],
);

export const customerServiceImageAnalysisInputs = pgTable(
  "customer_service_image_analysis_inputs",
  {
    analysisAttemptId: uuid("analysis_attempt_id").notNull(),
    attachmentId: uuid("attachment_id").notNull(),
    messageId: uuid("message_id").notNull(),
    ordinal: integer("ordinal").notNull(),
  },
  (table) => [
    uniqueIndex("customer_service_image_analysis_inputs_attempt_attachment_unique")
      .on(table.analysisAttemptId, table.attachmentId),
    uniqueIndex("customer_service_image_analysis_inputs_attempt_ordinal_unique")
      .on(table.analysisAttemptId, table.ordinal),
    index("customer_service_image_analysis_inputs_attachment_idx").on(table.attachmentId),
    foreignKey({
      name: "customer_service_image_analysis_inputs_attempt_message_fk",
      columns: [table.analysisAttemptId, table.messageId],
      foreignColumns: [customerServiceImageAnalysisAttempts.id, customerServiceImageAnalysisAttempts.messageId],
    }).onDelete("restrict"),
    foreignKey({
      name: "customer_service_image_analysis_inputs_attachment_message_fk",
      columns: [table.attachmentId, table.messageId],
      foreignColumns: [customerServiceAttachments.id, customerServiceAttachments.messageId],
    }).onDelete("restrict"),
    check("customer_service_image_analysis_inputs_ordinal_valid", sql`${table.ordinal} >= 0`),
  ],
);
