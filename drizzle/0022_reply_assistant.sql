CREATE TABLE "customer_service_ai_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"trigger" text NOT NULL,
	"intent" text NOT NULL,
	"risk_level" text NOT NULL,
	"gate_result" text NOT NULL,
	"gate_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"knowledge_sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"knowledge_version" text NOT NULL,
	"status" text NOT NULL,
	"provider_called" boolean DEFAULT false NOT NULL,
	"provider" text,
	"model" text,
	"draft_text" text,
	"rejected_output_hash" text,
	"validator_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_tokens" integer,
	"cached_input_tokens" integer,
	"output_tokens" integer,
	"estimated_cost_microusd" bigint,
	"reserved_cost_microusd" bigint DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"provider_error_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "customer_service_ai_attempts_number_valid" CHECK ("customer_service_ai_attempts"."attempt_number" > 0),
	CONSTRAINT "customer_service_ai_attempts_risk_valid" CHECK ("customer_service_ai_attempts"."risk_level" in ('low', 'medium', 'high')),
	CONSTRAINT "customer_service_ai_attempts_trigger_valid" CHECK ("customer_service_ai_attempts"."trigger" in ('webhook_after', 'manual_generate', 'manual_regenerate')),
	CONSTRAINT "customer_service_ai_attempts_gate_valid" CHECK ("customer_service_ai_attempts"."gate_result" in ('allowed', 'high_risk', 'unresolved', 'realtime_required', 'pilot_limit', 'budget_blocked')),
	CONSTRAINT "customer_service_ai_attempts_status_valid" CHECK ("customer_service_ai_attempts"."status" in ('pending', 'gate_blocked', 'provider_pending', 'draft_ready', 'output_blocked', 'provider_error', 'budget_blocked', 'abandoned')),
	CONSTRAINT "customer_service_ai_attempts_usage_valid" CHECK (coalesce("customer_service_ai_attempts"."input_tokens", 0) >= 0 and coalesce("customer_service_ai_attempts"."cached_input_tokens", 0) >= 0 and coalesce("customer_service_ai_attempts"."output_tokens", 0) >= 0 and coalesce("customer_service_ai_attempts"."estimated_cost_microusd", 0) >= 0 and "customer_service_ai_attempts"."reserved_cost_microusd" >= 0 and coalesce("customer_service_ai_attempts"."latency_ms", 0) >= 0),
	CONSTRAINT "customer_service_ai_attempts_gate_block_valid" CHECK ("customer_service_ai_attempts"."status" <> 'gate_blocked' or ("customer_service_ai_attempts"."provider_called" = false and "customer_service_ai_attempts"."provider" is null and "customer_service_ai_attempts"."model" is null and "customer_service_ai_attempts"."draft_text" is null)),
	CONSTRAINT "customer_service_ai_attempts_draft_ready_valid" CHECK ("customer_service_ai_attempts"."status" <> 'draft_ready' or ("customer_service_ai_attempts"."provider_called" = true and length(trim("customer_service_ai_attempts"."draft_text")) > 0 and "customer_service_ai_attempts"."completed_at" is not null)),
	CONSTRAINT "customer_service_ai_attempts_output_block_valid" CHECK ("customer_service_ai_attempts"."status" <> 'output_blocked' or ("customer_service_ai_attempts"."provider_called" = true and "customer_service_ai_attempts"."draft_text" is null and "customer_service_ai_attempts"."rejected_output_hash" is not null and jsonb_array_length("customer_service_ai_attempts"."validator_codes") > 0)),
	CONSTRAINT "customer_service_ai_attempts_terminal_valid" CHECK ("customer_service_ai_attempts"."status" in ('pending', 'provider_pending') or "customer_service_ai_attempts"."completed_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "customer_service_budget_state" (
	"scope_key" text PRIMARY KEY NOT NULL,
	"spent_microusd" bigint DEFAULT 0 NOT NULL,
	"reserved_microusd" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_service_budget_state_scope_valid" CHECK ("customer_service_budget_state"."scope_key" = 'total' or "customer_service_budget_state"."scope_key" ~ '^daily:[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "customer_service_budget_state_amounts_valid" CHECK ("customer_service_budget_state"."spent_microusd" >= 0 and "customer_service_budget_state"."reserved_microusd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "customer_service_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"external_key_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_service_conversations_channel_valid" CHECK ("customer_service_conversations"."channel" in ('facebook', 'website')),
	CONSTRAINT "customer_service_conversations_external_hash_valid" CHECK (length(trim("customer_service_conversations"."external_key_hash")) > 0)
);
--> statement-breakpoint
CREATE TABLE "customer_service_feedback_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"human_final_text" text,
	"reason_code" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_service_feedback_events_action_valid" CHECK ("customer_service_feedback_events"."action" in ('accepted_unchanged', 'edited', 'rejected', 'copied', 'sent_confirmed')),
	CONSTRAINT "customer_service_feedback_events_key_valid" CHECK (length(trim("customer_service_feedback_events"."idempotency_key")) > 0),
	CONSTRAINT "customer_service_feedback_events_content_valid" CHECK (("customer_service_feedback_events"."action" = 'rejected' and "customer_service_feedback_events"."human_final_text" is null and "customer_service_feedback_events"."reason_code" is not null) or ("customer_service_feedback_events"."action" <> 'rejected' and length(trim("customer_service_feedback_events"."human_final_text")) > 0))
);
--> statement-breakpoint
CREATE TABLE "customer_service_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"external_message_key_hash" text NOT NULL,
	"direction" text DEFAULT 'incoming' NOT NULL,
	"body" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"ingest_status" text DEFAULT 'received' NOT NULL,
	"pilot_run_id" uuid,
	"pilot_sequence" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_service_messages_channel_valid" CHECK ("customer_service_messages"."channel" in ('facebook', 'website')),
	CONSTRAINT "customer_service_messages_direction_valid" CHECK ("customer_service_messages"."direction" = 'incoming'),
	CONSTRAINT "customer_service_messages_body_valid" CHECK (length(trim("customer_service_messages"."body")) > 0),
	CONSTRAINT "customer_service_messages_external_hash_valid" CHECK (length(trim("customer_service_messages"."external_message_key_hash")) > 0),
	CONSTRAINT "customer_service_messages_ingest_status_valid" CHECK ("customer_service_messages"."ingest_status" in ('received', 'processing', 'draft_ready', 'blocked', 'provider_error', 'output_blocked')),
	CONSTRAINT "customer_service_messages_pilot_pair_valid" CHECK (("customer_service_messages"."pilot_run_id" is null and "customer_service_messages"."pilot_sequence" is null) or ("customer_service_messages"."pilot_run_id" is not null and "customer_service_messages"."pilot_sequence" is not null and "customer_service_messages"."pilot_sequence" > 0))
);
--> statement-breakpoint
CREATE TABLE "customer_service_pilot_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"channel" text NOT NULL,
	"message_limit" integer NOT NULL,
	"next_sequence" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'disabled' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_service_pilot_runs_channel_valid" CHECK ("customer_service_pilot_runs"."channel" in ('facebook', 'website')),
	CONSTRAINT "customer_service_pilot_runs_status_valid" CHECK ("customer_service_pilot_runs"."status" in ('disabled', 'active', 'completed', 'stopped')),
	CONSTRAINT "customer_service_pilot_runs_limits_valid" CHECK ("customer_service_pilot_runs"."message_limit" > 0 and "customer_service_pilot_runs"."next_sequence" > 0),
	CONSTRAINT "customer_service_pilot_runs_completion_valid" CHECK (("customer_service_pilot_runs"."status" = 'completed' and "customer_service_pilot_runs"."completed_at" is not null) or ("customer_service_pilot_runs"."status" <> 'completed' and "customer_service_pilot_runs"."completed_at" is null))
);
--> statement-breakpoint
ALTER TABLE "customer_service_ai_attempts" ADD CONSTRAINT "customer_service_ai_attempts_message_id_customer_service_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."customer_service_messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_feedback_events" ADD CONSTRAINT "customer_service_feedback_events_attempt_id_customer_service_ai_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."customer_service_ai_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_feedback_events" ADD CONSTRAINT "customer_service_feedback_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_messages" ADD CONSTRAINT "customer_service_messages_conversation_id_customer_service_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."customer_service_conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_service_messages" ADD CONSTRAINT "customer_service_messages_pilot_run_id_customer_service_pilot_runs_id_fk" FOREIGN KEY ("pilot_run_id") REFERENCES "public"."customer_service_pilot_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_ai_attempts_message_number_unique" ON "customer_service_ai_attempts" USING btree ("message_id","attempt_number");--> statement-breakpoint
CREATE INDEX "customer_service_ai_attempts_message_started_idx" ON "customer_service_ai_attempts" USING btree ("message_id","started_at");--> statement-breakpoint
CREATE INDEX "customer_service_ai_attempts_status_started_idx" ON "customer_service_ai_attempts" USING btree ("status","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_conversations_channel_external_unique" ON "customer_service_conversations" USING btree ("channel","external_key_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_feedback_events_idempotency_unique" ON "customer_service_feedback_events" USING btree ("attempt_id","actor_user_id","action","idempotency_key");--> statement-breakpoint
CREATE INDEX "customer_service_feedback_events_attempt_created_idx" ON "customer_service_feedback_events" USING btree ("attempt_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_messages_channel_external_unique" ON "customer_service_messages" USING btree ("channel","external_message_key_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_messages_pilot_sequence_unique" ON "customer_service_messages" USING btree ("pilot_run_id","pilot_sequence") WHERE "customer_service_messages"."pilot_run_id" is not null and "customer_service_messages"."pilot_sequence" is not null;--> statement-breakpoint
CREATE INDEX "customer_service_messages_conversation_received_idx" ON "customer_service_messages" USING btree ("conversation_id","received_at");--> statement-breakpoint
CREATE INDEX "customer_service_messages_created_idx" ON "customer_service_messages" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_pilot_runs_name_unique" ON "customer_service_pilot_runs" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_pilot_runs_active_channel_unique" ON "customer_service_pilot_runs" USING btree ("channel") WHERE "customer_service_pilot_runs"."status" = 'active';