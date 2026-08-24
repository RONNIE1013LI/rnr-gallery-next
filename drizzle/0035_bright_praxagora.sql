CREATE TABLE "customer_service_case_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"human_reply_match_id" uuid NOT NULL,
	"intent" text NOT NULL,
	"normalized_situation" text NOT NULL,
	"customer_turn_summary" text NOT NULL,
	"context_summary" text NOT NULL,
	"ai_draft" text,
	"human_final_reply" text NOT NULL,
	"edit_classification" text NOT NULL,
	"edit_reason_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"product_category" text,
	"market" text DEFAULT 'unknown' NOT NULL,
	"deadline_context" text,
	"policy_references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"knowledge_version" text NOT NULL,
	"risk_class" text NOT NULL,
	"eligibility_status" text DEFAULT 'pending_review' NOT NULL,
	"source_confidence" text NOT NULL,
	"exclusion_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approved_by_user_id" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_service_case_memories_status_valid" CHECK ("customer_service_case_memories"."eligibility_status" in ('pending_review', 'approved_reusable', 'excluded', 'revoked')),
	CONSTRAINT "customer_service_case_memories_market_valid" CHECK ("customer_service_case_memories"."market" in ('NZ', 'AU', 'other', 'unknown')),
	CONSTRAINT "customer_service_case_memories_risk_valid" CHECK ("customer_service_case_memories"."risk_class" in ('low', 'medium')),
	CONSTRAINT "customer_service_case_memories_confidence_valid" CHECK ("customer_service_case_memories"."source_confidence" in ('medium', 'high')),
	CONSTRAINT "customer_service_case_memories_content_valid" CHECK (length(trim("customer_service_case_memories"."intent")) > 0 and length(trim("customer_service_case_memories"."normalized_situation")) > 0 and length(trim("customer_service_case_memories"."customer_turn_summary")) > 0 and length(trim("customer_service_case_memories"."context_summary")) > 0 and length(trim("customer_service_case_memories"."human_final_reply")) > 0),
	CONSTRAINT "customer_service_case_memories_decision_valid" CHECK (("customer_service_case_memories"."eligibility_status" = 'pending_review' and "customer_service_case_memories"."approved_by_user_id" is null and "customer_service_case_memories"."decided_at" is null) or ("customer_service_case_memories"."eligibility_status" <> 'pending_review' and "customer_service_case_memories"."decided_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "customer_service_case_retrievals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"case_memory_id" uuid NOT NULL,
	"rank" integer,
	"total_score" integer NOT NULL,
	"score_components" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"threshold_passed" boolean DEFAULT false NOT NULL,
	"injected" boolean DEFAULT false NOT NULL,
	"exclusion_reason" text,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_service_case_retrievals_score_valid" CHECK ("customer_service_case_retrievals"."total_score" between 0 and 100 and "customer_service_case_retrievals"."latency_ms" >= 0 and ("customer_service_case_retrievals"."rank" is null or "customer_service_case_retrievals"."rank" > 0)),
	CONSTRAINT "customer_service_case_retrievals_injection_valid" CHECK ("customer_service_case_retrievals"."injected" = false or ("customer_service_case_retrievals"."threshold_passed" = true and "customer_service_case_retrievals"."rank" is not null))
);
--> statement-breakpoint
CREATE TABLE "customer_service_conversation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"turn_id" uuid,
	"legacy_message_id" uuid,
	"channel" text NOT NULL,
	"external_message_key_hash" text NOT NULL,
	"role" text NOT NULL,
	"event_type" text DEFAULT 'customer_message' NOT NULL,
	"body" text NOT NULL,
	"body_hash" text,
	"redaction_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reply_to_external_message_key_hash" text,
	"learning_eligible" boolean DEFAULT false NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_service_conversation_events_id_conversation_unique" UNIQUE("id","conversation_id"),
	CONSTRAINT "customer_service_conversation_events_channel_valid" CHECK ("customer_service_conversation_events"."channel" in ('facebook', 'website')),
	CONSTRAINT "customer_service_conversation_events_role_valid" CHECK ("customer_service_conversation_events"."role" in ('customer', 'staff')),
	CONSTRAINT "customer_service_conversation_events_type_valid" CHECK ("customer_service_conversation_events"."event_type" in ('customer_message', 'human_outbound', 'system_event')),
	CONSTRAINT "customer_service_conversation_events_role_type_valid" CHECK (("customer_service_conversation_events"."role" = 'customer' and "customer_service_conversation_events"."event_type" = 'customer_message') or ("customer_service_conversation_events"."role" = 'staff' and "customer_service_conversation_events"."event_type" in ('human_outbound', 'system_event'))),
	CONSTRAINT "customer_service_conversation_events_body_valid" CHECK (length(trim("customer_service_conversation_events"."body")) > 0),
	CONSTRAINT "customer_service_conversation_events_external_hash_valid" CHECK (length(trim("customer_service_conversation_events"."external_message_key_hash")) > 0),
	CONSTRAINT "customer_service_conversation_events_customer_message_valid" CHECK (("customer_service_conversation_events"."role" = 'customer' and "customer_service_conversation_events"."legacy_message_id" is not null) or ("customer_service_conversation_events"."role" = 'staff' and "customer_service_conversation_events"."legacy_message_id" is null))
);
--> statement-breakpoint
CREATE TABLE "customer_service_human_reply_match_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_service_human_reply_match_events_ordinal_valid" CHECK ("customer_service_human_reply_match_events"."ordinal" >= 0)
);
--> statement-breakpoint
CREATE TABLE "customer_service_human_reply_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"first_outbound_at" timestamp with time zone NOT NULL,
	"last_outbound_at" timestamp with time zone NOT NULL,
	"turn_id" uuid,
	"ai_attempt_id" uuid,
	"human_final_text" text NOT NULL,
	"context_summary" text NOT NULL,
	"match_method" text DEFAULT 'none' NOT NULL,
	"confidence" text DEFAULT 'low' NOT NULL,
	"match_score" integer DEFAULT 0 NOT NULL,
	"edit_classification" text DEFAULT 'pending' NOT NULL,
	"similarity_score" integer,
	"edit_reason_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"intent" text,
	"risk_class" text,
	"policy_references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"exclusion_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_service_human_reply_matches_id_conversation_unique" UNIQUE("id","conversation_id"),
	CONSTRAINT "customer_service_human_reply_matches_status_valid" CHECK ("customer_service_human_reply_matches"."status" in ('pending', 'matched', 'unmatched', 'excluded')),
	CONSTRAINT "customer_service_human_reply_matches_confidence_valid" CHECK ("customer_service_human_reply_matches"."confidence" in ('low', 'medium', 'high')),
	CONSTRAINT "customer_service_human_reply_matches_method_valid" CHECK ("customer_service_human_reply_matches"."match_method" in ('none', 'reply_to', 'single_eligible_turn')),
	CONSTRAINT "customer_service_human_reply_matches_score_valid" CHECK ("customer_service_human_reply_matches"."match_score" between 0 and 100 and ("customer_service_human_reply_matches"."similarity_score" is null or "customer_service_human_reply_matches"."similarity_score" between 0 and 10000)),
	CONSTRAINT "customer_service_human_reply_matches_time_valid" CHECK ("customer_service_human_reply_matches"."last_outbound_at" >= "customer_service_human_reply_matches"."first_outbound_at"),
	CONSTRAINT "customer_service_human_reply_matches_content_valid" CHECK (length(trim("customer_service_human_reply_matches"."human_final_text")) > 0 and length(trim("customer_service_human_reply_matches"."context_summary")) > 0),
	CONSTRAINT "customer_service_human_reply_matches_pair_valid" CHECK (("customer_service_human_reply_matches"."status" = 'matched' and "customer_service_human_reply_matches"."turn_id" is not null) or ("customer_service_human_reply_matches"."status" = 'unmatched' and "customer_service_human_reply_matches"."turn_id" is null and "customer_service_human_reply_matches"."ai_attempt_id" is null) or ("customer_service_human_reply_matches"."status" in ('pending', 'excluded')))
);
--> statement-breakpoint
CREATE TABLE "customer_service_learning_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_kind" text NOT NULL,
	"intent" text NOT NULL,
	"proposed_change" text NOT NULL,
	"evidence_count" integer NOT NULL,
	"distinct_case_count" integer NOT NULL,
	"reason_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_case_memory_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_signature" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_text" text,
	"reviewer_user_id" text,
	"decision_reason" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_service_learning_candidates_kind_valid" CHECK ("customer_service_learning_candidates"."candidate_kind" in ('golden_example', 'answer_quality_rule', 'knowledge_change')),
	CONSTRAINT "customer_service_learning_candidates_status_valid" CHECK ("customer_service_learning_candidates"."status" in ('pending', 'approved', 'rejected', 'superseded')),
	CONSTRAINT "customer_service_learning_candidates_evidence_valid" CHECK ("customer_service_learning_candidates"."evidence_count" >= 3 and "customer_service_learning_candidates"."distinct_case_count" >= 3 and "customer_service_learning_candidates"."distinct_case_count" <= "customer_service_learning_candidates"."evidence_count"),
	CONSTRAINT "customer_service_learning_candidates_content_valid" CHECK (length(trim("customer_service_learning_candidates"."intent")) > 0 and length(trim("customer_service_learning_candidates"."proposed_change")) > 0 and length(trim("customer_service_learning_candidates"."evidence_signature")) > 0),
	CONSTRAINT "customer_service_learning_candidates_decision_valid" CHECK (("customer_service_learning_candidates"."status" = 'pending' and "customer_service_learning_candidates"."reviewer_user_id" is null and "customer_service_learning_candidates"."decided_at" is null) or ("customer_service_learning_candidates"."status" <> 'pending' and "customer_service_learning_candidates"."reviewer_user_id" is not null and "customer_service_learning_candidates"."decided_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "customer_service_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"representative_message_id" uuid,
	"body" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"debounce_until" timestamp with time zone NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"last_event_at" timestamp with time zone NOT NULL,
	"sealed_at" timestamp with time zone,
	"suppression_reason" text,
	"fragment_count" integer DEFAULT 1 NOT NULL,
	"pilot_run_id" uuid,
	"pilot_sequence" integer,
	"processing_status" text DEFAULT 'pending' NOT NULL,
	"processing_lease_token" text,
	"processing_lease_expires_at" timestamp with time zone,
	"processing_attempts" integer DEFAULT 0 NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_processing_error" text,
	"processing_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_service_turns_channel_valid" CHECK ("customer_service_turns"."channel" in ('facebook', 'website')),
	CONSTRAINT "customer_service_turns_status_valid" CHECK ("customer_service_turns"."status" in ('open', 'sealed', 'suppressed', 'pilot_complete')),
	CONSTRAINT "customer_service_turns_body_valid" CHECK (length(trim("customer_service_turns"."body")) > 0),
	CONSTRAINT "customer_service_turns_fragment_count_valid" CHECK ("customer_service_turns"."fragment_count" > 0),
	CONSTRAINT "customer_service_turns_processing_status_valid" CHECK ("customer_service_turns"."processing_status" in ('pending', 'running', 'completed', 'cancelled')),
	CONSTRAINT "customer_service_turns_processing_attempts_valid" CHECK ("customer_service_turns"."processing_attempts" >= 0),
	CONSTRAINT "customer_service_turns_processing_lease_valid" CHECK (("customer_service_turns"."processing_status" = 'running' and "customer_service_turns"."processing_lease_token" is not null and "customer_service_turns"."processing_lease_expires_at" is not null) or ("customer_service_turns"."processing_status" <> 'running' and "customer_service_turns"."processing_lease_token" is null and "customer_service_turns"."processing_lease_expires_at" is null)),
	CONSTRAINT "customer_service_turns_pilot_pair_valid" CHECK (("customer_service_turns"."pilot_run_id" is null and "customer_service_turns"."pilot_sequence" is null) or ("customer_service_turns"."pilot_run_id" is not null and "customer_service_turns"."pilot_sequence" is not null and "customer_service_turns"."pilot_sequence" > 0))
);
--> statement-breakpoint
ALTER TABLE "customer_service_case_memories" ADD CONSTRAINT "customer_service_case_memories_human_reply_match_id_customer_service_human_reply_matches_id_fk" FOREIGN KEY ("human_reply_match_id") REFERENCES "public"."customer_service_human_reply_matches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_case_memories" ADD CONSTRAINT "customer_service_case_memories_approved_by_user_id_user_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_case_retrievals" ADD CONSTRAINT "customer_service_case_retrievals_attempt_id_customer_service_ai_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."customer_service_ai_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_case_retrievals" ADD CONSTRAINT "customer_service_case_retrievals_case_memory_id_customer_service_case_memories_id_fk" FOREIGN KEY ("case_memory_id") REFERENCES "public"."customer_service_case_memories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_conversation_events" ADD CONSTRAINT "customer_service_conversation_events_conversation_id_customer_service_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."customer_service_conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_conversation_events" ADD CONSTRAINT "customer_service_conversation_events_turn_id_customer_service_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."customer_service_turns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_conversation_events" ADD CONSTRAINT "customer_service_conversation_events_legacy_message_id_customer_service_messages_id_fk" FOREIGN KEY ("legacy_message_id") REFERENCES "public"."customer_service_messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_human_reply_match_events" ADD CONSTRAINT "customer_service_human_reply_match_events_match_conversation_fk" FOREIGN KEY ("match_id","conversation_id") REFERENCES "public"."customer_service_human_reply_matches"("id","conversation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_human_reply_match_events" ADD CONSTRAINT "customer_service_human_reply_match_events_event_conversation_fk" FOREIGN KEY ("event_id","conversation_id") REFERENCES "public"."customer_service_conversation_events"("id","conversation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_human_reply_matches" ADD CONSTRAINT "customer_service_human_reply_matches_conversation_id_customer_service_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."customer_service_conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_human_reply_matches" ADD CONSTRAINT "customer_service_human_reply_matches_turn_id_customer_service_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."customer_service_turns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_human_reply_matches" ADD CONSTRAINT "customer_service_human_reply_matches_ai_attempt_id_customer_service_ai_attempts_id_fk" FOREIGN KEY ("ai_attempt_id") REFERENCES "public"."customer_service_ai_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_learning_candidates" ADD CONSTRAINT "customer_service_learning_candidates_reviewer_user_id_user_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_turns" ADD CONSTRAINT "customer_service_turns_conversation_id_customer_service_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."customer_service_conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_turns" ADD CONSTRAINT "customer_service_turns_representative_message_id_customer_service_messages_id_fk" FOREIGN KEY ("representative_message_id") REFERENCES "public"."customer_service_messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_turns" ADD CONSTRAINT "customer_service_turns_pilot_run_id_customer_service_pilot_runs_id_fk" FOREIGN KEY ("pilot_run_id") REFERENCES "public"."customer_service_pilot_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_case_memories_match_unique" ON "customer_service_case_memories" USING btree ("human_reply_match_id");--> statement-breakpoint
CREATE INDEX "customer_service_case_memories_retrieval_idx" ON "customer_service_case_memories" USING btree ("eligibility_status","intent","product_category","market");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_case_retrievals_attempt_case_unique" ON "customer_service_case_retrievals" USING btree ("attempt_id","case_memory_id");--> statement-breakpoint
CREATE INDEX "customer_service_case_retrievals_attempt_rank_idx" ON "customer_service_case_retrievals" USING btree ("attempt_id","rank");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_conversation_events_channel_external_unique" ON "customer_service_conversation_events" USING btree ("channel","external_message_key_hash");--> statement-breakpoint
CREATE INDEX "customer_service_conversation_events_conversation_received_idx" ON "customer_service_conversation_events" USING btree ("conversation_id","received_at","created_at");--> statement-breakpoint
CREATE INDEX "customer_service_conversation_events_turn_idx" ON "customer_service_conversation_events" USING btree ("turn_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_human_reply_match_events_event_unique" ON "customer_service_human_reply_match_events" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_human_reply_match_events_match_ordinal_unique" ON "customer_service_human_reply_match_events" USING btree ("match_id","ordinal");--> statement-breakpoint
CREATE INDEX "customer_service_human_reply_matches_conversation_outbound_idx" ON "customer_service_human_reply_matches" USING btree ("conversation_id","first_outbound_at");--> statement-breakpoint
CREATE INDEX "customer_service_human_reply_matches_status_created_idx" ON "customer_service_human_reply_matches" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_learning_candidates_evidence_unique" ON "customer_service_learning_candidates" USING btree ("evidence_signature");--> statement-breakpoint
CREATE INDEX "customer_service_learning_candidates_status_created_idx" ON "customer_service_learning_candidates" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_turns_pilot_sequence_unique" ON "customer_service_turns" USING btree ("pilot_run_id","pilot_sequence") WHERE "customer_service_turns"."pilot_run_id" is not null and "customer_service_turns"."pilot_sequence" is not null;--> statement-breakpoint
CREATE INDEX "customer_service_turns_conversation_last_event_idx" ON "customer_service_turns" USING btree ("conversation_id","last_event_at");--> statement-breakpoint
CREATE INDEX "customer_service_turns_status_debounce_idx" ON "customer_service_turns" USING btree ("status","debounce_until");--> statement-breakpoint
CREATE INDEX "customer_service_turns_processing_due_idx" ON "customer_service_turns" USING btree ("processing_status","next_run_at","processing_lease_expires_at");