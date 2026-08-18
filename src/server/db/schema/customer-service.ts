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
    unique("customer_service_messages_id_conversation_unique").on(table.id, table.conversationId),
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

export const customerServiceTurns = pgTable(
  "customer_service_turns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id").notNull().references(() => customerServiceConversations.id, { onDelete: "restrict" }),
    channel: text("channel").$type<"facebook" | "website">().notNull(),
    representativeMessageId: uuid("representative_message_id").references(() => customerServiceMessages.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    status: text("status").$type<"open" | "sealed" | "suppressed" | "pilot_complete">().default("open").notNull(),
    debounceUntil: timestamp("debounce_until", { withTimezone: true }).notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }).notNull(),
    sealedAt: timestamp("sealed_at", { withTimezone: true }),
    suppressionReason: text("suppression_reason"),
    fragmentCount: integer("fragment_count").default(1).notNull(),
    pilotRunId: uuid("pilot_run_id").references(() => customerServicePilotRuns.id, { onDelete: "restrict" }),
    pilotSequence: integer("pilot_sequence"),
    processingStatus: text("processing_status")
      .$type<"pending" | "running" | "completed" | "cancelled">()
      .default("pending")
      .notNull(),
    processingLeaseToken: text("processing_lease_token"),
    processingLeaseExpiresAt: timestamp("processing_lease_expires_at", { withTimezone: true }),
    processingAttempts: integer("processing_attempts").default(0).notNull(),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).defaultNow().notNull(),
    lastProcessingError: text("last_processing_error"),
    processingCompletedAt: timestamp("processing_completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: updatedTimestamp(),
  },
  (table) => [
    uniqueIndex("customer_service_turns_pilot_sequence_unique")
      .on(table.pilotRunId, table.pilotSequence)
      .where(sql`${table.pilotRunId} is not null and ${table.pilotSequence} is not null`),
    index("customer_service_turns_conversation_last_event_idx").on(table.conversationId, table.lastEventAt),
    index("customer_service_turns_status_debounce_idx").on(table.status, table.debounceUntil),
    index("customer_service_turns_processing_due_idx")
      .on(table.processingStatus, table.nextRunAt, table.processingLeaseExpiresAt),
    check("customer_service_turns_channel_valid", sql`${table.channel} in ('facebook', 'website')`),
    check("customer_service_turns_status_valid", sql`${table.status} in ('open', 'sealed', 'suppressed', 'pilot_complete')`),
    check("customer_service_turns_body_valid", sql`length(trim(${table.body})) > 0`),
    check("customer_service_turns_fragment_count_valid", sql`${table.fragmentCount} > 0`),
    check("customer_service_turns_processing_status_valid", sql`${table.processingStatus} in ('pending', 'running', 'completed', 'cancelled')`),
    check("customer_service_turns_processing_attempts_valid", sql`${table.processingAttempts} >= 0`),
    check(
      "customer_service_turns_processing_lease_valid",
      sql`(${table.processingStatus} = 'running' and ${table.processingLeaseToken} is not null and ${table.processingLeaseExpiresAt} is not null) or (${table.processingStatus} <> 'running' and ${table.processingLeaseToken} is null and ${table.processingLeaseExpiresAt} is null)`,
    ),
    check(
      "customer_service_turns_pilot_pair_valid",
      sql`(${table.pilotRunId} is null and ${table.pilotSequence} is null) or (${table.pilotRunId} is not null and ${table.pilotSequence} is not null and ${table.pilotSequence} > 0)`,
    ),
  ],
);

export const customerServiceConversationEvents = pgTable(
  "customer_service_conversation_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id").notNull().references(() => customerServiceConversations.id, { onDelete: "restrict" }),
    turnId: uuid("turn_id").references(() => customerServiceTurns.id, { onDelete: "restrict" }),
    legacyMessageId: uuid("legacy_message_id").references(() => customerServiceMessages.id, { onDelete: "restrict" }),
    channel: text("channel").$type<"facebook" | "website">().notNull(),
    externalMessageKeyHash: text("external_message_key_hash").notNull(),
    role: text("role").$type<"customer" | "staff">().notNull(),
    eventType: text("event_type")
      .$type<"customer_message" | "human_outbound" | "system_event">()
      .default("customer_message")
      .notNull(),
    body: text("body").notNull(),
    bodyHash: text("body_hash"),
    redactionCodes: jsonb("redaction_codes").$type<readonly string[]>().default([]).notNull(),
    replyToExternalMessageKeyHash: text("reply_to_external_message_key_hash"),
    learningEligible: boolean("learning_eligible").default(false).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("customer_service_conversation_events_channel_external_unique")
      .on(table.channel, table.externalMessageKeyHash),
    index("customer_service_conversation_events_conversation_received_idx")
      .on(table.conversationId, table.receivedAt, table.createdAt),
    index("customer_service_conversation_events_turn_idx").on(table.turnId),
    unique("customer_service_conversation_events_id_conversation_unique").on(table.id, table.conversationId),
    check("customer_service_conversation_events_channel_valid", sql`${table.channel} in ('facebook', 'website')`),
    check("customer_service_conversation_events_role_valid", sql`${table.role} in ('customer', 'staff')`),
    check("customer_service_conversation_events_type_valid", sql`${table.eventType} in ('customer_message', 'human_outbound', 'system_event')`),
    check("customer_service_conversation_events_role_type_valid", sql`(${table.role} = 'customer' and ${table.eventType} = 'customer_message') or (${table.role} = 'staff' and ${table.eventType} in ('human_outbound', 'system_event'))`),
    check("customer_service_conversation_events_body_valid", sql`length(trim(${table.body})) > 0`),
    check("customer_service_conversation_events_external_hash_valid", sql`length(trim(${table.externalMessageKeyHash})) > 0`),
    check(
      "customer_service_conversation_events_customer_message_valid",
      sql`(${table.role} = 'customer' and ${table.legacyMessageId} is not null) or (${table.role} = 'staff' and ${table.legacyMessageId} is null)`,
    ),
  ],
);

export const customerServiceHumanReplyMatches = pgTable(
  "customer_service_human_reply_matches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id").notNull().references(() => customerServiceConversations.id, { onDelete: "restrict" }),
    status: text("status").$type<"pending" | "matched" | "unmatched" | "excluded">().default("pending").notNull(),
    firstOutboundAt: timestamp("first_outbound_at", { withTimezone: true }).notNull(),
    lastOutboundAt: timestamp("last_outbound_at", { withTimezone: true }).notNull(),
    turnId: uuid("turn_id").references(() => customerServiceTurns.id, { onDelete: "restrict" }),
    aiAttemptId: uuid("ai_attempt_id").references(() => customerServiceAiAttempts.id, { onDelete: "restrict" }),
    humanFinalText: text("human_final_text").notNull(),
    contextSummary: text("context_summary").notNull(),
    matchMethod: text("match_method").$type<"none" | "reply_to" | "single_eligible_turn">().default("none").notNull(),
    confidence: text("confidence").$type<"low" | "medium" | "high">().default("low").notNull(),
    matchScore: integer("match_score").default(0).notNull(),
    editClassification: text("edit_classification")
      .$type<"pending" | "accepted_unchanged" | "edited_light" | "edited_significant" | "ai_ignored" | "independent_reply" | "unmatched">()
      .default("pending")
      .notNull(),
    similarityScore: integer("similarity_score"),
    editReasonCodes: jsonb("edit_reason_codes").$type<readonly string[]>().default([]).notNull(),
    intent: text("intent"),
    riskClass: text("risk_class").$type<"low" | "medium" | "high">(),
    policyReferences: jsonb("policy_references").$type<readonly string[]>().default([]).notNull(),
    exclusionCodes: jsonb("exclusion_codes").$type<readonly string[]>().default([]).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: updatedTimestamp(),
  },
  (table) => [
    unique("customer_service_human_reply_matches_id_conversation_unique").on(table.id, table.conversationId),
    index("customer_service_human_reply_matches_conversation_outbound_idx").on(table.conversationId, table.firstOutboundAt),
    index("customer_service_human_reply_matches_status_created_idx").on(table.status, table.createdAt),
    check("customer_service_human_reply_matches_status_valid", sql`${table.status} in ('pending', 'matched', 'unmatched', 'excluded')`),
    check("customer_service_human_reply_matches_confidence_valid", sql`${table.confidence} in ('low', 'medium', 'high')`),
    check("customer_service_human_reply_matches_method_valid", sql`${table.matchMethod} in ('none', 'reply_to', 'single_eligible_turn')`),
    check("customer_service_human_reply_matches_score_valid", sql`${table.matchScore} between 0 and 100 and (${table.similarityScore} is null or ${table.similarityScore} between 0 and 10000)`),
    check("customer_service_human_reply_matches_time_valid", sql`${table.lastOutboundAt} >= ${table.firstOutboundAt}`),
    check("customer_service_human_reply_matches_content_valid", sql`length(trim(${table.humanFinalText})) > 0 and length(trim(${table.contextSummary})) > 0`),
    check("customer_service_human_reply_matches_pair_valid", sql`(${table.status} = 'matched' and ${table.turnId} is not null) or (${table.status} = 'unmatched' and ${table.turnId} is null and ${table.aiAttemptId} is null) or (${table.status} in ('pending', 'excluded'))`),
  ],
);

export const customerServiceHumanReplyMatchEvents = pgTable(
  "customer_service_human_reply_match_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    matchId: uuid("match_id").notNull(),
    eventId: uuid("event_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("customer_service_human_reply_match_events_event_unique").on(table.eventId),
    uniqueIndex("customer_service_human_reply_match_events_match_ordinal_unique").on(table.matchId, table.ordinal),
    foreignKey({
      name: "customer_service_human_reply_match_events_match_conversation_fk",
      columns: [table.matchId, table.conversationId],
      foreignColumns: [customerServiceHumanReplyMatches.id, customerServiceHumanReplyMatches.conversationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "customer_service_human_reply_match_events_event_conversation_fk",
      columns: [table.eventId, table.conversationId],
      foreignColumns: [customerServiceConversationEvents.id, customerServiceConversationEvents.conversationId],
    }).onDelete("restrict"),
    check("customer_service_human_reply_match_events_ordinal_valid", sql`${table.ordinal} >= 0`),
  ],
);

export const customerServiceCaseMemories = pgTable(
  "customer_service_case_memories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    humanReplyMatchId: uuid("human_reply_match_id").notNull().references(() => customerServiceHumanReplyMatches.id, { onDelete: "restrict" }),
    intent: text("intent").notNull(),
    normalizedSituation: text("normalized_situation").notNull(),
    customerTurnSummary: text("customer_turn_summary").notNull(),
    contextSummary: text("context_summary").notNull(),
    aiDraft: text("ai_draft"),
    humanFinalReply: text("human_final_reply").notNull(),
    editClassification: text("edit_classification").notNull(),
    editReasonCodes: jsonb("edit_reason_codes").$type<readonly string[]>().default([]).notNull(),
    productCategory: text("product_category"),
    market: text("market").$type<"NZ" | "AU" | "other" | "unknown">().default("unknown").notNull(),
    deadlineContext: text("deadline_context"),
    policyReferences: jsonb("policy_references").$type<readonly string[]>().default([]).notNull(),
    knowledgeVersion: text("knowledge_version").notNull(),
    riskClass: text("risk_class").$type<"low" | "medium">().notNull(),
    eligibilityStatus: text("eligibility_status")
      .$type<"pending_review" | "approved_reusable" | "excluded" | "revoked">()
      .default("pending_review")
      .notNull(),
    sourceConfidence: text("source_confidence").$type<"medium" | "high">().notNull(),
    exclusionCodes: jsonb("exclusion_codes").$type<readonly string[]>().default([]).notNull(),
    approvedByUserId: text("approved_by_user_id").references(() => user.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: updatedTimestamp(),
  },
  (table) => [
    uniqueIndex("customer_service_case_memories_match_unique").on(table.humanReplyMatchId),
    index("customer_service_case_memories_retrieval_idx").on(table.eligibilityStatus, table.intent, table.productCategory, table.market),
    check("customer_service_case_memories_status_valid", sql`${table.eligibilityStatus} in ('pending_review', 'approved_reusable', 'excluded', 'revoked')`),
    check("customer_service_case_memories_market_valid", sql`${table.market} in ('NZ', 'AU', 'other', 'unknown')`),
    check("customer_service_case_memories_risk_valid", sql`${table.riskClass} in ('low', 'medium')`),
    check("customer_service_case_memories_confidence_valid", sql`${table.sourceConfidence} in ('medium', 'high')`),
    check("customer_service_case_memories_content_valid", sql`length(trim(${table.intent})) > 0 and length(trim(${table.normalizedSituation})) > 0 and length(trim(${table.customerTurnSummary})) > 0 and length(trim(${table.contextSummary})) > 0 and length(trim(${table.humanFinalReply})) > 0`),
    check("customer_service_case_memories_decision_valid", sql`(${table.eligibilityStatus} = 'pending_review' and ${table.approvedByUserId} is null and ${table.decidedAt} is null) or (${table.eligibilityStatus} <> 'pending_review' and ${table.decidedAt} is not null)`),
  ],
);

export const customerServiceCaseRetrievals = pgTable(
  "customer_service_case_retrievals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    attemptId: uuid("attempt_id").notNull().references(() => customerServiceAiAttempts.id, { onDelete: "restrict" }),
    caseMemoryId: uuid("case_memory_id").notNull().references(() => customerServiceCaseMemories.id, { onDelete: "restrict" }),
    rank: integer("rank"),
    totalScore: integer("total_score").notNull(),
    scoreComponents: jsonb("score_components").$type<Readonly<Record<string, number>>>().default({}).notNull(),
    thresholdPassed: boolean("threshold_passed").default(false).notNull(),
    injected: boolean("injected").default(false).notNull(),
    exclusionReason: text("exclusion_reason"),
    latencyMs: integer("latency_ms").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("customer_service_case_retrievals_attempt_case_unique").on(table.attemptId, table.caseMemoryId),
    index("customer_service_case_retrievals_attempt_rank_idx").on(table.attemptId, table.rank),
    check("customer_service_case_retrievals_score_valid", sql`${table.totalScore} between 0 and 100 and ${table.latencyMs} >= 0 and (${table.rank} is null or ${table.rank} > 0)`),
    check("customer_service_case_retrievals_injection_valid", sql`${table.injected} = false or (${table.thresholdPassed} = true and ${table.rank} is not null)`),
  ],
);

export const customerServiceLearningCandidates = pgTable(
  "customer_service_learning_candidates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    candidateKind: text("candidate_kind").$type<"golden_example" | "answer_quality_rule" | "knowledge_change">().notNull(),
    intent: text("intent").notNull(),
    proposedChange: text("proposed_change").notNull(),
    evidenceCount: integer("evidence_count").notNull(),
    distinctCaseCount: integer("distinct_case_count").notNull(),
    reasonCodes: jsonb("reason_codes").$type<readonly string[]>().default([]).notNull(),
    sourceCaseMemoryIds: jsonb("source_case_memory_ids").$type<readonly string[]>().default([]).notNull(),
    evidenceSignature: text("evidence_signature").notNull(),
    status: text("status").$type<"pending" | "approved" | "rejected" | "superseded">().default("pending").notNull(),
    approvedText: text("approved_text"),
    reviewerUserId: text("reviewer_user_id").references(() => user.id, { onDelete: "set null" }),
    decisionReason: text("decision_reason"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: updatedTimestamp(),
  },
  (table) => [
    uniqueIndex("customer_service_learning_candidates_evidence_unique").on(table.evidenceSignature),
    index("customer_service_learning_candidates_status_created_idx").on(table.status, table.createdAt),
    check("customer_service_learning_candidates_kind_valid", sql`${table.candidateKind} in ('golden_example', 'answer_quality_rule', 'knowledge_change')`),
    check("customer_service_learning_candidates_status_valid", sql`${table.status} in ('pending', 'approved', 'rejected', 'superseded')`),
    check("customer_service_learning_candidates_evidence_valid", sql`${table.evidenceCount} >= 3 and ${table.distinctCaseCount} >= 3 and ${table.distinctCaseCount} <= ${table.evidenceCount}`),
    check("customer_service_learning_candidates_content_valid", sql`length(trim(${table.intent})) > 0 and length(trim(${table.proposedChange})) > 0 and length(trim(${table.evidenceSignature})) > 0`),
    check("customer_service_learning_candidates_decision_valid", sql`(${table.status} = 'pending' and ${table.reviewerUserId} is null and ${table.decidedAt} is null) or (${table.status} <> 'pending' and ${table.reviewerUserId} is not null and ${table.decidedAt} is not null)`),
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
    messageId: uuid("message_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    externalAttachmentKeyHash: text("external_attachment_key_hash").notNull(),
    ordinal: integer("ordinal").notNull(),
    kind: text("kind").$type<"image">().default("image").notNull(),
    normalizedKind: text("normalized_kind").$type<"image" | "unsupported">().default("image").notNull(),
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
    unique("customer_service_attachments_id_conversation_unique").on(table.id, table.conversationId),
    index("customer_service_attachments_status_delete_due_idx").on(table.status, table.deleteDueAt),
    foreignKey({
      name: "customer_service_attachments_message_conversation_fk",
      columns: [table.messageId, table.conversationId],
      foreignColumns: [customerServiceMessages.id, customerServiceMessages.conversationId],
    }).onDelete("restrict"),
    check("customer_service_attachments_external_hash_valid", sql`length(trim(${table.externalAttachmentKeyHash})) > 0`),
    check("customer_service_attachments_ordinal_valid", sql`${table.ordinal} >= 0`),
    check("customer_service_attachments_kind_valid", sql`${table.kind} = 'image'`),
    check("customer_service_attachments_normalized_kind_valid", sql`${table.normalizedKind} in ('image', 'unsupported')`),
    check("customer_service_attachments_status_valid", sql`${table.status} in ('metadata_received', 'stored', 'analyzed', 'rejected', 'failed', 'deleted')`),
    check("customer_service_attachments_mime_valid", sql`${table.verifiedMimeType} is null or ${table.verifiedMimeType} in ('image/jpeg', 'image/png', 'image/webp')`),
    check("customer_service_attachments_dimensions_valid", sql`coalesce(${table.width}, 0) >= 0 and coalesce(${table.height}, 0) >= 0 and coalesce(${table.byteSize}, 0) >= 0`),
  ],
);

export const customerServiceImageAnalysisAttempts = pgTable(
  "customer_service_image_analysis_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    messageId: uuid("message_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
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
    reservedCostMicrousd: bigint("reserved_cost_microusd", { mode: "number" }).default(0).notNull(),
    budgetDailyScopeKey: text("budget_daily_scope_key"),
    latencyMs: integer("latency_ms"),
    providerErrorCode: text("provider_error_code"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("customer_service_image_analysis_attempts_message_number_unique").on(table.messageId, table.attemptNumber),
    unique("customer_service_image_analysis_attempts_id_conversation_unique").on(table.id, table.conversationId),
    index("customer_service_image_analysis_attempts_message_started_idx").on(table.messageId, table.startedAt),
    index("customer_service_image_analysis_attempts_status_started_idx").on(table.status, table.startedAt),
    foreignKey({
      name: "customer_service_image_analysis_attempts_message_conversation_fk",
      columns: [table.messageId, table.conversationId],
      foreignColumns: [customerServiceMessages.id, customerServiceMessages.conversationId],
    }).onDelete("restrict"),
    check("customer_service_image_analysis_attempts_number_valid", sql`${table.attemptNumber} > 0`),
    check("customer_service_image_analysis_attempts_status_valid", sql`${table.status} in ('pending', 'provider_pending', 'analyzed', 'input_rejected', 'provider_error', 'schema_blocked')`),
    check("customer_service_image_analysis_attempts_usage_valid", sql`coalesce(${table.inputTokens}, 0) >= 0 and coalesce(${table.cachedInputTokens}, 0) >= 0 and coalesce(${table.outputTokens}, 0) >= 0 and coalesce(${table.estimatedCostMicrousd}, 0) >= 0 and coalesce(${table.latencyMs}, 0) >= 0`),
    check("customer_service_image_analysis_attempts_reservation_valid", sql`${table.reservedCostMicrousd} >= 0 and (${table.reservedCostMicrousd} = 0 or length(trim(${table.budgetDailyScopeKey})) > 0)`),
    check("customer_service_image_analysis_attempts_terminal_valid", sql`${table.status} in ('pending', 'provider_pending') or ${table.completedAt} is not null`),
  ],
);

export const customerServiceImageAnalysisInputs = pgTable(
  "customer_service_image_analysis_inputs",
  {
    analysisAttemptId: uuid("analysis_attempt_id").notNull(),
    attachmentId: uuid("attachment_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    externalAttachmentKeyHash: text("external_attachment_key_hash").notNull(),
    cleanupStatus: text("cleanup_status")
      .$type<"pending" | "stored" | "deleted" | "failed">()
      .default("pending")
      .notNull(),
    verifiedMimeType: text("verified_mime_type").$type<"image/jpeg" | "image/png" | "image/webp">(),
    width: integer("width"),
    height: integer("height"),
    byteSize: integer("byte_size"),
    sha256: text("sha256"),
    privateStorageKey: text("private_storage_key"),
    privateStorageKeyHash: text("private_storage_key_hash"),
    failureCode: text("failure_code"),
    deleteDueAt: timestamp("delete_due_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    cleanupClaimToken: uuid("cleanup_claim_token"),
    cleanupClaimedAt: timestamp("cleanup_claimed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("customer_service_image_analysis_inputs_attempt_attachment_unique")
      .on(table.analysisAttemptId, table.attachmentId),
    uniqueIndex("customer_service_image_analysis_inputs_attempt_ordinal_unique")
      .on(table.analysisAttemptId, table.ordinal),
    index("customer_service_image_analysis_inputs_attachment_idx").on(table.attachmentId),
    index("customer_service_image_analysis_inputs_cleanup_due_idx").on(table.cleanupStatus, table.deleteDueAt),
    foreignKey({
      name: "customer_service_image_analysis_inputs_attempt_conversation_fk",
      columns: [table.analysisAttemptId, table.conversationId],
      foreignColumns: [customerServiceImageAnalysisAttempts.id, customerServiceImageAnalysisAttempts.conversationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "customer_service_image_analysis_inputs_attachment_conversation_fk",
      columns: [table.attachmentId, table.conversationId],
      foreignColumns: [customerServiceAttachments.id, customerServiceAttachments.conversationId],
    }).onDelete("restrict"),
    check("customer_service_image_analysis_inputs_ordinal_valid", sql`${table.ordinal} >= 0`),
    check("customer_service_image_analysis_inputs_external_hash_valid", sql`length(trim(${table.externalAttachmentKeyHash})) > 0`),
    check("customer_service_image_analysis_inputs_cleanup_status_valid", sql`${table.cleanupStatus} in ('pending', 'stored', 'deleted', 'failed')`),
    check("customer_service_image_analysis_inputs_mime_valid", sql`${table.verifiedMimeType} is null or ${table.verifiedMimeType} in ('image/jpeg', 'image/png', 'image/webp')`),
    check("customer_service_image_analysis_inputs_dimensions_valid", sql`coalesce(${table.width}, 0) >= 0 and coalesce(${table.height}, 0) >= 0 and coalesce(${table.byteSize}, 0) >= 0`),
  ],
);

export const customerServiceImageJobs = pgTable(
  "customer_service_image_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    messageId: uuid("message_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    imageAnalysisAttemptId: uuid("image_analysis_attempt_id"),
    textAttemptId: uuid("text_attempt_id").references(() => customerServiceAiAttempts.id, { onDelete: "restrict" }),
    stage: text("stage").$type<"policy" | "download" | "vision" | "cleanup" | "draft">().default("policy").notNull(),
    status: text("status").$type<"pending" | "running" | "completed" | "human_review_required">().default("pending").notNull(),
    sourceCiphertext: text("source_ciphertext"),
    sourceExpiresAt: timestamp("source_expires_at", { withTimezone: true }),
    terminalAfterCleanup: boolean("terminal_after_cleanup").default(false).notNull(),
    failureCode: text("failure_code"),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).defaultNow().notNull(),
    reservedCostMicrousd: bigint("reserved_cost_microusd", { mode: "number" }).default(0).notNull(),
    budgetDailyScopeKey: text("budget_daily_scope_key"),
    budgetSettledAt: timestamp("budget_settled_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: updatedTimestamp(),
  },
  (table) => [
    uniqueIndex("customer_service_image_jobs_message_unique").on(table.messageId),
    index("customer_service_image_jobs_claim_idx").on(table.status, table.nextRunAt, table.leaseExpiresAt),
    foreignKey({
      name: "customer_service_image_jobs_message_conversation_fk",
      columns: [table.messageId, table.conversationId],
      foreignColumns: [customerServiceMessages.id, customerServiceMessages.conversationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "customer_service_image_jobs_attempt_conversation_fk",
      columns: [table.imageAnalysisAttemptId, table.conversationId],
      foreignColumns: [customerServiceImageAnalysisAttempts.id, customerServiceImageAnalysisAttempts.conversationId],
    }).onDelete("restrict"),
    check("customer_service_image_jobs_stage_valid", sql`${table.stage} in ('policy', 'download', 'vision', 'cleanup', 'draft')`),
    check("customer_service_image_jobs_status_valid", sql`${table.status} in ('pending', 'running', 'completed', 'human_review_required')`),
    check("customer_service_image_jobs_reservation_valid", sql`${table.reservedCostMicrousd} >= 0 and (${table.reservedCostMicrousd} = 0 or length(trim(${table.budgetDailyScopeKey})) > 0)`),
    check("customer_service_image_jobs_source_pair_valid", sql`(${table.sourceCiphertext} is null and ${table.sourceExpiresAt} is null) or (${table.sourceCiphertext} is not null and ${table.sourceExpiresAt} is not null)`),
    check("customer_service_image_jobs_lease_pair_valid", sql`(${table.leaseToken} is null and ${table.leaseExpiresAt} is null) or (${table.leaseToken} is not null and ${table.leaseExpiresAt} is not null)`),
    check("customer_service_image_jobs_terminal_valid", sql`${table.status} in ('pending', 'running') or ${table.completedAt} is not null`),
  ],
);
