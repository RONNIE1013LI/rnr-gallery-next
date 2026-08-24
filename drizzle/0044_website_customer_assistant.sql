CREATE TABLE "customer_service_human_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"channel" text DEFAULT 'website' NOT NULL,
	"trigger_turn_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"redacted_summary" text NOT NULL,
	"deep_link_token_hash" text,
	"deep_link_expires_at" timestamp with time zone,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" text,
	"resolution_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_service_human_reviews_generation_valid" CHECK ("customer_service_human_reviews"."generation" > 0),
	CONSTRAINT "customer_service_human_reviews_channel_valid" CHECK ("customer_service_human_reviews"."channel" = 'website'),
	CONSTRAINT "customer_service_human_reviews_reason_valid" CHECK ("customer_service_human_reviews"."reason" in ('high_risk', 'unresolved', 'realtime_required', 'provider_error', 'output_blocked', 'budget_blocked', 'system_failure')),
	CONSTRAINT "customer_service_human_reviews_status_valid" CHECK ("customer_service_human_reviews"."status" in ('open', 'resolved')),
	CONSTRAINT "customer_service_human_reviews_summary_valid" CHECK (length(trim("customer_service_human_reviews"."redacted_summary")) > 0 and char_length("customer_service_human_reviews"."redacted_summary") <= 160),
	CONSTRAINT "customer_service_human_reviews_deep_link_valid" CHECK (("customer_service_human_reviews"."deep_link_token_hash" is null and "customer_service_human_reviews"."deep_link_expires_at" is null) or ("customer_service_human_reviews"."deep_link_token_hash" ~ '^[0-9a-f]{64}$' and "customer_service_human_reviews"."deep_link_expires_at" is not null)),
	CONSTRAINT "customer_service_human_reviews_resolution_valid" CHECK (("customer_service_human_reviews"."status" = 'open' and "customer_service_human_reviews"."resolved_at" is null and "customer_service_human_reviews"."resolved_by_user_id" is null and "customer_service_human_reviews"."resolution_event_id" is null) or ("customer_service_human_reviews"."status" = 'resolved' and "customer_service_human_reviews"."resolved_at" is not null and "customer_service_human_reviews"."resolution_event_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "customer_service_rate_limit_buckets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket_kind" text NOT NULL,
	"bucket_key_hash" text NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_service_rate_limit_buckets_kind_valid" CHECK ("customer_service_rate_limit_buckets"."bucket_kind" in ('session_minute', 'session_hour', 'session_total', 'network_minute', 'network_hour')),
	CONSTRAINT "customer_service_rate_limit_buckets_hash_valid" CHECK ("customer_service_rate_limit_buckets"."bucket_key_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "customer_service_rate_limit_buckets_count_valid" CHECK ("customer_service_rate_limit_buckets"."request_count" >= 0),
	CONSTRAINT "customer_service_rate_limit_buckets_expiry_valid" CHECK ("customer_service_rate_limit_buckets"."expires_at" > "customer_service_rate_limit_buckets"."window_started_at")
);
--> statement-breakpoint
CREATE TABLE "customer_service_review_alert_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"human_review_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"lease_token" text,
	"lease_expires_at" timestamp with time zone,
	"last_error_code" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_service_review_alert_outbox_status_valid" CHECK ("customer_service_review_alert_outbox"."status" in ('pending', 'leased', 'retry_wait', 'sent', 'failed')),
	CONSTRAINT "customer_service_review_alert_outbox_attempts_valid" CHECK ("customer_service_review_alert_outbox"."attempt_count" >= 0),
	CONSTRAINT "customer_service_review_alert_outbox_key_valid" CHECK (length(trim("customer_service_review_alert_outbox"."idempotency_key")) > 0),
	CONSTRAINT "customer_service_review_alert_outbox_lease_valid" CHECK (("customer_service_review_alert_outbox"."status" = 'leased' and "customer_service_review_alert_outbox"."lease_token" is not null and "customer_service_review_alert_outbox"."lease_expires_at" is not null) or ("customer_service_review_alert_outbox"."status" <> 'leased' and "customer_service_review_alert_outbox"."lease_token" is null and "customer_service_review_alert_outbox"."lease_expires_at" is null)),
	CONSTRAINT "customer_service_review_alert_outbox_sent_valid" CHECK (("customer_service_review_alert_outbox"."status" = 'sent' and "customer_service_review_alert_outbox"."sent_at" is not null) or ("customer_service_review_alert_outbox"."status" <> 'sent' and "customer_service_review_alert_outbox"."sent_at" is null))
);
--> statement-breakpoint
CREATE TABLE "customer_service_web_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"channel" text DEFAULT 'website' NOT NULL,
	"session_token_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_service_web_sessions_channel_valid" CHECK ("customer_service_web_sessions"."channel" = 'website'),
	CONSTRAINT "customer_service_web_sessions_status_valid" CHECK ("customer_service_web_sessions"."status" in ('active', 'expired', 'revoked')),
	CONSTRAINT "customer_service_web_sessions_hash_valid" CHECK ("customer_service_web_sessions"."session_token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "customer_service_web_sessions_expiry_valid" CHECK ("customer_service_web_sessions"."expires_at" > "customer_service_web_sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "customer_service_website_assistant_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"channel" text DEFAULT 'website' NOT NULL,
	"message_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"ai_attempt_id" uuid,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"policy_result" text NOT NULL,
	"gate_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"knowledge_version" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_service_website_assistant_messages_kind_valid" CHECK ("customer_service_website_assistant_messages"."kind" in ('validated_ai', 'policy_acknowledgement', 'provider_fallback')),
	CONSTRAINT "customer_service_website_assistant_messages_channel_valid" CHECK ("customer_service_website_assistant_messages"."channel" = 'website'),
	CONSTRAINT "customer_service_website_assistant_messages_policy_valid" CHECK ("customer_service_website_assistant_messages"."policy_result" in ('allowed', 'high_risk', 'unresolved', 'realtime_required', 'budget_blocked', 'provider_error', 'output_blocked', 'system_failure')),
	CONSTRAINT "customer_service_website_assistant_messages_gate_reasons_valid" CHECK (jsonb_typeof("customer_service_website_assistant_messages"."gate_reasons") = 'array'),
	CONSTRAINT "customer_service_website_assistant_messages_content_valid" CHECK (length(trim("customer_service_website_assistant_messages"."body")) > 0 and length(trim("customer_service_website_assistant_messages"."knowledge_version")) > 0),
	CONSTRAINT "customer_service_website_assistant_messages_attempt_valid" CHECK (("customer_service_website_assistant_messages"."kind" = 'validated_ai' and "customer_service_website_assistant_messages"."ai_attempt_id" is not null) or ("customer_service_website_assistant_messages"."kind" <> 'validated_ai' and "customer_service_website_assistant_messages"."ai_attempt_id" is null))
);
--> statement-breakpoint
ALTER TABLE "customer_service_ai_attempts" ADD CONSTRAINT "customer_service_ai_attempts_id_message_unique" UNIQUE("id","message_id");
--> statement-breakpoint
ALTER TABLE "customer_service_conversations" ADD CONSTRAINT "customer_service_conversations_id_channel_unique" UNIQUE("id","channel");
--> statement-breakpoint
ALTER TABLE "customer_service_turns" ADD CONSTRAINT "customer_service_turns_id_conversation_unique" UNIQUE("id","conversation_id");
--> statement-breakpoint
ALTER TABLE "customer_service_human_reviews" ADD CONSTRAINT "customer_service_human_reviews_resolved_by_user_id_user_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_service_human_reviews" ADD CONSTRAINT "customer_service_human_reviews_conversation_fk" FOREIGN KEY ("conversation_id","channel") REFERENCES "public"."customer_service_conversations"("id","channel") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_service_human_reviews" ADD CONSTRAINT "customer_service_human_reviews_turn_fk" FOREIGN KEY ("trigger_turn_id","conversation_id") REFERENCES "public"."customer_service_turns"("id","conversation_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_service_human_reviews" ADD CONSTRAINT "customer_service_human_reviews_resolution_event_fk" FOREIGN KEY ("resolution_event_id","conversation_id") REFERENCES "public"."customer_service_conversation_events"("id","conversation_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_service_review_alert_outbox" ADD CONSTRAINT "customer_service_review_alert_outbox_human_review_id_customer_service_human_reviews_id_fk" FOREIGN KEY ("human_review_id") REFERENCES "public"."customer_service_human_reviews"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_service_web_sessions" ADD CONSTRAINT "customer_service_web_sessions_conversation_fk" FOREIGN KEY ("conversation_id","channel") REFERENCES "public"."customer_service_conversations"("id","channel") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_service_website_assistant_messages" ADD CONSTRAINT "customer_service_website_messages_conversation_fk" FOREIGN KEY ("conversation_id","channel") REFERENCES "public"."customer_service_conversations"("id","channel") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_service_website_assistant_messages" ADD CONSTRAINT "customer_service_website_messages_message_fk" FOREIGN KEY ("message_id","conversation_id") REFERENCES "public"."customer_service_messages"("id","conversation_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_service_website_assistant_messages" ADD CONSTRAINT "customer_service_website_messages_turn_fk" FOREIGN KEY ("turn_id","conversation_id") REFERENCES "public"."customer_service_turns"("id","conversation_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_service_website_assistant_messages" ADD CONSTRAINT "customer_service_website_messages_attempt_fk" FOREIGN KEY ("ai_attempt_id","message_id") REFERENCES "public"."customer_service_ai_attempts"("id","message_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_human_reviews_conversation_generation_unique" ON "customer_service_human_reviews" USING btree ("conversation_id","generation");
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_human_reviews_open_conversation_unique" ON "customer_service_human_reviews" USING btree ("conversation_id") WHERE "customer_service_human_reviews"."status" = 'open';
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_human_reviews_deep_link_unique" ON "customer_service_human_reviews" USING btree ("deep_link_token_hash") WHERE "customer_service_human_reviews"."deep_link_token_hash" is not null;
--> statement-breakpoint
CREATE INDEX "customer_service_human_reviews_status_opened_idx" ON "customer_service_human_reviews" USING btree ("status","opened_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_rate_limit_buckets_window_unique" ON "customer_service_rate_limit_buckets" USING btree ("bucket_kind","bucket_key_hash","window_started_at");
--> statement-breakpoint
CREATE INDEX "customer_service_rate_limit_buckets_expiry_idx" ON "customer_service_rate_limit_buckets" USING btree ("expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_review_alert_outbox_review_unique" ON "customer_service_review_alert_outbox" USING btree ("human_review_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_review_alert_outbox_idempotency_unique" ON "customer_service_review_alert_outbox" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE INDEX "customer_service_review_alert_outbox_due_idx" ON "customer_service_review_alert_outbox" USING btree ("status","next_attempt_at","lease_expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_web_sessions_token_unique" ON "customer_service_web_sessions" USING btree ("session_token_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_web_sessions_conversation_unique" ON "customer_service_web_sessions" USING btree ("conversation_id");
--> statement-breakpoint
CREATE INDEX "customer_service_web_sessions_status_expiry_idx" ON "customer_service_web_sessions" USING btree ("status","expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_website_assistant_messages_turn_unique" ON "customer_service_website_assistant_messages" USING btree ("turn_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_service_website_assistant_messages_attempt_unique" ON "customer_service_website_assistant_messages" USING btree ("ai_attempt_id") WHERE "customer_service_website_assistant_messages"."ai_attempt_id" is not null;
--> statement-breakpoint
CREATE INDEX "customer_service_website_assistant_messages_conversation_published_idx" ON "customer_service_website_assistant_messages" USING btree ("conversation_id","published_at","id");
